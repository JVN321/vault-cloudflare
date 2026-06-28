import { Hono } from "hono";
import { eq, desc, and, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, hashPassword, verifyPassword, sha256Hex, arrayBufferToBase64, facePlusPlus, DEFAULT_SETTINGS, parseSettings } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();


// ESP32 endpoints


// POST /api/v1/sensor  – ingest sensor reading from ESP32
app.post("/api/v1/sensor", async (c) => {
  // Verify camera API key
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);

  const db = drizzle(c.env.DB, { schema });
  type SensorBody = {
    camera_id?: number;
    temperature?: number;
    humidity?: number;
    voltage?: number;
    motion?: boolean;
  };
  const body = await c.req.json<SensorBody>();

  const [reading] = await db
    .insert(schema.sensorReadings)
    .values({
      cameraId: body.camera_id ?? null,
      temperature: body.temperature ?? null,
      humidity: body.humidity ?? null,
      voltage: body.voltage ?? null,
      motion: body.motion ?? false,
    })
    .returning();

  return ok(reading);
});

// POST /api/v1/upload  – upload JPEG from ESP32 to R2, store metadata in D1
app.post("/api/v1/upload", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const cameraId = Number(c.req.query("camera_id") ?? "0") || null;
  const motionDetected = c.req.query("motion") === "1";

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty body");

  const objectKey = `images/${Date.now()}-${generateId()}.jpg`;
  await c.env.IMAGES.put(objectKey, body, {
    httpMetadata: { contentType: "image/jpeg" },
    customMetadata: {
      cameraId: String(cameraId ?? ""),
      motionDetected: String(motionDetected),
    },
  });

  const [imgRecord] = await db
    .insert(schema.images)
    .values({
      cameraId,
      objectKey,
      motionDetected,
      fileSize: body.byteLength,
      mimeType: "image/jpeg",
    })
    .returning();

  return ok(imgRecord);
});

// GET /api/v1/latest  – latest image metadata (ESP32 poll endpoint)
app.get("/api/v1/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [img] = await db
    .select()
    .from(schema.images)
    .orderBy(desc(schema.images.timestamp))
    .limit(1);
  return ok(img ?? null);
});

// GET /api/v1/config  – camera configuration for ESP32
app.get("/api/v1/config", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok({
    motionDetection: map["motionDetection"] === "true",
    uploadIntervalMs: 5000,
  });
});


// Auth: PIN – ESP32 auth endpoint

app.post("/api/v1/auth/pin", async (c) => {
  const apiKey = c.req.header("X-API-Key");
  const db = drizzle(c.env.DB, { schema });
  type PinBody = { pin?: string; user_id?: number };
  const body = await c.req.json<PinBody>();

  if (!body.pin) return err("PIN required");

  // Find all PIN credentials
  const pinCredentials = await db
    .select()
    .from(schema.credentials)
    .where(and(eq(schema.credentials.credentialType, "PIN"), eq(schema.credentials.active, true)));

  let matchedCred: (typeof pinCredentials)[0] | null = null;
  for (const cred of pinCredentials) {
    const valid = await verifyPassword(body.pin, cred.credentialValue);
    if (valid) { matchedCred = cred; break; }
  }

  if (!matchedCred) {
    await db.insert(schema.accessLogs).values({ method: "PIN", success: false });
    return err("Invalid PIN", 401);
  }

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, matchedCred.userId))
    .limit(1);

  if (!user || user.status !== "ACTIVE") {
    await db.insert(schema.accessLogs).values({ userId: matchedCred.userId, method: "PIN", success: false });
    return err("User inactive", 403);
  }

  await db.insert(schema.accessLogs).values({ userId: user.id, method: "PIN", success: true });
  return ok({ userId: user.id, name: user.name });
});


// Commands – Dashboard

app.post("/api/v1/commands", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type Body = { type?: string; expiresInSecs?: number };
  const body = await c.req.json<Body>().catch(() => ({}));
  if (!body.type || !["LOCK", "UNLOCK", "PULSE"].includes(body.type))
    return err("type must be LOCK, UNLOCK or PULSE");
  const expiresAt = new Date(Date.now() + (body.expiresInSecs ?? 30) * 1_000).toISOString();
  const [cmd] = await db
    .insert(schema.commands)
    .values({ type: body.type as schema.Command["type"], expiresAt })
    .returning();
  return ok(cmd);
});

app.get("/api/v1/commands", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);
  const rows = await db
    .select()
    .from(schema.commands)
    .orderBy(desc(schema.commands.createdAt))
    .limit(limit);
  return ok(rows);
});


// Commands – ESP32


// GET /api/v1/esp/commands/pending  — ESP32 polls every 1-2 s
app.get("/api/v1/esp/commands/pending", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // expire stale pending commands
  await db
    .update(schema.commands)
    .set({ status: "EXPIRED" })
    .where(and(eq(schema.commands.status, "PENDING"), lt(schema.commands.expiresAt, now)));
  const [cmd] = await db
    .select()
    .from(schema.commands)
    .where(and(eq(schema.commands.status, "PENDING"), gt(schema.commands.expiresAt, now)))
    .orderBy(schema.commands.createdAt)
    .limit(1);
  return ok(cmd ?? null);
});

// POST /api/v1/esp/commands/:id/ack  — ESP32 acknowledges after executing
app.post("/api/v1/esp/commands/:id/ack", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  const body = await c.req.json<{ success?: boolean }>().catch(() => ({}));
  const [cmd] = await db
    .update(schema.commands)
    .set({
      status: body.success === false ? "FAILED" : "EXECUTED",
      executedAt: new Date().toISOString(),
    })
    .where(eq(schema.commands.id, id))
    .returning();
  if (!cmd) return err("Command not found", 404);
  return ok(cmd);
});


// Temporary PINs – ESP32


// GET /api/v1/esp/temp-pins  — returns active hashes for local verification
app.get("/api/v1/esp/temp-pins", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // auto-delete expired
  await db
    .delete(schema.tempPins)
    .where(lt(schema.tempPins.expiresAt, now));
  const rows = await db
    .select()
    .from(schema.tempPins)
    .where(and(eq(schema.tempPins.status, "ACTIVE"), gt(schema.tempPins.expiresAt, now)));
  // return only what the ESP32 needs
  return ok(
    rows.map((r) => ({
      id: r.id,
      sha256: r.pinSha256,
      expires_at: r.expiresAt,
      max_uses: r.maxUses,
      use_count: r.useCount,
    }))
  );
});


// Master PIN – Dashboard

app.patch("/api/v1/settings/master-pin", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ pin?: string }>();
  if (!body.pin || !/^\d{4,8}$/.test(body.pin)) return err("pin must be 4-8 digits");
  const hash = await sha256Hex(body.pin);
  const existing = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "master_pin_sha256"))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.settings)
      .set({ value: hash, updatedAt: new Date().toISOString() })
      .where(eq(schema.settings.key, "master_pin_sha256"));
  } else {
    await db.insert(schema.settings).values({ key: "master_pin_sha256", value: hash });
  }
  return ok({ updated: true });
});


// ESP32 unified config (superset of /api/v1/config)

app.get("/api/v1/esp/config", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok({
    motion_detection: map["motionDetection"] === "true",
    upload_interval_ms: 5000,
    poll_interval_ms: Number(map["poll_interval_ms"] ?? "2000"),
    master_pin_sha256: map["master_pin_sha256"] ?? "",
    allow_pin_auth: map["allowPinAuth"] === "true",
    failed_attempt_limit: Number(map["failedAttemptLimit"] ?? "3"),
    auto_lock_seconds: Number(map["autoLockSeconds"] ?? "30"),
    face_api_key: map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY,
    face_api_secret: map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET,
    faceset_id: map["faceset_id"] || "VAULT_FACESET",
    face_confidence_threshold: Number(map["face_confidence_threshold"] ?? "60"),
  });
});


// ESP32 unified PIN auth (checks master PIN + temp PINs)

app.post("/api/v1/esp/auth/pin", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ pin?: string }>();
  if (!body.pin) return err("pin required");
  const inputHash = await sha256Hex(body.pin);
  const now = new Date().toISOString();

  // 1. Check master PIN
  const [masterRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "master_pin_sha256"))
    .limit(1);
  if (masterRow?.value && masterRow.value === inputHash) {
    await db.insert(schema.accessLogs).values({ method: "PIN", success: true });
    return ok({ granted: true, type: "master" });
  }

  // 2. Check active temp PINs
  const activePins = await db
    .select()
    .from(schema.tempPins)
    .where(and(eq(schema.tempPins.status, "ACTIVE"), gt(schema.tempPins.expiresAt, now)));
  const match = activePins.find((p) => p.pinSha256 === inputHash);
  if (match) {
    const newCount = match.useCount + 1;
    const newStatus = newCount >= match.maxUses ? "USED" : "ACTIVE";
    await db
      .update(schema.tempPins)
      .set({ useCount: newCount, status: newStatus })
      .where(eq(schema.tempPins.id, match.id));
    await db.insert(schema.accessLogs).values({ method: "PIN", success: true });
    return ok({ granted: true, type: "temp", temp_pin_id: match.id, label: match.label });
  }

  // 3. Denied
  await db.insert(schema.accessLogs).values({ method: "PIN", success: false });
  return err("Invalid PIN", 401);
});


// Helpers

function sanitizeUser(u: schema.User): Record<string, unknown> {
  const { passwordHash: _ph, ...rest } = u;
  return {
    ...rest,
    allowedAuthMethods: JSON.parse(u.allowedAuthMethods ?? "[]") as string[],
  };
}

function parseSettings(map: Record<string, string>): Record<string, unknown> {
  return {
    allowFaceAuth: map["allowFaceAuth"] === "true",
    allowPinAuth: map["allowPinAuth"] === "true",
    allowQrAuth: map["allowQrAuth"] === "true",
    allowBarcodeAuth: map["allowBarcodeAuth"] === "true",
    allowRfidAuth: map["allowRfidAuth"] === "true",
    failedAttemptLimit: Number(map["failedAttemptLimit"] ?? "3"),
    autoLockSeconds: Number(map["autoLockSeconds"] ?? "30"),
    realtimeAlerts: map["realtimeAlerts"] === "true",
    motionDetection: map["motionDetection"] === "true",
    faceplusplusApiKey: map["faceplusplusApiKey"] || "",
    faceplusplusApiSecret: map["faceplusplusApiSecret"] || "",
    faceplusplusFaceset: map["faceset_id"] || "VAULT_FACESET",
    faceConfidenceThreshold: Number(map["face_confidence_threshold"] ?? "60"),
  };
}

function generateTempCode(): string {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VLT-${seg()}-${seg()}`;
}



function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

async function facePlusPlus(
  endpoint: string,
  apiKey: string,
  apiSecret: string,
  extra: Record<string, string>
): Promise<Record<string, unknown>> {
  const fd = new FormData();
  fd.append("api_key", apiKey);
  fd.append("api_secret", apiSecret);
  for (const [k, v] of Object.entries(extra)) fd.append(k, v);
  const res = await fetch(`https://api-us.faceplusplus.com/facepp/v3/${endpoint}`, {
    method: "POST",
    body: fd,
  });
  return res.json() as Promise<Record<string, unknown>>;
}

// POST /api/v1/face/enroll?name=PersonName  — ESP32 sends raw JPEG
app.post("/api/v1/face/enroll", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  if (!c.env.FACEPLUSPLUS_API_KEY || !c.env.FACEPLUSPLUS_API_SECRET)
    return err("Face++ API credentials not configured", 503);

  const name = c.req.query("name") ?? "Unknown";
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty image body");
  const imageBase64 = arrayBufferToBase64(body);

  const db = drizzle(c.env.DB, { schema });
  const [fsetRow] = await db.select().from(schema.settings)
    .where(eq(schema.settings.key, "faceset_id")).limit(1);
  const facesetId = fsetRow?.value ?? "VAULT_FACESET";
  const faceApiKey = c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = c.env.FACEPLUSPLUS_API_SECRET;

  // 1. Detect
  const detected = await facePlusPlus("detect", faceApiKey, faceApiSecret, { image_base64: imageBase64 });
  const faces = detected.faces as Array<{ face_token: string }> | undefined;
  if (!faces?.length) return err("No face detected in image");
  const faceToken = faces[0].face_token;

  // 2. Add to faceset (create faceset if needed)
  const addResult = await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
    outer_id: facesetId, face_tokens: faceToken,
  });
  if ((addResult as { error_message?: string }).error_message?.includes("INVALID_OUTER_ID")) {
    // create faceset first
    await facePlusPlus("faceset/create", faceApiKey, faceApiSecret, {
      outer_id: facesetId, display_name: "Vault Access Faceset",
    });
    await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
      outer_id: facesetId, face_tokens: faceToken,
    });
  }

  // 3. Tag the face with user name
  await facePlusPlus("face/setuserid", faceApiKey, faceApiSecret, {
    face_token: faceToken, user_id: name,
  });

  // 4. Train
  await facePlusPlus("faceset/train", faceApiKey, faceApiSecret, { outer_id: facesetId });

  return ok({ status: "enrolled", name });
});

// POST /api/v1/face/verify  — ESP32 sends raw JPEG, returns grant/deny
app.post("/api/v1/face/verify", async (c) => {
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);
  if (!c.env.FACEPLUSPLUS_API_KEY || !c.env.FACEPLUSPLUS_API_SECRET)
    return err("Face++ API credentials not configured", 503);

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty image body");
  const imageBase64 = arrayBufferToBase64(body);

  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings)
    .where(eq(schema.settings.key, "faceset_id"));
  const facesetId = rows[0]?.value ?? "VAULT_FACESET";
  const [threshRow] = await db.select().from(schema.settings)
    .where(eq(schema.settings.key, "face_confidence_threshold")).limit(1);
  const threshold = Number(threshRow?.value ?? "60");

  const result = await facePlusPlus("search", c.env.FACEPLUSPLUS_API_KEY, c.env.FACEPLUSPLUS_API_SECRET, {
    outer_id: facesetId, image_base64: imageBase64,
  });

  type FaceResult = { confidence: number; user_id?: string };
  const results = result.results as FaceResult[] | undefined;
  let granted = false;
  let identifiedName = "Unknown";

  if (results?.length && results[0].confidence >= threshold) {
    granted = true;
    identifiedName = results[0].user_id ?? "Verified User";
  }

  await db.insert(schema.accessLogs).values({ method: "FACE", success: granted });

  return ok({ granted, name: identifiedName, confidence: results?.[0]?.confidence ?? 0 });
});


// Password hashing via Web Crypto PBKDF2
// SHA-256 hex \u2014 used for master PIN + temp PINs (ESP32 can replicate this easily)
async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(password: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArr = new Uint8Array(bits);
  const saltHex = Buffer.from(salt).toString("hex");
  const hashHex = Buffer.from(hashArr).toString("hex");
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const [, saltHex, hashHex] = stored.split(":");
    if (!saltHex || !hashHex) return false;
    const enc = new TextEncoder();
    const salt = new Uint8Array(Buffer.from(saltHex, "hex"));
    const keyMaterial = await crypto.subtle.importKey(
      "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
      keyMaterial, 256
    );
    const hashArr = new Uint8Array(bits);
    return Buffer.from(hashArr).toString("hex") === hashHex;
  } catch {
    return false;
  }
}


// Cloudflare Pages Functions export

export const onRequest = handle(app);

export default app;
