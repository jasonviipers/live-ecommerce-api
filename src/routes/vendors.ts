import { Hono } from "hono";
import { authMiddleware, requireVendorOrAdmin } from "@/middleware/auth";

const vendors = new Hono();

// Get all vendors
vendors.get("/", async (c) => {
	return c.json({
		message: "Get all vendors",
		vendors: [],
	});
});

// Get vendor by ID
vendors.get("/:id", async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Get vendor ${id}`,
		vendor: null,
	});
});

// Create vendor
vendors.post("/", authMiddleware, async (c) => {
	return c.json({
		message: "Create vendor",
	});
});

// Update vendor
vendors.put("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Update vendor ${id}`,
	});
});

// Delete vendor
vendors.delete("/:id", authMiddleware, requireVendorOrAdmin, async (c) => {
	const id = c.req.param("id");
	return c.json({
		message: `Delete vendor ${id}`,
	});
});

export default vendors;
