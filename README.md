# Live Streaming & Short Video E-commerce Platform Backend

A comprehensive backend system for a multi-vendor live streaming and short video e-commerce platform built with Node.js, TypeScript, and a hybrid database architecture.

## 🚀 Features

### Core Features
- **Multi-vendor Support** - Complete vendor management system
- **Live Streaming** - RTMP streaming with real-time chat
- **Short Videos** - TikTok-style video platform
- **E-commerce** - Full shopping cart and order management
- **Real-time Features** - Socket.io for live updates
- **Payment Processing** - Stripe integration with multi-vendor payouts
- **Analytics** - Comprehensive analytics and reporting
- **Media Management** - Cloudflare R2 integration with video processing

### Technical Features
- **Hybrid Database** - PostgreSQL for optimal performance
- **Caching** - Redis for session management and performance
- **Authentication** - JWT with refresh tokens
- **Validation** - Zod schemas for all inputs
- **File Upload** - Multer + Cloudinary integration
- **Video Processing** - FFmpeg for video optimization
- **Email System** - Nodemailer for notifications
- **Rate Limiting** - Protection against abuse
- **Error Handling** - Comprehensive error management
- **Logging** - Winston for application logging

## 🛠 Technology Stack

- **Runtime**: Bun
- **Framework**: Hono
- **Databases**:
  - PostgreSQL (structured data)
  - Redis (caching & sessions)
- **Authentication**: JWT + bcryptjs
- **Real-time**: Socket.io
- **File Storage**: Cloudflare R2
- **Payments**: Stripe
- **Video Processing**: FFmpeg
- **Streaming**: Node Media Server (RTMP)
- **Validation**: Zod
- **Email**: Nodemailer

## 📋 Prerequisites

- Node.js 18+
- Bun 1.0+
- PostgreSQL 15+
- Redis 7+
- FFmpeg

## 🚀 Quick Start

### 1. Clone the repository
```bash
git clone <repository-url>
cd live-streaming-ecommerce-api
```

### 2. Install dependencies
```bash
bun install
```

### 3. Environment setup
```bash
cp .env.example .env
# Edit .env with your configuration
```

### 4. Database setup
```bash
# Start PostgreSQL and Redis (using Docker)
docker-compose up -d postgres redis

# Run migrations
bun run db:migrate

# Seed database (optional)
bun run db:seed
```

### 5. Start development server
```bash
bun run dev
```

The API will be available at `http://localhost:3000`

## 🐳 Docker Deployment

### Development
```bash
docker-compose up -d
```

### Production
```bash
docker-compose -f docker-compose.prod.yml up -d
```

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - User registration
- `POST /api/auth/login` - User login
- `POST /api/auth/verify-email` - Verify email
- `POST /api/auth/refresh` - Refresh tokens
- `POST /api/auth/logout` - User logout
- `GET /api/auth/me` - Get current user
- `POST /api/auth/forgot-password` - Request password reset
- `POST /api/auth/reset-password` - Reset password
- `POST /api/auth/change-password` - Change password

### User Management
- `GET /api/users` - Get all users (admin)
- `GET /api/users/:id` - Get user by ID
- `PUT /api/users/:id` - Update user
- `DELETE /api/users/:id` - Delete user (admin)

### Vendor Management
- `GET /api/vendors` - Get all vendors
- `GET /api/vendors/:id` - Get vendor by ID
- `POST /api/vendors` - Create vendor
- `PUT /api/vendors/:id` - Update vendor
- `DELETE /api/vendors/:id` - Delete vendor

### Product Management
- `GET /api/products` - Get all products
- `GET /api/products/:id` - Get product by ID
- `POST /api/products` - Create product
- `PUT /api/products/:id` - Update product
- `DELETE /api/products/:id` - Delete product

### Order Management
- `GET /api/orders` - Get user orders
- `GET /api/orders/:id` - Get order by ID
- `POST /api/orders` - Create order
- `PATCH /api/orders/:id/status` - Update order status

### Live Streaming
- `GET /api/streams` - Get all streams
- `GET /api/streams/live` - Get live streams
- `GET /api/streams/:id` - Get stream by ID
- `POST /api/streams` - Create stream
- `POST /api/streams/:id/start` - Start stream
- `POST /api/streams/:id/end` - End stream
- `GET /api/streams/:id/chat` - Get stream chat

### Video Management
- `GET /api/videos` - Get all videos
- `GET /api/videos/trending` - Get trending videos
- `GET /api/videos/:id` - Get video by ID
- `POST /api/videos` - Upload video
- `PUT /api/videos/:id` - Update video
- `DELETE /api/videos/:id` - Delete video
- `POST /api/videos/:id/like` - Like video
- `GET /api/videos/:id/comments` - Get video comments

### Payment Processing
- `POST /api/payments/intent` - Create payment intent
- `POST /api/payments/process` - Process payment
- `GET /api/payments/history` - Get payment history
- `POST /api/payments/webhook/stripe` - Stripe webhook
- `GET /api/payments/payouts` - Get vendor payouts
- `POST /api/payments/payouts/request` - Request payout

### Analytics
- `GET /api/analytics/dashboard` - Get dashboard analytics
- `GET /api/analytics/streams/:id` - Get stream analytics
- `GET /api/analytics/videos/:id` - Get video analytics
- `GET /api/analytics/sales` - Get sales analytics
- `GET /api/analytics/platform` - Get platform analytics (admin)
- `POST /api/analytics/track` - Track event

### File Uploads
- `POST /api/uploads/image` - Upload image
- `POST /api/uploads/video` - Upload video
- `POST /api/uploads/avatar` - Upload avatar
- `GET /api/uploads/status/:id` - Get upload status

## 🔧 Configuration

### Environment Variables

See `.env.example` for all available configuration options.

Key configurations:
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis connection string
- `JWT_SECRET` - JWT signing secret
- `STRIPE_SECRET_KEY` - Stripe secret key
- `CLOUDFLARE_R2_*` - Cloudflare R2 configuration

### Rate Limiting

Default rate limits:
- General API: 100 requests per 15 minutes
- Authentication: 5 attempts per 15 minutes
- File uploads: 50 uploads per hour
- Stream creation: 10 streams per hour
- Payments: 20 requests per hour

## 🧪 Testing

```bash
# Run all tests
bun test

# Run tests in watch mode
bun test --watch

# Run specific test file
bun test auth.test.ts
```

## 📝 Development

### Code Style
```bash
# Lint code
bun run lint

# Fix linting issues
bun run lint:fix

# Format code
bun run format
```

### Database Migrations
```bash
# Create new migration
bun run db:migrate:create <migration-name>

# Run migrations
bun run db:migrate

# Rollback migration
bun run db:migrate:rollback
```

## 🚀 Deployment

### Production Checklist
- [ ] Set `NODE_ENV=production`
- [ ] Configure production database
- [ ] Set up Redis cluster
- [ ] Configure Cloudflare R2
- [ ] Set up Stripe webhooks
- [ ] Configure email service
- [ ] Set up monitoring and logging
- [ ] Configure SSL certificates
- [ ] Set up CDN
- [ ] Configure backup strategy

### Health Checks
- Health endpoint: `GET /health`
- Database connectivity
- Redis connectivity
- External service availability

## 📊 Monitoring

### Logging
- Application logs: `logs/combined.log`
- Error logs: `logs/error.log`
- HTTP access logs: Integrated with Winston

### Metrics
- Request/response times
- Error rates
- Database query performance
- Cache hit rates
- Stream viewer counts
- Payment success rates

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run linting and tests
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the API endpoints

## 🔄 Changelog

See [CHANGELOG.md](CHANGELOG.md) for version history and updates.

