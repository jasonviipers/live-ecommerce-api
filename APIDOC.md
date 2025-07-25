# 📚 Live Streaming E-commerce API Documentation

## Base URL
`https://api.example.com`

## Authentication & Authorization
- All endpoints require authentication unless marked as "Public"
- Admin-only endpoints are marked with (Admin)
- Vendor-specific endpoints are marked with (Vendor)

## Health Check
- `GET /health` - Check service health status

## Authentication Endpoints
- `POST /api/auth/register` - Register new user (Public)
- `POST /api/auth/login` - User login (Public)
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/verify-email` - Verify email with OTP
- `POST /api/auth/logout` - Logout user
- `GET /api/auth/me` - Get current user profile
- `POST /api/auth/forgot-password` - Request password reset (Public)
- `POST /api/auth/reset-password` - Reset password with OTP (Public)
- `POST /api/auth/change-password` - Change password

## User Management (Admin)
- `GET /api/users` - List all users
- `GET /api/users/:id` - Get user details
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Deactivate user

## Vendor Management
- `GET /api/vendors` - List vendors (Public)
- `GET /api/vendors/:id` - Get vendor details (Public)
- `POST /api/vendors` - Create vendor (Admin)
- `PUT /api/vendors/:id` - Update vendor (Vendor/Admin)
- `DELETE /api/vendors/:id` - Delete vendor (Vendor/Admin)

## Product Management
- `GET /api/products` - List products (Public)
- `GET /api/products/featured` - Get featured products (Public)
- `GET /api/products/search` - Search products (Public)
- `POST /api/products` - Create product (Vendor/Admin)
- `GET /api/products/:id` - Get product details (Public)
- `PUT /api/products/:id` - Update product (Vendor/Admin)
- `DELETE /api/products/:id` - Delete product (Vendor/Admin)
- `PATCH /api/products/:id/inventory` - Update inventory (Vendor/Admin)
- `GET /api/products/inventory/low-stock` - Get low stock products (Vendor/Admin)

## Cart Management
- `GET /api/cart` - Get cart contents
- `POST /api/cart/items` - Add item to cart
- `PUT /api/cart/items/:itemId` - Update cart item
- `DELETE /api/cart/items/:itemId` - Remove item from cart
- `DELETE /api/cart` - Clear cart
- `GET /api/cart/validate` - Validate cart contents
- `POST /api/cart/merge` - Merge session cart with user cart

## Order Management
- `GET /api/orders` - List orders (User/Vendor/Admin)
- `POST /api/orders` - Create order
- `GET /api/orders/:id` - Get order details
- `GET /api/orders/number/:orderNumber` - Get order by number
- `PUT /api/orders/:id` - Update order (Vendor/Admin)
- `PATCH /api/orders/:id/status` - Update order status (Vendor/Admin)
- `PATCH /api/orders/:id/payment-status` - Update payment status (Admin)
- `POST /api/orders/:id/cancel` - Cancel order
- `GET /api/orders/stats/summary` - Get order statistics (Vendor/Admin)

## Payment Processing
- `POST /api/payments/payment-intents` - Create payment intent
- `GET /api/payments/:id` - Get payment details
- `GET /api/payments/order/:orderId` - Get order payments
- `GET /api/payments/vendor/:vendorId` - Get vendor payments (Vendor/Admin)
- `POST /api/payments/:id/refund` - Create refund (Vendor/Admin)
- `POST /api/payments/payouts` - Create payout (Vendor/Admin)
- `GET /api/payments/payouts/:id` - Get payout details (Vendor/Admin)
- `GET /api/payments/vendor/:vendorId/payouts` - List vendor payouts (Vendor/Admin)
- `GET /api/payments/vendor/:vendorId/earnings` - Get vendor earnings (Vendor/Admin)
- `POST /api/payments/webhooks/stripe` - Stripe webhook handler (Public)

## Live Streaming
- `GET /api/streams` - List streams (Public)
- `GET /api/streams/live` - Get live streams (Public)
- `GET /api/streams/upcoming` - Get upcoming streams (Public)
- `GET /api/streams/popular` - Get popular streams (Public)
- `POST /api/streams` - Create stream (Vendor/Admin)
- `GET /api/streams/:id` - Get stream details (Public)
- `PUT /api/streams/:id` - Update stream (Vendor/Admin)
- `POST /api/streams/:id/start` - Start stream (Vendor/Admin)
- `POST /api/streams/:id/end` - End stream (Vendor/Admin)
- `PATCH /api/streams/:id/viewers` - Update viewer count (Internal)
- `POST /api/streams/:id/like` - Like stream
- `POST /api/streams/:id/share` - Share stream
- `DELETE /api/streams/:id` - Delete stream (Vendor/Admin)
- `GET /api/streams/vendor/:vendorId` - Get vendor streams (Vendor/Admin)

## Video Management
- `GET /api/videos` - List videos (Public)
- `GET /api/videos/trending` - Get trending videos (Public)
- `GET /api/videos/recent` - Get recent videos (Public)
- `GET /api/videos/popular` - Get popular videos (Public)
- `GET /api/videos/search` - Search videos (Public)
- `POST /api/videos` - Create video (Vendor/Admin)
- `GET /api/videos/:id` - Get video details (Public)
- `PUT /api/videos/:id` - Update video (Vendor/Admin)
- `POST /api/videos/:id/like` - Like video
- `POST /api/videos/:id/share` - Share video
- `DELETE /api/videos/:id` - Delete video (Vendor/Admin)
- `GET /api/videos/vendor/:vendorId` - Get vendor videos (Vendor/Admin)
- `GET /api/videos/stats/summary` - Get video statistics (Vendor/Admin)

## Chat System
- `GET /api/chat/:streamKey/messages` - Get chat messages (Public)
- `POST /api/chat/:streamKey/messages` - Send chat message
- `DELETE /api/chat/:streamKey/messages/:messageId` - Delete message
- `POST /api/chat/:streamKey/ban` - Ban user from chat
- `DELETE /api/chat/:streamKey/ban/:userId` - Unban user
- `POST /api/chat/:streamKey/moderators` - Add moderator
- `PATCH /api/chat/:streamKey/settings` - Update chat settings
- `PATCH /api/chat/:streamKey/mode` - Update chat mode
- `GET /api/chat/:streamKey/stats` - Get chat statistics
- `GET /api/chat/:streamKey/info` - Get chat room info (Public)

## Donations
- `POST /api/donations/:streamKey` - Create donation
- `GET /api/donations/:streamKey/stats` - Get donation stats (Public)
- `GET /api/donations/:streamKey/alerts` - Get donation alerts
- `PATCH /api/donations/alerts/:alertId/shown` - Mark alert as shown
- `POST /api/donations/:streamKey/goals` - Create donation goal
- `GET /api/donations/:streamKey/goals` - Get donation goals (Public)
- `PATCH /api/donations/goals/:goalId` - Update donation goal
- `DELETE /api/donations/goals/:goalId` - Delete donation goal
- `GET /api/donations/:streamKey/leaderboard` - Get leaderboard (Public)
- `GET /api/donations/:streamKey/recent` - Get recent donations (Public)
- `GET /api/donations/tiers` - Get donation tiers (Public)
- `POST /api/donations/webhook/payment-completed` - Payment webhook (Public)

## Analytics
- `POST /api/analytics/track` - Track analytics event (Public)
- `GET /api/analytics/metrics/general` - Get general metrics (Admin)
- `GET /api/analytics/metrics/realtime` - Get real-time metrics (Admin)
- `GET /api/analytics/streams/:streamId` - Get stream analytics (Vendor/Admin)
- `GET /api/analytics/products/:productId` - Get product analytics (Vendor/Admin)
- `GET /api/analytics/vendors/:vendorId` - Get vendor analytics (Vendor/Admin)
- `GET /api/analytics/my-analytics` - Get current user's analytics (Vendor/Admin)
- `POST /api/analytics/track/batch` - Batch track events (Public)
- `GET /api/analytics/dashboard` - Get dashboard analytics (Vendor/Admin)

## File Uploads
- `POST /api/uploads/single` - Upload single file
- `POST /api/uploads/multiple` - Upload multiple files
- `GET /api/uploads/my-files` - Get user's uploaded files
- `GET /api/uploads/:id` - Get uploaded file details
- `DELETE /api/uploads/:id` - Delete uploaded file
- `POST /api/uploads/avatar` - Upload avatar image
- `POST /api/uploads/product/:productId/images` - Upload product images
- `GET /api/uploads/stats/summary` - Get upload statistics

## Notifications
- `GET /api/notifications` - Get user notifications
- `GET /api/notifications/unread-count` - Get unread count
- `PATCH /api/notifications/read` - Mark as read
- `DELETE /api/notifications/:id` - Delete notification
- `POST /api/notifications/test` - Send test notification (Dev only)

