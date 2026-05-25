# CrackPOS Backend — Inventory Management API

Enterprise-grade inventory management backend built with **NestJS v11**, **Prisma v7**, and **PostgreSQL**.  
Multi-tenant SaaS architecture with role-based access control, real-time stock tracking, and AI-powered insights.

---

## 🗄️ Database Entity Relationship Diagram (ERD)

![Database ERD](./assets/db%20diagram.png)

### Database Overview

CrackPOS menggunakan **multi-tenant architecture** dengan **row-level isolation**. Setiap tabel memiliki kolom `tenantId` untuk memisahkan data antar toko secara otomatis.

**16 Tables Total:**

**Platform Level (2 tables):**
- `platform_admins` - Super admin untuk mengelola seluruh platform
- `platform_users` - User global yang bisa memiliki/bergabung dengan multiple tenants

**Tenant & Multi-Tenancy (4 tables):**
- `tenants` - Data toko (store), root entity untuk isolasi multi-tenant
- `tenant_members` - Relasi many-to-many antara PlatformUser dan Tenant
- `tenant_users` - User dalam toko (kasir, admin toko) dengan username/password
- `refresh_tokens` - Token refresh JWT untuk session management

**Catalog (3 tables):**
- `categories` - Kategori produk (Makanan, Minuman, dll)
- `suppliers` - Data pemasok/supplier
- `products` - Produk dengan SKU, harga, stok, gambar

**Inventory (1 table):**
- `stock_transactions` - Ledger transaksi stok (IN/OUT/ADJUSTMENT/RETURN)

**Sales (4 tables):**
- `sales_orders` - Order penjualan dengan tracking profit & COGS
- `order_items` - Item dalam order penjualan
- `sales_returns` - Retur penjualan
- `sales_return_items` - Item dalam retur

**Purchase (2 tables):**
- `purchase_orders` - Order pembelian dari supplier
- `purchase_order_items` - Item dalam order pembelian

**Audit (1 table):**
- `activity_logs` - Audit trail untuk semua operasi (CREATE/UPDATE/DELETE/LOGIN/LOGOUT)

### Key Relationships

```
tenants (1) ──< (N) tenant_users ──< (N) refresh_tokens
tenants (1) ──< (N) products ──> (1) categories
tenants (1) ──< (N) products ──> (1) suppliers
tenants (1) ──< (N) sales_orders ──< (N) order_items ──> (1) products
tenants (1) ──< (N) purchase_orders ──< (N) purchase_order_items ──> (1) products
tenants (1) ──< (N) sales_returns ──< (N) sales_return_items ──> (1) order_items
tenants (1) ──< (N) stock_transactions ──> (1) products
tenants (1) ──< (N) activity_logs
```

**Dokumentasi lengkap ERD** tersedia di [ARCHITECTURE.md](./ARCHITECTURE.md) dengan format Mermaid dan DBDiagram.io yang siap copy-paste.

---













## 🧪 Test Coverage

![Statements](https://img.shields.io/badge/statements-40.85%25-orange.svg?style=flat)
![Branches](https://img.shields.io/badge/branches-36.45%25-red.svg?style=flat)
![Functions](https://img.shields.io/badge/functions-44.17%25-orange.svg?style=flat)
![Lines](https://img.shields.io/badge/lines-40.61%25-orange.svg?style=flat)

**Overall Test Coverage: ~41%** (Target: 75%+)

Current test suite includes **260 tests across 25 test files**, covering:
- ✅ Authentication & Authorization (login, register, JWT, refresh tokens, OAuth)
- ✅ Guards (JWT, CSRF, Roles, Tenant Throttler)
- ✅ Filters (HTTP Exception, Prisma Exception)
- ✅ Interceptors (Cache, Response Transformation)
- ✅ Core Services (Auth, Users, Products, Categories, Suppliers)
- ✅ Business Logic (Sales, Purchase, Returns, Inventory, Dashboard, Reports)
- ✅ AI Service (Chat, Token Validation)
- ✅ Admin & Activity Logging
- ✅ Health Checks & File Upload

**Coverage by Module:**
- **Well-Tested (>70%)**:
  - Guards: 74.71% (CSRF, JWT, Roles, Throttler)
  - Sales: 68.75% (Order management)
  - Purchase: 67.82% (Purchase orders)
  - Returns: 67.5% (Return handling)
  - Auth: 65.02% (Authentication flow)
  - Users: 62.5% (User management)
  - Filters: 62.12% (Exception handling)

- **Moderate Coverage (40-70%)**:
  - AI Service: 58.46% (Chat functionality)
  - Health: 58.82% (Health checks)
  - Upload: 48.71% (File validation)
  - Products: 47.45% (CRUD operations)
  - Dashboard: 45.28% (Analytics)
  - Admin: 44.56% (Tenant management)
  - Inventory: 43.18% (Stock tracking)
  - Categories/Suppliers: 42.3% (Basic CRUD)
  - Reports: 41.22% (Report generation)
  - Activity Log: 39.47% (Audit trail)

- **Needs Improvement (<40%)**:
  - All Controllers: 0% (API endpoints - in progress)
  - Interceptors: 26.92% (Audit log interceptor)
  - Middleware: 0% (Sanitize middleware)
  - Strategies: 0% (JWT strategy)
  - DTOs: 0% (Validation rules)

**Testing Documentation**: See [TESTING.md](./TESTING.md) for comprehensive testing guidelines, patterns, and best practices.

Run `npm run test:cov` to generate updated coverage report.

---

## 📋 Table of Contents

- [Tech Stack](#-tech-stack)
- [Architecture Overview](#-architecture-overview)
- [Quick Start](#-quick-start)
- [Project Structure](#-project-structure)
- [Authentication & Security](#-authentication--security)
- [API Endpoints](#-api-endpoints)
- [Database Schema](#-database-schema)
- [Environment Variables](#-environment-variables)
- [Error Handling](#-error-handling)
- [Scripts](#-scripts)
- [Docker](#-docker)

---

## 🧩 Tech Stack

| Layer            | Tech                                                              |
| ---------------- | ----------------------------------------------------------------- |
| **Framework**    | NestJS v11 (Express under the hood)                               |
| **Language**     | TypeScript 5+ with `strict` mode                                  |
| **Database**     | PostgreSQL 16                                                      |
| **ORM**          | Prisma v7 (type-safe database client)                             |
| **Auth**         | JWT (Passport) + HttpOnly Cookie + bcrypt (cost factor 12)        |
| **CSRF**         | Double-submit cookie pattern                                      |
| **Validation**   | `class-validator` + `class-transformer`                           |
| **API Docs**     | Swagger / OpenAPI (auto-generated at `/api`)                      |
| **Rate Limit**   | `@nestjs/throttler` — multi-tenant aware                          |
| **Logging**      | Winston (structured JSON in production, colorful in dev)          |
| **File Upload**  | Multer (max 5MB, jpeg/png/gif/webp only)                          |
| **Caching**      | In-memory with 30s TTL for GET endpoints                          |
| **AI**           | Python FastAPI microservice (separate Docker container)           |
| **Auth Provider**| Google OAuth via Firebase ID Token (optional)                     |

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (Next.js)                    │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Auth UI  │  │ Dashboard│  │   apiClient (axios)  │  │
│  └────┬─────┘  └────┬─────┘  └──────────┬───────────┘  │
│       │             │                    │              │
│       └─────────────┼────────────────────┘              │
│                     │  HttpOnly Cookie (auth_token)      │
│                     │  + X-CSRF-Token header            │
└─────────────────────┼───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              CrackPOS Backend (NestJS)                   │
│                                                          │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Global Guards (layer)                │   │
│  │  ┌──────────┐  ┌────────────┐  ┌──────────┐     │   │
│  │  │JwtAuth   │  │TenantThrott│  │CsrfGuard │     │   │
│  │  │Guard     │  │lerGuard   │  │(CSRF)    │     │   │
│  │  └────┬─────┘  └────────────┘  └────┬─────┘     │   │
│  └───────┼──────────────────────────────┼───────────┘   │
│          │                              │               │
│          ▼                              ▼               │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Feature Modules                      │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │   │
│  │  │Auth  │ │Users │ │Product│ │Sales │ │Purchase│  │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │   │
│  │  ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐  │   │
│  │  │Invtry│ │Return│ │Report│ │Dashbd│ │Upload │  │   │
│  │  └──────┘ └──────┘ └──────┘ └──────┘ └──────┘  │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│  ┌──────────────────────────────────────────────────┐   │
│  │         PrismaService (Database Layer)            │   │
│  │  - Tenant isolation via getClient(tenantId)       │   │
│  │  - Auto soft-delete filtering                     │   │
│  │  - Transaction support                            │   │
│  └──────────────────────────────────────────────────┘   │
│                          │                              │
│                          ▼                              │
│              ┌─────────────────────┐                    │
│              │     PostgreSQL      │                    │
│              │  (Multi-tenant DB)  │                    │
│              └─────────────────────┘                    │
└─────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌─────────────────────┐
              │  Python AI Service  │
              │  (crack-ai)         │
              └─────────────────────┘
```

### Key Architecture Decisions (Updated)

**Multi-tenant via Row-Level Isolation**  
Every table has a `tenantId` column. The `PrismaService.getClient(tenantId)` returns an extended Prisma client that automatically adds `WHERE tenantId = ?` to every query. No separate databases per tenant — cheaper and simpler to manage.

**Cookie-Based Auth with CSRF Protection**  
JWT tokens are stored in **HttpOnly cookies** (`auth_token`, `refresh_token`), not in `localStorage`. This prevents XSS-based token theft. CSRF is handled via **double-submit cookie pattern** — a non-httpOnly `csrf_token` cookie + `X-CSRF-Token` header on unsafe methods (POST, PATCH, PUT, DELETE).

**Global Guards Pipeline**  
All requests pass through three global guards in order:
1. **JwtAuthGuard** — extracts JWT from cookie (primary) or Bearer header (fallback)
2. **TenantThrottlerGuard** — rate limits per tenant (not per IP, preventing noisy-neighbor issues)
3. **CsrfGuard** — validates CSRF token on state-changing requests (skips `@Public()` routes)

**Audit Logging**  
Every mutation (CREATE, UPDATE, DELETE) is automatically logged via `AuditLogInterceptor` — who did what, when, and on which entity.

---

## 🚀 Quick Start

```bash
# 1. Clone & install dependencies
npm install

# 2. Copy environment file and fill in your values
cp .env.example .env
# Edit .env with your database URL, JWT secret, etc.

# 3. Run database migration
npx prisma migrate dev

# 4. Seed default admin & staff users
npx prisma db seed

# 5. Start development server (hot reload)
npm run start:dev
```

The API will be available at `http://localhost:3000` and Swagger docs at `http://localhost:3000/api`.

### Seed Data

Seeder berlokasi di `prisma/seed/` dengan struktur modular:

```
prisma/seed/
├── index.ts               # Entry point — runs all seeders in order
├── tenant-and-users.ts    # Creates tenant + admin + staff users
├── categories.ts          # Seed categories (e.g., Makanan, Minuman)
├── suppliers.ts           # Seed suppliers
├── products.ts            # Seed products with prices & stock
├── sales-orders.ts        # Seed historical sales data
├── purchase-orders.ts     # Seed purchase orders
├── summary.ts             # Logs seed summary
└── cleanup.ts             # Cleanup script
```

### Default Seed Users

| Username  | Password       | Role  |
| --------- | -------------- | ----- |
| `admin1`  | `password123`  | ADMIN |
| `staff1`  | `password123`  | STAFF/CASHIER |

---

## 📁 Project Structure

```
```
src/
├── app.module.ts                 # Root module — registers global guards & interceptors
├── main.ts                       # Bootstrap — CORS, Helmet, CookieParser, Swagger, Validation
├── prisma.service.ts             # Prisma client with tenant isolation extension
├── prisma.module.ts              # Shared Prisma module
├── prisma.extension.ts           # Soft delete + tenant filter extensions
├── logger.config.ts              # Winston logger configuration
│
├── auth/                         # 🔐 Authentication module
│   ├── auth.module.ts
│   ├── auth.controller.ts        # POST /auth/login, /auth/register, /auth/refresh, /auth/logout
│   ├── auth.service.ts           # Login logic, brute force protection, token rotation, Google OAuth
│   ├── auth.service.spec.ts      # Unit tests
│   ├── dto/
│   │   ├── login.dto.ts
│   │   ├── register.dto.ts
│   │   ├── google-login.dto.ts   # Google OAuth payload
│   │   └── create-store.dto.ts   # Post-Google store creation
│   └── strategies/
│       └── jwt.strategy.ts       # Dual-mode: cookie first, Bearer header fallback
│
├── users/                        # 👥 User management (Admin only)
│   ├── users.controller.ts
│   ├── users.service.ts
│   ├── users.service.spec.ts
│   ├── users.module.ts
│   └── dto/
│       ├── create-user.dto.ts
│       └── update-user.dto.ts
│
├── categories/                   # 🏷️ Product categories
│   ├── categories.controller.ts
│   ├── categories.service.ts
│   ├── categories.service.spec.ts
│   └── categories.module.ts
│
├── suppliers/                    # 🤝 Supplier management
│   ├── suppliers.controller.ts
│   ├── suppliers.service.ts
│   ├── suppliers.service.spec.ts
│   └── suppliers.module.ts
│
├── products/                     # 📦 Product catalog (search, pagination, filter)
│   ├── products.controller.ts
│   ├── products.service.ts
│   ├── products.service.spec.ts
│   ├── products.module.ts
│   └── dto/create-product.dto.ts
│
├── inventory/                    # 📊 Stock transactions & adjustments
│   ├── inventory.controller.ts
│   ├── inventory.service.ts
│   ├── inventory.service.spec.ts
│   ├── inventory.module.ts
│   └── dto/
│       ├── adjust-stock.dto.ts
│       └── ai-product-input.dto.ts
│
├── sales/                        # 🛒 Sales orders with COGS tracking
│   ├── sales.controller.ts
│   ├── sales.service.ts
│   ├── sales.service.spec.ts
│   ├── sales.module.ts
│   └── dto/create-sales-order.dto.ts
│
├── purchase/                     # 🚚 Purchase orders from suppliers
│   ├── purchase.controller.ts
│   ├── purchase.service.ts
│   ├── purchase.service.spec.ts
│   ├── purchase.module.ts
│   └── dto/create-purchase-order.dto.ts
│
├── returns/                      # ↩️ Sales returns with stock reversal
│   ├── returns.controller.ts
│   ├── returns.service.ts
│   ├── returns.service.spec.ts
│   ├── returns.module.ts
│   └── dto/
│
├── activity-log/                 # 📋 Audit trail
│   ├── activity-log.controller.ts
│   ├── activity-log.service.ts
│   └── activity-log.module.ts
│
├── dashboard/                    # 📈 Dashboard analytics
│   ├── dashboard.controller.ts
│   ├── dashboard.service.ts
│   ├── dashboard.service.spec.ts
│   └── dashboard.module.ts
│
├── reports/                      # 📑 Reports (Admin only)
│   ├── reports.controller.ts
│   ├── reports.service.ts
│   ├── reports.service.spec.ts
│   └── reports.module.ts
│
├── upload/                       # 📤 File upload (product images via Multer)
│   ├── upload.controller.ts
│   └── upload.module.ts
│
├── health/                       # ❤️ Health check endpoint
│   ├── health.controller.ts
│   └── prisma.health.ts
│
├── ai/                           # 🤖 AI chat integration module
│   ├── ai.controller.ts
│   ├── ai.service.ts
│   ├── ai.module.ts
│   └── dto/ai-chat-request.dto.ts
│
├── ai-data/                      # 🔌 AI data API (read-only for Python AI service)
│   ├── ai-data.controller.ts
│   └── ai-data.module.ts
│
├── admin/                        # 🛡️ Platform admin module
│   ├── admin.controller.ts
│   ├── admin.service.ts
│   └── admin.module.ts
│
├── common/                       # 🔧 Shared utilities
│   ├── constants/
│   │   └── roles.constant.ts     # Role definitions (SUPER_ADMIN, ADMIN, STAFF)
│   ├── decorators/
│   │   ├── current-user.decorator.ts   # @CurrentUser() parameter decorator
│   │   ├── public.decorator.ts         # @Public() — skip JWT auth
│   │   └── roles.decorator.ts          # @Roles() — role-based access
│   ├── guards/
│   │   ├── jwt-auth.guard.ts           # Global JWT guard (reads cookie first)
│   │   ├── jwt-auth.guard.spec.ts      # Unit test
│   │   ├── platform-jwt.guard.ts       # Guard for Google-login platform tokens
│   │   ├── csrf.guard.ts               # Double-submit cookie CSRF validation
│   │   ├── roles.guard.ts              # Role-based authorization
│   │   └── tenant-throttler.guard.ts   # Tenant-aware rate limiting
│   ├── middleware/
│   │   └── sanitize.middleware.ts      # Input sanitization middleware
│   ├── filters/
│   │   ├── http-exception.filter.ts
│   │   ├── prisma-client-exception.filter.ts
│   │   └── all-exceptions.filter.ts
│   └── interceptors/
│       ├── response.interceptor.ts     # Standardized JSON envelope
│       ├── cache.interceptor.ts        # 30s in-memory cache for GET
│       └── audit-log.interceptor.ts    # Auto-log all mutations
│
└── test/                         # 🧪 Test utilities & fixtures
    ├── fixtures/
    │   └── users.fixture.ts      # User test fixtures
    └── utils/
        ├── mock-prisma.ts        # Prisma mock factory
        └── test-helpers.ts       # Test utility functions
```
```

---

## 🔐 Authentication & Security

### How Auth Works

```
┌──────────┐                    ┌──────────┐                    ┌──────────┐
│  Browser │                    │  NestJS  │                    │    DB    │
└────┬─────┘                    └────┬─────┘                    └────┬─────┘
     │                               │                              │
     │  POST /auth/login             │                              │
     │  { username, password }       │                              │
     │──────────────────────────────>│                              │
     │                               │  Verify credentials         │
     │                               │─────────────────────────────>│
     │                               │<─────────────────────────────│
     │                               │                              │
     │  200 OK                       │                              │
     │  Set-Cookie: auth_token=...   │                              │
     │  Set-Cookie: refresh_token=.. │                              │
     │  { user: {...} }              │                              │
     │<──────────────────────────────│                              │
     │                               │                              │
     │  GET /products (cookie auto)  │                              │
     │  Cookie: auth_token=...       │                              │
     │──────────────────────────────>│                              │
     │                               │  Validate JWT from cookie    │
     │                               │  (fallback: Bearer header)   │
     │                               │  Check tenant rate limit     │
     │                               │  (skip CSRF for GET)        │
     │                               │                              │
     │  200 OK { data: [...], total }│                              │
     │<──────────────────────────────│                              │
     │                               │                              │
     │  POST /sales (unsafe method)  │                              │
     │  Cookie: auth_token=...       │                              │
     │  X-CSRF-Token: abc123...      │                              │
     │──────────────────────────────>│                              │
     │                               │  Validate JWT + CSRF token  │
     │                               │  Log audit trail             │
     │                               │                              │
     │  201 Created                  │                              │
     │<──────────────────────────────│                              │
```

### Security Features

| Feature | Implementation |
|---------|---------------|
| **Password Hashing** | bcrypt with cost factor 12 |
| **JWT Storage** | HttpOnly cookie (not accessible via JavaScript) |
| **Token Refresh** | Rotation — old token revoked on each refresh |
| **CSRF Protection** | Double-submit cookie pattern |
| **Brute Force Protection** | Account locked after 5 failed attempts (30 min) |
| **Rate Limiting** | 10 req/min for auth, 60 req/min general (per tenant) |
| **Input Validation** | `class-validator` whitelist + forbidNonWhitelisted |
| **SQL Injection** | Prevented by Prisma's parameterized queries |
| **XSS** | Helmet security headers + HttpOnly cookies |
| **Soft Delete** | No data is permanently deleted (`deletedAt` timestamp) |

---

## 🔌 API Endpoints

### 🔐 Authentication (Public)

| Method | Path | Rate Limit | Description |
|--------|------|------------|-------------|
| POST | `/auth/login` | 10/min | Login — sets HttpOnly cookies, returns `{ user }` |
| POST | `/auth/register` | 5/min | Register new store — auto-creates tenant + admin user |
| POST | `/auth/refresh` | 5/min | Refresh access token (reads `refresh_token` cookie) |
| POST | `/auth/google-login` | 5/min | Login via Google OAuth (Firebase ID token) |
| POST | `/auth/create-store` | 5/min | Create store for PlatformUser (Post-Google flow) |
| POST | `/auth/logout` | — | Logout (clears cookies + revokes refresh token) |
| GET | `/auth/csrf-token` | — | Get CSRF token (sets non-httpOnly `csrf_token` cookie) |
| GET | `/health` | — | Health check (DB connection, uptime) |

### 👥 Users (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/users` | Create user |
| GET | `/users` | List all users (paginated: `?skip=&take=`) |
| GET | `/users/:id` | Get user by ID |
| PATCH | `/users/:id` | Update user role |
| DELETE | `/users/:id` | Soft delete user |
| PATCH | `/users/:id/change-password` | Change own password (JWT) |

### 🏷️ Categories

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/categories` | Admin | Create category |
| GET | `/categories` | JWT | List all (paginated) |
| GET | `/categories/:id` | JWT | Get by ID |
| PATCH | `/categories/:id` | Admin | Update category |
| DELETE | `/categories/:id` | Admin | Soft delete category |

### 📦 Products

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/products` | Admin | Create product |
| GET | `/products` | JWT | List all (`?search=&categoryId=&supplierId=&skip=&take=`) |
| GET | `/products/:id` | JWT | Get by ID |
| PATCH | `/products/:id` | Admin | Update product |
| DELETE | `/products/:id` | Admin | Soft delete product |

### 📊 Inventory / Stock

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/inventory` | JWT | List stock transactions (paginated) |
| GET | `/inventory/stock` | JWT | Get current stock for all products |
| POST | `/inventory/adjust` | Admin/Staff | Adjust stock (IN/OUT/ADJUSTMENT) |

### 🛒 Sales Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/sales` | Admin/Staff | Create sales order (auto stock deduction) |
| POST | `/sales/pending` | Admin/Staff | Create pending order |
| GET | `/sales` | JWT | List sales orders (paginated) |
| GET | `/sales/:id` | JWT | Get by ID |
| PATCH | `/sales/:id/complete` | Admin/Staff | Complete order |
| PATCH | `/sales/:id/cancel` | Admin/Staff | Cancel order (auto stock reversal) |

### 🚚 Purchase Orders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/purchase` | Admin/Staff | Create purchase order |
| POST | `/purchase/pending` | Admin/Staff | Create pending purchase |
| GET | `/purchase` | JWT | List purchase orders (paginated) |
| GET | `/purchase/:id` | JWT | Get by ID |
| PATCH | `/purchase/:id/receive` | Admin/Staff | Receive order (auto stock IN) |
| PATCH | `/purchase/:id/cancel` | Admin/Staff | Cancel purchase order |
| GET | `/purchase/supplier-summary/:id` | JWT | Purchase summary by supplier |

### ↩️ Sales Returns

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/returns` | Admin/Staff | Create return (auto stock reversal + financial correction) |
| GET | `/returns` | JWT | List returns (paginated) |
| GET | `/returns/:id` | JWT | Get by ID |

### 📈 Dashboard (JWT)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/dashboard/summary` | Counts, revenue, low stock alerts |
| GET | `/dashboard/top-products` | Top selling products |
| GET | `/dashboard/sales-trend` | Sales trend over last N days |
| GET | `/dashboard/inventory-value` | Total stock value |

### 📑 Reports (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/reports/sales` | Sales report (filter by date range) |
| GET | `/reports/inventory` | Full inventory report |
| GET | `/reports/profit-loss` | Profit & loss report |

### 📤 Upload (Admin Only)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/upload/image` | Upload product image (max 5MB, jpeg/png/gif/webp only) |

### 🔌 AI Data (for Python AI Service — internal)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/ai-data/products` | Get all products for AI context |
| GET | `/ai-data/sales` | Get sales data for AI analysis |
| GET | `/ai-data/inventory` | Get inventory data for AI querying |
| GET | `/ai-data/dashboard` | Get dashboard summary for AI |
| GET | `/ai-data/categories` | Get categories for AI |
| GET | `/ai-data/suppliers` | Get suppliers for AI |
| GET | `/ai-data/users` | Get tenant users for AI |

### 🛡️ Super Admin

| Method | Path | Description |
|--------|------|-------------|
| POST | `/admin/login` | Super admin login |
| GET | `/admin/tenants` | List all tenants + stats |
| GET | `/admin/tenants/:id` | Get tenant details |
| GET | `/admin/stats` | Platform-wide statistics |

### 📋 Activity Log

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/activity-log` | JWT | List activity logs (paginated, filtered) |

### 🤖 AI Chat (JWT)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/ai/chat` | Send message to AI assistant |
| GET | `/ai/chat/history` | Get chat history |
| DELETE | `/ai/chat/history` | Clear chat history |

### 📖 API Documentation

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api` | Swagger UI (interactive API docs) |

---

## 🗃️ Database Schema

```
Tenant ──┬── TenantUser ──── RefreshToken
         ├── PlatformMember ── PlatformUser
         ├── Product ──────── Category, Supplier
         ├── StockTransaction
         ├── SalesOrder ───── OrderItem
         ├── SalesReturn ──── SalesReturnItem
         ├── PurchaseOrder ── PurchaseOrderItem
         └── ActivityLog
```

### Entity Relationships

| Entity | Description | Key Fields |
|--------|-------------|------------|
| **Tenant** | Toko (store) — root of multi-tenant isolation | `name`, `slug`, `aiApiKey`, `aiTokens` |
| **PlatformUser** | User global (email/password login) | `email`, `googleId` |
| **TenantMember** | Relasi PlatformUser → Tenant | `role` (OWNER/MEMBER) |
| **TenantUser** | User dalam toko (login ke POS) | `username`, `role` (ADMIN/STAFF/CASHIER) |
| **Product** | Produk dengan SKU & harga | `sku`, `name`, `price`, `stockQuantity`, `image` |
| **Category** | Kategori produk | `name` |
| **Supplier** | Pemasok | `name`, `phone`, `email` |
| **StockTransaction** | Riwayat stok (ledger) | `type` (IN/OUT/ADJUSTMENT/RETURN), `quantity`, `notes` |
| **SalesOrder** | Pesanan penjualan | `status`, `totalPrice`, `totalProfit`, `totalCost` |
| **OrderItem** | Item dalam pesanan | `quantity`, `price`, `productId` |
| **PurchaseOrder** | Pesanan pembelian | `status`, `totalPrice`, `notes` |
| **PurchaseOrderItem** | Item dalam pembelian | `quantity`, `price`, `productId` |
| **SalesReturn** | Retur penjualan | `status`, `totalRefund`, `reason` |
| **SalesReturnItem** | Item dalam retur | `quantity`, `refundAmount`, `productId` |
| **ActivityLog** | Catatan audit | `action`, `entity`, `metadata` (JSON), `performedBy` |
| **RefreshToken** | Token refresh JWT | `token` (hashed), `expiresAt`, `revokedAt` |

---

## 🔐 Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | — | JWT signing secret (min 64 chars, use `openssl rand -hex 64`) |
| `PORT` | ❌ | `3000` | Server port |
| `ALLOWED_ORIGINS` | ❌ | `http://localhost:5173,http://localhost:3001` | CORS allowed origins |
| `DEFAULT_ADMIN_PASSWORD` | ❌ | — | Seed admin password |
| `DEFAULT_STAFF_PASSWORD` | ❌ | — | Seed staff password |
| `UPLOAD_DIR` | ❌ | `./uploads` | Upload directory for product images |
| `AI_SERVICE_URL` | ❌ | `http://localhost:8001` | Python AI service URL |
| `AI_INTERNAL_API_KEY` | ✅ | — | Internal API key for BE↔AI communication |
| `GOOGLE_CLIENT_ID` | ❌ | — | Google OAuth client ID (required for Google login) |
| `POSTGRES_PASSWORD` | ❌ | — | PostgreSQL password (used in docker-compose) |

---

## ⚠️ Error Handling

All errors follow a consistent JSON format:

```json
{
  "statusCode": 400,
  "message": "Validation failed",
  "errors": ["username must be a string", "password must be longer than 8 characters"],
  "timestamp": "2026-05-05T12:00:00.000Z"
}
```

### HTTP Status Codes Used

| Code | Description |
|------|-------------|
| 200 | Success (GET, PATCH) |
| 201 | Created (POST) |
| 400 | Validation error / Bad request |
| 401 | Unauthorized (missing/invalid JWT) |
| 403 | Forbidden (wrong role) or CSRF validation failed |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, username, etc.) |
| 429 | Rate limit exceeded |
| 500 | Internal server error |
| 503 | Backend service unavailable |

### Response Envelope (Success)

```json
{
  "statusCode": 200,
  "message": "Success",
  "data": { ... },
  "timestamp": "2026-05-05T12:00:00.000Z"
}
```

For paginated endpoints, `data` contains:
```json
{
  "data": [ ... ],
  "total": 42,
  "skip": 0,
  "take": 10
}
```

---

## ⚡ Scripts

| Script | Description |
|--------|-------------|
| `npm run start:dev` | Start in watch mode with hot reload |
| `npm run start:prod` | Start production server |
| `npm run start:migrate` | Run migrations then start production server |
| `npm run build` | Build for production |
| `npm run lint` | Lint all files (ESLint + Prettier) |
| `npm run format` | Format code with Prettier |
| `npm run test` | Run unit tests (Jest) |
| `npm run test:cov` | Run tests with coverage report |
| `npm run test:e2e` | Run end-to-end tests |
| `npx prisma migrate dev` | Run database migrations (dev) |
| `npx prisma migrate deploy` | Run database migrations (production) |
| `npx prisma db seed` | Seed default users & data |
| `npx prisma studio` | Open Prisma Studio (DB browser GUI) |
| `npx prisma generate` | Regenerate Prisma client after schema changes |

---

## 🐳 Docker

Project includes a `docker-compose.yml` with 3 services:

| Service | Container | Port | Description |
|---------|-----------|------|-------------|
| **db** | `crack-db` | 5433:5432 | PostgreSQL 17 Alpine |
| **backend** | `crack-be` | 8080:8080 | NestJS API server |
| **ai** | `crack-ai` | 8001:8001 | Python AI microservice |

```bash
# Build & start all services
docker compose up -d

# Build specific service
docker compose build backend

# Rebuild from scratch (no cache)
docker compose build --no-cache backend

# View logs
docker compose logs -f backend

# Stop all services
docker compose down

# Single Docker image build
docker build -t crackpos-backend .

# Run standalone with PostgreSQL
docker run -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e JWT_SECRET="your-secret" \
  -e AI_INTERNAL_API_KEY="your-key" \
  crackpos-backend
```

> Note: The backend container uses port **8080** (not 3000) in the docker-compose setup. The default port is 3000 when running locally via `npm run start:dev`.

---

## 🧪 Testing

### Test Coverage

![Statements](https://img.shields.io/badge/statements-40.85%25-orange.svg?style=flat)
![Branches](https://img.shields.io/badge/branches-36.45%25-red.svg?style=flat)
![Functions](https://img.shields.io/badge/functions-44.17%25-orange.svg?style=flat)
![Lines](https://img.shields.io/badge/lines-40.61%25-orange.svg?style=flat)

**Overall Test Coverage: ~41%** (Target: 75%+)

**Test Suite:** 260 tests across 25 test files (all passing ✅)

### Running Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e

# Run specific test file
npm test -- users.service.spec.ts

# View coverage report in browser
open coverage/lcov-report/index.html
```

### Coverage by Module

#### ✅ Well-Tested (>70% coverage)
| Module | Coverage | Description |
|--------|----------|-------------|
| **Guards** | 74.71% | CSRF, JWT, Roles, Tenant Throttler |
| **Sales** | 68.75% | Order creation, completion, cancellation |
| **Purchase** | 67.82% | Purchase orders, receiving, supplier summary |
| **Returns** | 67.5% | Sales returns with stock reversal |
| **Auth** | 65.02% | Login, register, JWT, refresh tokens, OAuth |
| **Users** | 62.5% | User CRUD, password changes |
| **Filters** | 62.12% | HTTP & Prisma exception handling |

#### ⚠️ Moderate Coverage (40-70%)
| Module | Coverage | Description |
|--------|----------|-------------|
| **AI Service** | 58.46% | Chat functionality, token validation |
| **Health** | 55.88% | Health check endpoints |
| **Upload** | 48.71% | File upload validation |
| **Products** | 47.45% | Product CRUD operations |
| **Dashboard** | 45.28% | Analytics and reporting |
| **Admin** | 44.56% | Tenant management |
| **Inventory** | 43.18% | Stock tracking |
| **Categories/Suppliers** | 42.3% | Basic CRUD |
| **Reports** | 41.22% | Report generation |
| **Activity Log** | 39.47% | Audit trail |

#### ❌ Needs Improvement (<40%)
| Module | Coverage | Status |
|--------|----------|--------|
| **All Controllers** | 0% | API endpoints not yet tested |
| **Interceptors** | 26.92% | Audit log interceptor needs tests |
| **Middleware** | 0% | Sanitize middleware |
| **Strategies** | 0% | JWT strategy |
| **DTOs** | 0% | Validation rules |

### Test Structure

```
src/
├── module-name/
│   ├── module-name.controller.ts
│   ├── module-name.controller.spec.ts    # Controller tests
│   ├── module-name.service.ts
│   ├── module-name.service.spec.ts       # Service tests
│   └── dto/
│       └── *.dto.spec.ts                 # DTO validation tests
├── common/
│   ├── guards/
│   │   └── *.guard.spec.ts               # Guard tests
│   ├── interceptors/
│   │   └── *.interceptor.spec.ts         # Interceptor tests
│   └── filters/
│       └── *.filter.spec.ts              # Filter tests
└── test/
    ├── fixtures/                          # Test data
    └── utils/                             # Test utilities
```

### Writing Tests

#### Service Test Example

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { MyService } from './my.service';
import { PrismaService } from '../prisma.service';

describe('MyService', () => {
  let service: MyService;
  let prisma: PrismaService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MyService,
        {
          provide: PrismaService,
          useValue: {
            getClient: jest.fn().mockReturnValue({
              myModel: {
                findMany: jest.fn(),
                create: jest.fn(),
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<MyService>(MyService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('should return an array of items', async () => {
      const mockData = [{ id: '1', name: 'Test' }];
      const mockClient = prisma.getClient('tenant-1');
      jest.spyOn(mockClient.myModel, 'findMany').mockResolvedValue(mockData);

      const result = await service.findAll('tenant-1');
      
      expect(result).toEqual(mockData);
    });
  });
});
```

#### Guard Test Example

```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MyGuard } from './my.guard';

describe('MyGuard', () => {
  let guard: MyGuard;
  let reflector: Reflector;

  beforeEach(() => {
    reflector = new Reflector();
    guard = new MyGuard(reflector);
  });

  const createMockContext = (user: any): ExecutionContext => {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
      getHandler: jest.fn(),
      getClass: jest.fn(),
    } as unknown as ExecutionContext;
  };

  it('should allow access for authorized user', () => {
    const context = createMockContext({ id: 1, role: 'ADMIN' });
    expect(guard.canActivate(context)).toBe(true);
  });
});
```

#### Filter Test Example

```typescript
import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { MyExceptionFilter } from './my-exception.filter';

describe('MyExceptionFilter', () => {
  let filter: MyExceptionFilter;
  let mockResponse: any;
  let mockArgumentsHost: ArgumentsHost;

  beforeEach(() => {
    filter = new MyExceptionFilter();

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    mockArgumentsHost = {
      switchToHttp: () => ({
        getResponse: () => mockResponse,
        getRequest: jest.fn(),
      }),
    } as unknown as ArgumentsHost;
  });

  it('should handle exception correctly', () => {
    const exception = new Error('Test error');
    
    filter.catch(exception, mockArgumentsHost);

    expect(mockResponse.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(mockResponse.json).toHaveBeenCalled();
  });
});
```

### Testing Best Practices

1. **Test Organization**
   - ✅ One test file per source file
   - ✅ Group related tests using `describe` blocks
   - ✅ Use descriptive test names
   - ✅ Follow AAA pattern: Arrange, Act, Assert

2. **Mocking**
   - ✅ Mock external dependencies (database, HTTP calls)
   - ✅ Use `jest.fn()` for function mocks
   - ✅ Use `jest.spyOn()` to spy on existing methods
   - ✅ Reset mocks between tests

3. **Coverage Goals**
   - ✅ Aim for 75%+ overall coverage
   - ✅ Focus on business logic and critical paths
   - ✅ Test edge cases and error scenarios
   - ✅ Don't chase 100% at the expense of quality

4. **Async Testing**
   - ✅ Use `async/await` for async tests
   - ✅ Always return promises
   - ✅ Test promise rejections with `rejects.toThrow()`

### Common Testing Patterns

#### Testing Prisma Interactions

```typescript
const mockClient = {
  myModel: {
    findMany: jest.fn(),
    create: jest.fn(),
  },
};

prisma.getClient.mockReturnValue(mockClient);
```

#### Testing with Decimal Values

```typescript
import { Prisma } from '@prisma/client';

const mockData = {
  price: new Prisma.Decimal('99.99'),
};

// Convert to number for assertions
expect(Number(result.price)).toBe(99.99);
```

#### Testing Guards with Reflector

```typescript
jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['ADMIN']);
```

### Test Coverage Progress

#### Latest Improvements (29% → 41%)

**New Test Files Created:**
- ✅ Guards: CSRF, Roles, Tenant Throttler (74.71% coverage)
- ✅ Filters: HTTP Exception, Prisma Exception (62.12% coverage)
- ✅ Interceptors: Cache, Response (26.92% coverage)
- ✅ AI Service: Chat, token validation (58.46% coverage)
- ✅ Admin Service: Tenant management (44.56% coverage)
- ✅ Activity Log: CRUD operations (39.47% coverage)
- ✅ Upload: File validation (48.71% coverage)
- ✅ Health: Health checks (55.88% coverage)

**Added:** 115 new tests (+115 from 145 to 260 tests)

#### Next Steps to Reach 75% Coverage

1. **Priority 1: Controllers** (Estimated +20% coverage)
   - Test all 15 controllers
   - Request validation, response formatting, error handling

2. **Priority 2: Services** (Estimated +5% coverage)
   - Improve moderate coverage services

3. **Priority 3: Infrastructure** (Estimated +5% coverage)
   - JWT Strategy, Middleware, DTOs

4. **Priority 4: Integration Tests** (Estimated +5% coverage)
   - Multi-tenant scenarios, transactions

### Troubleshooting Tests

#### Common Issues

1. **"Cannot find module" errors**
   - Ensure `tsconfig.json` paths are configured
   - Check `moduleNameMapper` in Jest config

2. **Timeout errors**
   - Increase timeout: `jest.setTimeout(10000)`
   - Check for unresolved promises

3. **Mock not working**
   - Verify mock is created before test runs
   - Check correct import path
   - Reset mocks between tests

4. **Coverage not updating**
   - Delete `coverage/` directory and rerun
   - Verify test files match `testRegex` pattern
