# V.A.U.L.T Architecture Overview

V.A.U.L.T is a modern, serverless smart-door access and surveillance system designed to operate primarily on Cloudflare's Edge network, communicating with an ESP32 microcontroller at the physical door. 

This document outlines the architectural decisions, the data flow, and the component layout of the repository.

## 1. High-Level Overview

The system consists of three main components:
1.  **The Physical Hardware (ESP32)**: A microcontroller equipped with an OV2640 camera, a keypad, and a relay (to actuate a magnetic lock).
2.  **The Serverless Backend (Cloudflare Pages Functions + Hono)**: An API living on the edge that handles authentication, biometric analysis, data logging, and hardware orchestration.
3.  **The Admin Dashboard (React + Vite)**: A Single Page Application served globally via Cloudflare CDN for managing users, monitoring access logs, and configuring hardware settings.

---

## 2. Infrastructure & Storage (Cloudflare Ecosystem)

By leveraging Cloudflare, the system requires no traditional servers, keeping costs at zero and scalability infinite.

*   **Cloudflare Pages**: Hosts the React frontend.
*   **Cloudflare Pages Functions (Edge Workers)**: Executes the backend logic. We use [Hono](https://hono.dev/), a highly optimized web framework for Edge environments, to structure our REST API cleanly.
*   **Cloudflare D1**: A serverless SQLite database. Used via **Drizzle ORM** for strong typing. D1 stores Users, Access Logs, Temporary PINs, Hardware configurations, and Command queues.
*   **Cloudflare R2**: S3-compatible object storage. Used to securely store JPEG images captured by the ESP32 (doorbell ringing, motion detection, failed attempts, and face enrollment photos).

---

## 3. Repository Structure

The repository is structured as a unified monorepo:

```text
vault-cloudflare/
├── app/                       # React Frontend
│   ├── components/            # Reusable UI components (shadcn/ui)
│   ├── lib/                   # API client (api.ts) & TS Types (types.ts)
│   ├── routes/                # TanStack Router page definitions
│   └── router.tsx             # Frontend routing config
├── server/                    # Hono Backend Logic
│   ├── routes/                # Modularized API endpoints (auth, users, esp, etc.)
│   ├── utils/                 # Cryptography & helper functions
│   └── types.ts               # Cloudflare Environment Bindings
├── functions/
│   └── api/
│       └── [[route]].ts       # Cloudflare Pages catch-all entrypoint for the Hono router
├── drizzle/                   # Database schemas and migrations
├── docs/                      # Extensive API documentation for the ESP32
├── package.json               
└── wrangler.toml              # Cloudflare local & remote configuration
```

---

## 4. Hardware <-> Server Communication

The ESP32 communicates with the Cloudflare backend entirely via standard HTTP/HTTPS REST APIs. 

### Security
*   The ESP32 identifies itself via an `X-API-Key` header (`CAMERA_API_KEY`).
*   Offline fallback: The ESP32 periodically pulls down an encrypted SHA-256 copy of the Master PIN and active Temporary PINs. If the internet goes down, the door can still be opened securely.

### State & Orchestration
Because Cloudflare Workers are stateless and the ESP32 is often behind a strict NAT, we use a **Polling & Queueing Architecture**:
1.  When an Admin clicks "Unlock" on the dashboard, the backend creates a `COMMAND` record in D1 (`status="PENDING"`).
2.  The ESP32 polls the `GET /api/v1/esp/commands/pending` endpoint every 2 seconds.
3.  The ESP32 receives the command, fires the physical relay, and sends a `POST /api/v1/esp/commands/:id/ack` to resolve the command in the database.

---

## 5. Face Recognition Workflow

To keep the ESP32 lightweight and inexpensive, we offload the heavy machine learning processing to the cloud.

1.  **Capture**: The ESP32 captures a JPEG when motion is detected or a button is pressed, and uploads it to `POST /api/v1/upload`.
2.  **Storage**: The Hono backend saves the JPEG to R2 and writes a metadata row to D1.
3.  **Enrollment**: An Admin opens the Dashboard, selects a recent capture, and clicks "Enroll". 
4.  **Processing**: The backend fetches the image from R2, converts it to base64, and proxies it to the **Face++ API**.
5.  **Verification**: When a user arrives, the ESP32 uploads a photo to `POST /api/v1/face/verify`. The backend compares it against the Face++ FaceSet and returns a JSON `granted: true/false` to the microcontroller.

---

## 6. Frontend Architecture

*   **Vite**: Extremely fast local dev server and bundler.
*   **TanStack Router**: Type-safe routing.
*   **TanStack Query**: Data synchronization, caching, and mutation management. This eliminates the need for Redux or complex global state.
*   **Tailwind CSS + shadcn/ui**: Component-driven styling for a modern, sleek admin interface.
