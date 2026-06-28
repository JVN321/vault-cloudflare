# V.A.U.L.T — API Reference

Base URL (local): `http://localhost:8788`  
Base URL (production): `https://<your-pages-domain>/`

All responses follow this envelope:
```json
{ "success": true,  "data": <payload> }
{ "success": false, "error": "message" }
```

---

## ═══════════════════════════════════════
## ESP32 DEVICE API
## ═══════════════════════════════════════

> All ESP32 endpoints require the `X-API-Key` header (or `?api_key=` query param).
> The key is set via `wrangler secret put CAMERA_API_KEY` and stored in `.dev.vars` locally.

---

### Authentication

Every ESP32 request must include:
```
X-API-Key: <your-camera-api-key>
```

---

### 1. Boot-time Configuration

#### `GET /api/v1/esp/config`

Call once on boot, then periodically (every 60 s) to pick up dashboard changes.  
**Store the response in NVS** — see [ESP32 Persistent Memory](#esp32-persistent-memory-nvs).

**Response:**
```json
{
  "motion_detection": false,
  "upload_interval_ms": 5000,
  "poll_interval_ms": 2000,
  "master_pin_sha256": "e3b0c44298fc1c14...",
  "allow_pin_auth": true,
  "failed_attempt_limit": 3,
  "auto_lock_seconds": 30,
  "face_api_key": "YOUR_FACE_API_KEY",
  "face_api_secret": "YOUR_FACE_API_SECRET",
  "faceset_id": "VAULT_FACESET",
  "face_confidence_threshold": 60
}
```

| Field | Description |
|---|---|
| `motion_detection` | Whether to trigger image uploads on motion |
| `upload_interval_ms` | How often to upload images (ms) |
| `poll_interval_ms` | How often to poll for commands (ms) |
| `master_pin_sha256` | SHA-256 of the master PIN — cache in NVS |
| `allow_pin_auth` | Whether PIN auth is enabled |
| `failed_attempt_limit` | Lockout after N failures |
| `auto_lock_seconds` | Re-lock door after N seconds |
| `face_api_key` | Face++ API Key for ESP32 direct calls |
| `face_api_secret` | Face++ API Secret for ESP32 direct calls |
| `faceset_id` | Face++ Faceset ID to use for enroll/verify |
| `face_confidence_threshold` | Minimum confidence to grant access |

---

### 2. Lock / Unlock Commands

The dashboard queues commands; the ESP32 polls and acknowledges them.

#### `GET /api/v1/esp/commands/pending`

Poll this endpoint every `poll_interval_ms` milliseconds.  
Returns the oldest pending command (or `null`) **and** the current `livestream` flag.

**Response:**
```json
{
  "command": {
    "id": 42,
    "type": "UNLOCK",
    "status": "PENDING",
    "expiresAt": "2024-01-01T12:00:30.000Z",
    "createdAt": "2024-01-01T12:00:00.000Z"
  },
  "livestream": false
}
```

**Response (no pending command, livestream active):**
```json
{ "command": null, "livestream": true }
```

`command.type` values: `LOCK` | `UNLOCK` | `PULSE` (unlock for 10 s then re-lock)

> **Commands expire** after 30 s (default). If the ESP32 is offline, the command is discarded automatically.

---

#### `POST /api/v1/esp/commands/:id/ack`

Acknowledge a command after executing it (success or failure).

**Request body:**
```json
{ "success": true }
```

**Response:**
```json
{
  "id": 42,
  "type": "UNLOCK",
  "status": "EXECUTED",
  "executed_at": "2024-01-01T12:00:02.000Z"
}
```

**Typical ESP32 loop:**
```
poll /esp/commands/pending
  → null? sleep poll_interval_ms, repeat
  → cmd?
      execute relay (LOCK / UNLOCK / PULSE)
      POST /esp/commands/:id/ack  { success: true }
      sleep poll_interval_ms, repeat
```

---

### 3. PIN Authentication

#### `POST /api/v1/esp/auth/pin`

Verifies a PIN against the master PIN and all active temporary PINs.  
Also increments `use_count` on temp PINs and marks them `USED` when exhausted.

**Request body:**
```json
{ "pin": "1234" }
```

**Response (granted — master PIN):**
```json
{ "granted": true, "type": "master" }
```

**Response (granted — temporary PIN):**
```json
{ "granted": true, "type": "temp", "temp_pin_id": 7, "label": "Plumber visit" }
```

**Response (denied — HTTP 401):**
```json
{ "success": false, "error": "Invalid PIN" }
```

> **Offline fallback:** The ESP32 can also verify PINs locally using the cached SHA-256 hashes from NVS/RAM (see below). Call this endpoint anyway when online to log the event and decrement temp PIN uses.

---

### 4. Temporary PINs (Sync)

#### `GET /api/v1/esp/temp-pins`

Returns all currently active temporary PINs including their SHA-256 hashes.  
**Cache in RAM** — refresh every 30 s or immediately after a successful `/esp/auth/pin` call.

**Response:**
```json
[
  {
    "id": 7,
    "sha256": "a665a45920422f9d...",
    "expires_at": "2024-01-01T18:00:00.000Z",
    "max_uses": 3,
    "use_count": 1
  }
]
```

---

### 5. Sensor Data

#### `POST /api/v1/sensor`

Push sensor readings from the ESP32 to D1.

**Request body:**
```json
{
  "camera_id": 1,
  "temperature": 24.5,
  "humidity": 60.2,
  "voltage": 3.3,
  "motion": false
}
```

All fields optional except used for context.

---

### 6. Image Upload

#### `POST /api/v1/upload?camera_id=1&motion=0`

Upload a JPEG frame to R2. Use `motion=1` if motion triggered the capture.

**Headers:**
```
Content-Type: image/jpeg
X-API-Key: <key>
```

**Body:** raw JPEG binary

**Response:**
```json
{
  "id": 12,
  "object_key": "images/1700000000000-uuid.jpg",
  "motion_detected": false,
  "file_size": 34821
}
```

---

### 7. Latest Image Metadata

#### `GET /api/v1/latest`

Returns metadata for the most recently uploaded image (no auth required).

---

### 8. Legacy Config (deprecated)

#### `GET /api/v1/config`

Use `GET /api/v1/esp/config` instead. Kept for backwards compatibility.

---

## ═══════════════════════════════════════
## DASHBOARD API
## ═══════════════════════════════════════

> Dashboard endpoints use **cookie-based session auth**.  
> Sign in first with `POST /api/v1/auth/signin` — the session cookie is set automatically.

---

### Authentication

#### `POST /api/v1/auth/signin`
```json
{ "email": "admin@vault.io", "password": "admin123" }
```
Sets `vault_session` cookie (24 h TTL).

#### `POST /api/v1/auth/signout`
Clears the session cookie.

#### `GET /api/v1/auth/me`
Returns the currently authenticated user.

---

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/users` | List all users |
| `GET` | `/api/v1/users/:id` | Get single user |
| `POST` | `/api/v1/users` | Create user |
| `POST` | `/api/v1/users/enroll-face` | Create user & enroll face from stored image |
| `PUT` | `/api/v1/users/:id` | Update user |
| `PATCH` | `/api/v1/users/:id/access` | Update status / allowed auth methods |
| `DELETE` | `/api/v1/users/:id` | Delete user |

**Create user body:**
```json
{
  "username": "jsmith",
  "email": "j@vault.io",
  "password": "secret",
  "name": "John Smith",
  "role": "EMPLOYEE",
  "department": "Engineering"
}
```

**Enroll face body:**
```json
{
  "name": "John Smith",
  "objectKey": "images/1700000000000-uuid.jpg"
}
```

---

### Commands (Lock / Unlock)

#### `POST /api/v1/commands`
Queue a lock/unlock command for the ESP32.
```json
{ "type": "UNLOCK", "expiresInSecs": 30 }
```
`type`: `LOCK` | `UNLOCK` | `PULSE`

#### `GET /api/v1/commands?limit=50`
List recent commands and their execution status.

---

### Temporary PINs

#### `GET /api/v1/temp-pins`
List all temporary PINs (hashes are never returned to the dashboard).

#### `POST /api/v1/temp-pins`
Create a temporary PIN.
```json
{
  "pin": "8421",
  "label": "Plumber visit",
  "expiresAt": "2024-12-31T23:59:59.000Z",
  "maxUses": 1
}
```
- `pin`: 4–8 digits
- `expiresAt`: ISO 8601 datetime
- `maxUses`: how many times it can be used before auto-expiring (default: 1)

#### `DELETE /api/v1/temp-pins/:id`
Revoke a temporary PIN immediately.

---

### Master PIN

#### `PATCH /api/v1/settings/master-pin`
Set or change the master PIN. Stored as SHA-256 in the `settings` table.
```json
{ "pin": "9876" }
```

---

### Settings

#### `GET /api/v1/settings`
Returns all system settings as parsed values.

#### `PATCH /api/v1/settings`
Update one or more settings:
```json
{
  "motionDetection": true,
  "failedAttemptLimit": 5,
  "autoLockSeconds": 15
}
```

---

### Access Logs

#### `GET /api/v1/access-logs?limit=50`
List recent access events.

#### `POST /api/v1/access-logs`
Manually insert an access log entry.
```json
{
  "userId": 1,
  "method": "PIN",
  "success": true,
  "location": "Main Entrance",
  "action": "ENTRY"
}
```

---

### Images

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/images?limit=20` | List image metadata |
| `GET` | `/api/v1/images/latest` | Latest image metadata |
| `GET` | `/api/v1/images/serve/:key` | Serve image binary from R2 |

---

### Sensor

#### `GET /api/v1/sensor/latest`
Returns the most recent sensor reading.

---

## ESP32 Persistent Memory (NVS)

Store these values in **non-volatile storage (NVS / Preferences library)**.  
They survive reboots and should be updateable OTA via the config endpoint.

| NVS Key | Type | Source | Description |
|---|---|---|---|
| `wifi_ssid` | `string` | Provisioned once | WiFi network name |
| `wifi_pass` | `string` | Provisioned once | WiFi password |
| `server_url` | `string` | Provisioned once | e.g. `https://your-domain.pages.dev` |
| `api_key` | `string` | Provisioned once | `CAMERA_API_KEY` value |
| `master_pin_sha256` | `string` | `GET /esp/config` | SHA-256 of master PIN for offline verify |
| `last_cmd_id` | `int` | After each ack | Prevents re-executing commands after reboot |
| `lock_state` | `string` | After each command | `LOCKED` or `UNLOCKED` — resume correct state on boot |
| `poll_interval_ms` | `int` | `GET /esp/config` | Command poll interval |
| `auto_lock_secs` | `int` | `GET /esp/config` | Auto-relock delay |
| `failed_attempts` | `int` | Locally tracked | Reset to 0 on successful auth |

---

## ESP32 RAM Cache (refresh periodically, not persisted)

| Variable | Source | Refresh Interval | Description |
|---|---|---|---|
| `temp_pins[]` | `GET /esp/temp-pins` | Every 30 s | Active temp PINs for offline local verify |
| `motion_detection` | `GET /esp/config` | Every 60 s | Whether to capture on motion |
| `upload_interval_ms` | `GET /esp/config` | Every 60 s | Image upload cadence |

---

## Recommended ESP32 Polling Schedule

```
On boot:
  1. Connect WiFi
  2. GET /esp/config           → save to NVS + RAM
  3. GET /esp/temp-pins        → cache in RAM

Main loop (every poll_interval_ms, default 2 s):
  4. GET /esp/commands/pending
       → if cmd: execute relay, POST /esp/commands/:id/ack

Every 30 s:
  5. GET /esp/temp-pins        → refresh RAM cache

Every 60 s:
  6. GET /esp/config           → update NVS if changed

On keypad input:
  7a. SHA-256(input) == master_pin_sha256 (NVS) → grant locally
  7b. SHA-256(input) in temp_pins[] RAM cache   → grant locally + POST /esp/auth/pin (to log + decrement use_count)
  7c. Neither                                   → deny, increment failed_attempts
```

---

## SHA-256 on ESP32 (mbedTLS)

The server uses plain SHA-256 (no salt) for PIN hashes, making it easy to replicate on the ESP32:

```cpp
#include "mbedtls/md.h"

String sha256(const String &input) {
  byte hash[32];
  mbedtls_md_context_t ctx;
  mbedtls_md_init(&ctx);
  mbedtls_md_setup(&ctx, mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), 0);
  mbedtls_md_starts(&ctx);
  mbedtls_md_update(&ctx, (const unsigned char*)input.c_str(), input.length());
  mbedtls_md_finish(&ctx, hash);
  mbedtls_md_free(&ctx);
  String result = "";
  for (int i = 0; i < 32; i++) {
    if (hash[i] < 0x10) result += "0";
    result += String(hash[i], HEX);
  }
  return result;
}

// Usage:
bool isMasterPin(const String &entered) {
  return sha256(entered) == nvs.getString("master_pin_sha256");
}
```

---

## Face Recognition (Face++ API)

> Requires `FACEPLUSPLUS_API_KEY` and `FACEPLUSPLUS_API_SECRET` set as Wrangler secrets.  
> Configure in `.dev.vars` locally:
> ```
> FACEPLUSPLUS_API_KEY=your_key
> FACEPLUSPLUS_API_SECRET=your_secret
> ```

The ESP32 sends raw JPEG binary to the server; the server proxies to Face++ and returns the verdict. The `faceset_id` and `face_confidence_threshold` are configurable via `PATCH /api/v1/settings`.

### `POST /api/v1/face/enroll?name=PersonName`
Enroll a new face. The server detects the face, adds it to the faceset, sets the user ID (name), and triggers training. Creates the faceset automatically if it doesn't exist yet.

**Headers:** `X-API-Key`, `Content-Type: image/jpeg`  
**Body:** raw JPEG binary

**Response:**
```json
{ "status": "enrolled", "name": "John Smith" }
```

**Errors:**
- `400` — No face detected in image
- `503` — Face++ credentials not configured

---

### `POST /api/v1/face/verify`
Verify a face against the enrolled faceset. Logs the result to `access_logs`.

**Headers:** `X-API-Key`, `Content-Type: image/jpeg`  
**Body:** raw JPEG binary

**Response (granted):**
```json
{ "granted": true, "name": "John Smith", "confidence": 87.3 }
```

**Response (denied):**
```json
{ "granted": false, "name": "Unknown", "confidence": 42.1 }
```

The `confidence` threshold defaults to `60` and is configurable in Settings.

---

## Image Retention & Gallery

### Auto-deletion
Images older than `image_retention_days` (default: **30 days**) are automatically purged from both R2 storage and the D1 database. Cleanup runs opportunistically on each `GET /api/v1/images` request (up to 10 images per request). Change the retention period via `PATCH /api/v1/settings` with `{ "image_retention_days": 14 }`.

### `DELETE /api/v1/images/:id`  (Dashboard)
Delete a single image immediately from both R2 and D1.

### `POST /api/v1/images/cleanup`  (Dashboard)
Manually trigger a full cleanup sweep, removing all images older than the retention period.

**Response:**
```json
{ "deleted": 12, "cutoff": "2024-06-01T00:00:00.000Z" }
```

### `GET /api/v1/images/serve/:key?download=1`
Add `?download=1` to force a browser download instead of inline display. The `Content-Disposition: attachment` header is set automatically.

---

## Dashboard-only Secrets to Configure

| Secret | How to set | Purpose |
|---|---|---|
| `FACEPLUSPLUS_API_KEY` | `wrangler secret put FACEPLUSPLUS_API_KEY` | Face++ API key |
| `FACEPLUSPLUS_API_SECRET` | `wrangler secret put FACEPLUSPLUS_API_SECRET` | Face++ API secret |
| `SESSION_SECRET` | `wrangler secret put SESSION_SECRET` | Cookie signing |
| `CAMERA_API_KEY` | `wrangler secret put CAMERA_API_KEY` | ESP32 auth key |
| `ADMIN_EMAIL` | `wrangler secret put ADMIN_EMAIL` | Env-admin login email |
| `ADMIN_PASSWORD` | `wrangler secret put ADMIN_PASSWORD` | Env-admin login password |

---

## Livestream

The dashboard can request a **live video feed** from the ESP32. When active, the device uploads frames at a high rate to a fixed R2 key; the dashboard polls that key every ~500 ms and renders the latest frame.

### How it works

```
Dashboard           Worker              ESP32
   |                  |                   |
   |─ POST /api/v1/livestream {active:true}─▶|
   |                  |── writes livestream_active=true to D1
   |                  |                   |
   |         (next poll cycle)             |
   |                  |◀─ GET /esp/commands/pending ──|
   |                  |── { command: null, livestream: true }─▶|
   |                  |                   |
   |                  |        ESP32 starts high-rate capture
   |                  |◀─ POST /esp/livestream (JPEG bytes) ──|
   |                  |── overwrite R2 key: livestream/frame-latest.jpg
   |                  |                   |
   |◀─ GET /api/v1/livestream/frame ──────|
   |── renders frame in <img> tag         |
   |   (repeats every 500 ms)             |
```

### Dashboard endpoints

#### `POST /api/v1/livestream`  (Dashboard, requires session)

Toggle livestream on or off.

**Request body:**
```json
{ "active": true }
```

**Response:**
```json
{ "livestreamActive": true }
```

#### `GET /api/v1/livestream/frame`  (Public — no session)

Serve the latest frame from R2.  
Returns `404` if no frame has been uploaded yet.

```
Content-Type: image/jpeg
Cache-Control: no-store
```

---

### ESP32 implementation

#### 1. Check `livestream` flag on every poll

```cpp
// After parsing the /esp/commands/pending JSON response:
bool livestream_active = doc["livestream"].as<bool>();
JsonObject command     = doc["command"];

// Handle the command as before...
if (!command.isNull()) {
  String type = command["type"].as<String>();
  // ... execute LOCK / UNLOCK / PULSE ...
  ackCommand(command["id"].as<int>(), true);
}

// Adjust frame capture rate
if (livestream_active) {
  startLivestreamMode();   // 5–10 fps
} else {
  stopLivestreamMode();    // back to normal interval
}
```

#### 2. Upload frames to `/api/v1/esp/livestream`

```
POST /api/v1/esp/livestream
X-API-Key: <CAMERA_API_KEY>
Content-Type: image/jpeg

<raw JPEG bytes>
```

**Response (accepted):**
```json
{ "accepted": true, "objectKey": "livestream/frame-latest.jpg" }
```

**Response (livestream off — device should slow down):**
```json
{ "accepted": false, "reason": "livestream_off" }
```

> The Worker rejects frames when `livestream_active = false` in D1 so the device can't exhaust R2 write limits when the dashboard isn't watching.

#### 3. Suggested Arduino loop

```cpp
// Globals
bool  g_livestream = false;
ulong g_last_frame = 0;
const uint LIVESTREAM_INTERVAL_MS = 200; // ~5 fps
const uint NORMAL_INTERVAL_MS     = 5000;

void loop() {
  ulong now = millis();

  // Poll commands (always at configured interval)
  if (now - g_last_poll >= poll_interval_ms) {
    g_last_poll = now;
    pollCommands();  // sets g_livestream
  }

  // Capture + upload frame if livestream is on
  uint frame_interval = g_livestream ? LIVESTREAM_INTERVAL_MS : NORMAL_INTERVAL_MS;
  if (now - g_last_frame >= frame_interval) {
    g_last_frame = now;
    camera_fb_t *fb = esp_camera_fb_get();
    if (fb) {
      if (g_livestream) {
        uploadFrame("/api/v1/esp/livestream", fb->buf, fb->len);
      } else if (motion_detected) {
        uploadFrame("/api/v1/upload", fb->buf, fb->len);
      }
      esp_camera_fb_return(fb);
    }
  }
}
```

#### 4. `uploadFrame` helper

```cpp
bool uploadFrame(const char* path, uint8_t* data, size_t len) {
  HTTPClient http;
  String url = String(SERVER_URL) + path + "?api_key=" + CAMERA_API_KEY;
  http.begin(url);
  http.addHeader("Content-Type", "image/jpeg");
  http.addHeader("X-API-Key", CAMERA_API_KEY);
  int code = http.POST(data, len);
  bool ok  = (code == 200);
  http.end();
  return ok;
}
```

### Important notes

- **Only the latest frame is stored** — the Worker overwrites a fixed R2 key (`livestream/frame-latest.jpg`) on every upload, so storage never grows during a session.
- **Frames are not saved to D1** — they won't appear in the Images gallery.
- **The dashboard stops the livestream** when the page is unloaded or the Stop button is clicked, which sets `livestream_active = false` in D1. The ESP32 detects this on the next poll and resumes its normal interval.
- **Frame rate is limited by round-trip latency** (ESP32 → R2 → dashboard fetch). Realistic throughput is 2–5 fps over typical Wi-Fi + Cloudflare routing.

---

## Image Retention Settings

Two settings in the dashboard (Settings → Data Retention) control long-term storage behaviour:

| Setting key (DB) | Dashboard field | Default | Description |
|---|---|---|---|
| `image_retention_days` | Image retention (days) | 30 | Frames older than this are purged from R2 + D1 |
| `poll_interval_ms` | Device poll interval (ms) | 2000 | How often the ESP32 calls `/esp/commands/pending` |

Both are returned to the ESP32 in `GET /api/v1/esp/config` so the device always uses the dashboard-configured value after a reboot.
