import { Hono } from "hono";
import { authMiddleware, requireVendorOrAdmin } from "@/middleware/auth";

const vendorRoutes = new Hono();

// Get all vendors
vendorRoutes.get("/", async (c) => {
	return c.json({
		message: "Get all vendors",
		vendors: [],
	});
});

// Get vendor by ID
vendorRoutes.get("/:id", async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Get vendor ${id}`,
		vendor: null,
	});
});

// Create vendor
vendorRoutes.post("/", authMiddleware, async (c) => {
	return c.json({
		message: "Create vendor",
	});
});

// Update vendor
vendorRoutes.put("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Update vendor ${id}`,
	});
});

// Delete vendor
vendorRoutes.delete("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Delete vendor ${id}`,
	});
});

export default vendorRoutes;
