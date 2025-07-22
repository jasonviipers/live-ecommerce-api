# CHANGELOG.md

All notable changes to **Live Streaming & Short Video E-commerce Platform Backend** are documented in this file.

---

## [1.0.0] – 2025-07-22

> **Initial stable release** – production-ready MVP.

### ✨ Added
- **Multi-vendor support**
  - Vendor registration, onboarding, profile, and approval workflow.
- **Live Streaming**
  - RTMP ingest via Node Media Server.
  - Real-time chat powered by Socket.io.
  - Stream start/end, viewer count, and chat history endpoints.
- **Short Videos**
  - Upload (TikTok-style) with FFmpeg post-processing (H.264/AAC).
  - Trending feed, likes, and threaded comments.
- **E-commerce Core**
  - Product CRUD with variant support.
  - Shopping cart & checkout flow.
  - Order management (status, refunds, tracking).
- **Payments**
  - Stripe integration: PaymentIntents, webhooks, split payouts to vendors.
  - Payout request & history endpoints.
- **User Management**
  - JWT auth w/ refresh tokens, forgot/reset password, role-based access.
- **Media & CDN**
  - Cloudflare R2 for images & videos.
  - Image/avatar upload & on-the-fly resizing.
- **Analytics**
  - Dashboard metrics (sales, streams, videos).
  - Per-stream & per-video deep-dive analytics.
  - Custom event tracking endpoint.
- **DevEx & Ops**
  - Docker & Docker Compose ready (dev & prod stacks).
  - `bun` runtime with hot-reload dev server.
  - Winston logging, health checks, rate-limiting, and graceful shutdown.
  - ESLint + Prettier + lint-staged pre-commit hooks.
  - Migration & seed system .

### 🧪 Testing
- Unit & integration test suites for auth, products, orders, and payments.
- CI pipeline (GitHub Actions) running lint, tests, and build.
