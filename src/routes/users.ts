import { Hono } from "hono";
import { authMiddleware, requireAdmin } from "../middleware/auth";
import { UserRepository } from "@/repositories/user";
import { createError } from "@/middleware/errorHandler";

const userRoutes = new Hono();

// Get all users (admin only)
userRoutes.get("/", authMiddleware, requireAdmin, async (c) => {
	const { page, limit, role, isActive, search } = c.req.query();

	const result = await UserRepository.findAll(
		parseInt(page as string) || 1,
		parseInt(limit as string) || 20,
		{
			role: role as "admin" | "vendor" | "customer" | undefined,
			isActive: isActive ? isActive === "true" : undefined,
			search: search as string | undefined,
		},
	);

	return c.json({
		users: result.users,
		total: result.total,
		page: result.page,
		limit: result.limit,
	});
});

// Get user by ID
userRoutes.get("/:id", authMiddleware, async (c) => {
	const id = c.req.param("id");
	const currentUser = c.get("user");

	if (currentUser.id !== id && currentUser.role !== "admin") {
		throw createError.forbidden("You can only access your own profile");
	}

	const user = await UserRepository.findById(id);
	if (!user) {
		throw createError.notFound("User not found");
	}

	return c.json(user);
});

// Update user
userRoutes.put("/:id", authMiddleware, async (c) => {
	const id = c.req.param("id");
	const currentUser = c.get("user");
	const updateData = await c.req.json();

	if (currentUser.id !== id && currentUser.role !== "admin") {
		throw createError.forbidden("You can only update your own profile");
	}

	if (
		currentUser.id === id &&
		updateData.role &&
		updateData.role !== currentUser.role
	) {
		throw createError.forbidden("You cannot change your own role");
	}

	const updatedUser = await UserRepository.update(id, updateData);
	if (!updatedUser) {
		throw createError.notFound("User not found");
	}

	return c.json(updatedUser);
});

// Delete user (admin only)
userRoutes.delete("/:id", authMiddleware, requireAdmin, async (c) => {
	const id = c.req.param("id");

	const currentUser = c.get("user");
	if (currentUser.id === id) {
		throw createError.forbidden("You cannot delete your own account");
	}

	const success = await UserRepository.deactivate(id);
	if (!success) {
		throw createError.notFound("User not found");
	}

	return c.json({ message: "User deactivated successfully" });
});

export default userRoutes;
