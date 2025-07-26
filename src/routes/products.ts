import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import {
	authMiddleware,
	optionalAuthMiddleware,
	requireVendorOrAdmin,
} from "@/middleware/auth";
import {
	createProductSchema,
	querySchema,
	updateProductSchema,
} from "@/utils/validation";
import ProductRepository from "@/repositories/product";
import logger from "@/config/logger";
import { createError } from "@/middleware/errorHandler";
import VendorRepository from "@/repositories/vendor";

const productRoutes = new Hono();

type Query = z.infer<typeof querySchema>;
type ProductSortBy = Query["sortBy"];
type SortOrder = Query["sortOrder"];

productRoutes.get(
	"/",
	optionalAuthMiddleware,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const result = await ProductRepository.findAll(query.page, query.limit, {
				categoryId: query.categoryId,
				vendorId: query.vendorId,
				isActive: query.isActive ?? true, // Default to active products for public
				isFeatured: query.isFeatured,
				search: query.search,
				tags: query.tags,
				priceMin: query.priceMin,
				priceMax: query.priceMax,
				sortBy: query.sortBy as ProductSortBy,
				sortOrder: query.sortOrder as SortOrder,
			});

			return c.json({
				success: true,
				data: result,
				pagination: {
					page: result.page,
					limit: result.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / result.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get products", error as Error);
			throw createError.internal("Failed to retrieve products");
		}
	},
);

productRoutes.get("/featured", async (c) => {
	try {
		const limit = parseInt(c.req.query("limit") || "10");
		const products = await ProductRepository.getFeaturedProducts(
			Math.min(limit, 50),
		);

		return c.json({
			success: true,
			data: products,
		});
	} catch (error) {
		logger.error("Failed to get featured products", error as Error);
		throw createError.internal("Failed to retrieve featured products");
	}
});

productRoutes.get(
	"/search",
	zValidator(
		"query",
		z.object({
			q: z.string().min(1, "Search query is required"),
			categoryId: z.string().uuid().optional(),
			priceMin: z
				.string()
				.transform((val) => (val ? parseFloat(val) : undefined))
				.optional(),
			priceMax: z
				.string()
				.transform((val) => (val ? parseFloat(val) : undefined))
				.optional(),
			tags: z
				.string()
				.transform((val) => (val ? val.split(",") : undefined))
				.optional(),
			page: z.string().transform((val) => parseInt(val) || 1),
			limit: z.string().transform((val) => Math.min(parseInt(val) || 20, 100)),
		}),
	),
	async (c) => {
		try {
			const query = c.req.valid("query");

			const result = await ProductRepository.search(
				query.q,
				{
					categoryId: query.categoryId,
					priceMin: query.priceMin,
					priceMax: query.priceMax,
					tags: query.tags,
				},
				query.page,
				query.limit,
			);

			return c.json({
				success: true,
				data: {
					products: result.products,
					total: result.total,
					page: query.page,
					limit: query.limit,
				},
				pagination: {
					page: query.page,
					limit: query.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / query.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to search products", error as Error);
			throw createError.internal("Failed to search products");
		}
	},
);

productRoutes.post(
	"/",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", createProductSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const data = c.req.valid("json");

			const vendorId = user.vendorId;
			if (!vendorId) {
				throw createError[user.role === "admin" ? "badRequest" : "forbidden"](
					user.role === "admin"
						? "Vendor ID is required for admin users"
						: "Vendor account required",
				);
			}

			// Verify vendor exists and is active
			const vendor = await VendorRepository.findById(vendorId);
			if (!vendor || !vendor.isActive) {
				throw createError.badRequest("Invalid or inactive vendor");
			}

			const product = await ProductRepository.create({
				...data,
				vendorId,
			});

			logger.info("Product created successfully", {
				productId: product.id,
				vendorId,
				userId: user.id,
			});

			return c.json(
				{
					success: true,
					message: "Product created successfully",
					data: product,
				},
				201,
			);
		} catch (error) {
			logger.error("Failed to create product", error as Error);
			throw error;
		}
	},
);

productRoutes.get("/:id", optionalAuthMiddleware, async (c) => {
	try {
		const id = c.req.param("id");
		const product = await ProductRepository.findById(id);

		if (!product) {
			throw createError.notFound("Product not found");
		}

		await ProductRepository.incrementViewCount(id);

		return c.json({
			success: true,
			data: product,
		});
	} catch (error) {
		logger.error("Failed to get product", error as Error);
		throw error;
	}
});

productRoutes.put(
	"/:id",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator("json", updateProductSchema),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const data = c.req.valid("json");

			// Get existing product
			const existingProduct = await ProductRepository.findById(id);
			if (!existingProduct) {
				throw createError.notFound("Product not found");
			}

			// Check ownership (vendors can only update their own products)
			if (
				user.role === "vendor" &&
				existingProduct.vendorId !== user.vendorId
			) {
				throw createError.forbidden("Access denied to this product");
			}

			const product = await ProductRepository.update(id, data);

			if (!product) {
				throw createError.notFound("Product not found");
			}

			logger.info("Product updated successfully", {
				productId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Product updated successfully",
				data: product,
			});
		} catch (error) {
			logger.error("Failed to update product", error as Error);
			throw error;
		}
	},
);

productRoutes.delete(
	"/:id",
	authMiddleware,
	requireVendorOrAdmin,
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");

			const existingProduct = await ProductRepository.findById(id);
			if (!existingProduct) {
				throw createError.notFound("Product not found");
			}

			// Check ownership (vendors can only delete their own products)
			if (
				user.role === "vendor" &&
				existingProduct.vendorId !== user.vendorId
			) {
				throw createError.forbidden("Access denied to this product");
			}

			const deleted = await ProductRepository.delete(id);

			if (!deleted) {
				throw createError.notFound("Product not found");
			}

			logger.info("Product deleted successfully", {
				productId: id,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Product deleted successfully",
			});
		} catch (error) {
			logger.error("Failed to delete product", error as Error);
			throw error;
		}
	},
);

productRoutes.patch(
	"/:id/inventory",
	authMiddleware,
	requireVendorOrAdmin,
	zValidator(
		"json",
		z.object({
			quantity: z.number().int().min(0, "Quantity must be non-negative"),
		}),
	),
	async (c) => {
		try {
			const user = c.get("user");
			const id = c.req.param("id");
			const { quantity } = c.req.valid("json");

			// Get existing product
			const existingProduct = await ProductRepository.findById(id);
			if (!existingProduct) {
				throw createError.notFound("Product not found");
			}

			// Check ownership
			if (
				user.role === "vendor" &&
				existingProduct.vendorId !== user.vendorId
			) {
				throw createError.forbidden("Access denied to this product");
			}

			const updated = await ProductRepository.updateInventory(id, quantity);

			if (!updated) {
				throw createError.notFound("Product not found");
			}

			logger.info("Product inventory updated", {
				productId: id,
				quantity,
				userId: user.id,
			});

			return c.json({
				success: true,
				message: "Inventory updated successfully",
			});
		} catch (error) {
			logger.error("Failed to update inventory", error as Error);
			throw error;
		}
	},
);

productRoutes.get(
	"/inventory/low-stock",
	authMiddleware,
	requireVendorOrAdmin,
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = user.role === "vendor" ? user.vendorId : undefined;

			const products = await ProductRepository.getLowStockProducts(vendorId);

			return c.json({
				success: true,
				data: products,
			});
		} catch (error) {
			logger.error("Failed to get low stock products", error as Error);
			throw createError.internal("Failed to retrieve low stock products");
		}
	},
);

productRoutes.get(
	"/vendor/:vendorId",
	authMiddleware,
	zValidator("query", querySchema),
	async (c) => {
		try {
			const user = c.get("user");
			const vendorId = c.req.param("vendorId");
			const query = c.req.valid("query");

			// Check access (vendors can only see their own products, admins can see all)
			if (user.role === "vendor" && user.vendorId !== vendorId) {
				throw createError.forbidden("Access denied to this vendor's products");
			}

			const result = await ProductRepository.findAll(query.page, query.limit, {
				vendorId,
				categoryId: query.categoryId,
				isActive: query.isActive,
				isFeatured: query.isFeatured,
				search: query.search,
				tags: query.tags,
				priceMin: query.priceMin,
				priceMax: query.priceMax,
				sortBy: query.sortBy,
				sortOrder: query.sortOrder,
			});

			return c.json({
				success: true,
				data: result,
				pagination: {
					page: result.page,
					limit: result.limit,
					total: result.total,
					totalPages: Math.ceil(result.total / result.limit),
				},
			});
		} catch (error) {
			logger.error("Failed to get vendor products", error as Error);
			throw error;
		}
	},
);

export default productRoutes;
