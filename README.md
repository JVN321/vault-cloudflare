# vault-cloudflare

A Cloudflare-native rewrite of the V.A.U.L.T Vision-Based Access Control System.

## Stack

| Layer        | Technology |
|-------------|------------|
| Frontend    | React 19, Vite, TanStack Router, TanStack Query, TailwindCSS v4 |
| API         | Cloudflare Pages Functions + Hono |
| Database    | Cloudflare D1 (SQLite) via Drizzle ORM |
| Storage     | Cloudflare R2 (images) |
| Auth        | Cookie-based sessions (Workers) |
| Deployment  | Cloudflare Pages + Wrangler |

---

## Local Development

### Prerequisites

- Node.js ≥ 20
- pnpm (`npm i -g pnpm`)

---

### Option A: 100% Offline Testing (No Cloudflare Account Needed)

This is the fastest way to test the application. It runs entirely locally on your machine using SQLite and local directory emulators with no connection to the Cloudflare cloud.

#### 1. Install dependencies
```bash
pnpm install
```

#### 2. Seed the local database
This runs database migrations locally and seeds a default admin user:
```bash
pnpm db:seed
```
* **Default credentials:**
  * **Email:** `admin@vault.io`
  * **Password:** `admin123`

#### 3. Run the development servers (Two Terminals)


* **Terminal 1: Wrangler Pages dev server (Backend Emulator)**
  ```bash
  pnpm dev:api
  ```

* **Terminal 2: Vite dev server (Frontend)**
  ```bash
  pnpm dev
  ```

---

### Option B: Cloudflare Connected Testing (Requires Cloudflare Account)

Use this if you want to connect to remote Cloudflare services or prepare for deployment.

#### 1. Install dependencies
```bash
pnpm install
```

#### 2. Create D1 database
```bash
wrangler d1 create vault-db
# Copy the database_id output and paste it into wrangler.toml
```

#### 3. Apply migrations (local)
```bash
wrangler d1 migrations apply vault-db --local
```

#### 4. Create R2 bucket
```bash
wrangler r2 bucket create vault-images
```

#### 5. Set secrets
```bash
wrangler secret put SESSION_SECRET    # Any 32-char random string
wrangler secret put CAMERA_API_KEY   # Shared with your ESP32
```

#### 6. Run locally (Two Terminals)

* **Terminal 1: Wrangler Pages dev server**
  ```bash
  pnpm dev:api
  ```

* **Terminal 2: Vite dev server**
  ```bash
  pnpm dev
  ```

---

## Database Migrations

```bash
# Generate migration from schema changes
pnpm db:generate

# Apply locally
pnpm db:migrate

# Apply to production
pnpm db:migrate:prod

# View and manage local database using Drizzle Studio
pnpm db:studio
```

---

## Deployment

```bash
# Build the frontend
pnpm build

# Deploy to Cloudflare Pages
pnpm deploy
```

Or connect your GitHub repo to Cloudflare Pages for automatic deployments.

---

## ESP32 Integration

Your ESP32 firmware should send requests to:

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/sensor` | POST | `X-API-Key` header | Upload sensor readings (temp, humidity, voltage, motion) |
| `/api/v1/upload` | POST | `X-API-Key` header | Upload JPEG image to R2 |
| `/api/v1/latest` | GET | — | Get latest image metadata |
| `/api/v1/config` | GET | — | Get camera configuration |

**Example sensor payload:**
```json
{
  "camera_id": 1,
  "temperature": 24.5,
  "humidity": 60.2,
  "voltage": 3.3,
  "motion": false
}
```

**Example upload:**
```
POST /api/v1/upload?camera_id=1&motion=0
X-API-Key: <your-camera-api-key>
Content-Type: image/jpeg

<binary JPEG data>
```

---

## Project Structure

```
vault-cloudflare/
├── app/                    # React frontend
│   ├── components/
│   │   ├── ui/             # shadcn/ui components (copied from original)
│   │   └── vault/          # App-specific components
│   ├── lib/
│   │   ├── api.ts          # Frontend API client (calls Worker)
│   │   ├── types.ts        # Shared types (frontend + backend)
│   │   ├── mock-data.ts    # Fallback mock data
│   │   └── utils.ts
│   ├── routes/             # TanStack Router file-based routes
│   ├── main.tsx
│   ├── router.tsx
│   └── styles.css
├── functions/
│   └── api/
│       └── [[route]].ts    # Hono Worker (all /api/* routes)
├── drizzle/
│   ├── schema.ts           # Drizzle ORM schema
│   └── migrations/
│       └── 0001_initial_schema.sql
├── public/
├── drizzle.config.ts
├── vite.config.ts
├── wrangler.toml
└── package.json
```
