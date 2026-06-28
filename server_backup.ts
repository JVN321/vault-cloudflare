// functions/api/[[route]].ts
// Cloudflare Pages Functions – handles all /api/* requests via Hono

import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and, lt, gt } from "drizzle-orm";
import * as schema from "../../drizzle/schema";
import type { ApiResponse } from "../../app/lib/types";

// ---------------------------------------------------------------------------
// Env / Bindings
// ---------------------------------------------------------------------------
export interface Env {
  DB: D1Database;
  IMAGES: R2Bucket;
  SESSION_SECRET: string;
  CAMERA_API_KEY: string;
  ENVIRONMENT?: string;
  FACEPLUSPLUS_API_KEY?: string;
  FACEPLUSPLUS_API_SECRET?: string;
}

type Bindings = Env;

// ---------------------------------------------------------------------------
// Helper: standard JSON response
// ---------------------------------------------------------------------------
function ok<T>(data: T): Response {
  const body: ApiResponse<T> = { success: true, data };
  return Response.json(body);
}

function err(message: string, status = 400): Response {
  const body: ApiResponse = { success: false, error: message };
  return Response.json(body, { status });
}

// ---------------------------------------------------------------------------
// Session helpers (simple cookie-based, no JWT)
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "vault_session";
const SESSION_TTL_HOURS = 24;

function generateId(): string {
  return crypto.randomUUID();
}

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  const parts = header.split(";").map((s) => s.trim());
  for (const part of parts) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new Hono<{ Bindings: Bindings }>();

// ---------------------------------------------------------------------------
// Auth middleware (applied to protected routes)
// ---------------------------------------------------------------------------
const requireAuth = async (
  c: { req: { raw: Request }; env: Bindings },
  next: () => Promise<void>
): Promise<Response | undefined> => {
  const db = drizzle(c.env.DB, { schema });
  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (!sessionId) return err("Unauthorized", 401);

  const now = new Date().toISOString();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session || session.expiresAt < now) return err("Session expired", 401);

  // Attach user id to locals via header trick (Hono supports set/get on context)
  (c as unknown as { _userId: number })._userId = session.userId;
  await next();
  return undefined;
};

// ---------------------------------------------------------------------------
// POST /api/v1/auth/signin
// ---------------------------------------------------------------------------
app.post("/api/v1/auth/signin", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json<{ email?: string; password?: string }>();
  } catch {
    return err("Invalid JSON");
  }

  const { email, password } = body;
  if (!email || !password) return err("Email and password required");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) return err("Invalid credentials", 401);

  // Verify password (bcrypt-like via SubtleCrypto PBKDF2)
  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return err("Invalid credentials", 401);

  if (user.status !== "ACTIVE") return err("Account is not active", 403);

  // Create session
  const sessionId = generateId();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  await db.insert(schema.sessions).values({
    id: sessionId,
    userId: user.id,
    expiresAt,
  });

  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`
  );

  return Response.json(
    {
      success: true,
      data: { user: sanitizeUser(user) },
    },
    { headers }
  );
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/signout
// ---------------------------------------------------------------------------
app.post("/api/v1/auth/signout", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (sessionId) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, sessionId));
  }
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  return Response.json({ success: true, data: null }, { headers });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------
app.get("/api/v1/auth/me", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (!sessionId) return err("Unauthorized", 401);

  const now = new Date().toISOString();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session || session.expiresAt < now) return err("Session expired", 401);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  return ok({ user: sanitizeUser(user) });
});

// ---------------------------------------------------------------------------
// Users CRUD
// ---------------------------------------------------------------------------
app.get("/api/v1/users", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.users);
  return ok(rows.map(sanitizeUser));
});

app.get("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.post("/api/v1/users", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type NewUserBody = {
    username: string;
    email: string;
    password: string;
    name: string;
    role?: string;
    department?: string;
  };
  const body = await c.req.json<NewUserBody>();
  const hash = await hashPassword(body.password);
  const [user] = await db
    .insert(schema.users)
    .values({
      username: body.username,
      email: body.email,
      passwordHash: hash,
      name: body.name,
      role: (body.role as schema.User["role"]) ?? "VISITOR",
      department: body.department ?? null,
      allowedAuthMethods: "[]",
    })
    .returning();
  if (!user) return err("Failed to create user");
  return ok(sanitizeUser(user));
});
app.post("/api/v1/users/enroll-face", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ name: string; objectKey: string }>();
  if (!body.name || !body.objectKey) return err("name and objectKey required", 400);

  // 2. Setup Face++ variables
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;

  const facesetId = map["faceset_id"] || "VAULT_FACESET";
  const faceApiKey = map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET;

  if (!faceApiKey || !faceApiSecret) {
    return err("Face++ API credentials not configured in Dashboard or Environment", 503);
  }

  // 1. Fetch image from R2
  const r2Obj = await c.env.IMAGES.get(body.objectKey);
  if (!r2Obj) return err("Image not found in storage", 404);
  const imgBuffer = await r2Obj.arrayBuffer();
  const imageBase64 = arrayBufferToBase64(imgBuffer);

  // 3. Face++ Detect
  const detected = await facePlusPlus("detect", faceApiKey, faceApiSecret, { image_base64: imageBase64 });
  const faces = detected.faces as Array<{ face_token: string }> | undefined;
  if (!faces?.length) return err("No face detected in selected image", 400);
  const faceToken = faces[0].face_token;

  // 4. Add face to faceset
  const addResult = await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, { outer_id: facesetId, face_tokens: faceToken });
  if ((addResult as { error_message?: string }).error_message?.includes("INVALID_OUTER_ID")) {
    await facePlusPlus("faceset/create", faceApiKey, faceApiSecret, { outer_id: facesetId, display_name: "Vault Access Faceset" });
    await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, { outer_id: facesetId, face_tokens: faceToken });
  }

  // 5. Create user in DB (INACTIVE by default)
  const username = body.name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.floor(Math.random() * 10000);
  const email = `${username}@vault.local`;
  const [user] = await db
    .insert(schema.users)
    .values({
      username,
      email,
      passwordHash: await hashPassword(Math.random().toString()), // random inaccessible password
      name: body.name,
      role: "VISITOR",
      status: "INACTIVE", // default access to off
      allowedAuthMethods: JSON.stringify(["FACE"]),
    })
    .returning();

  if (!user) return err("Failed to create user", 500);

  // 6. Set user id in Face++
  await facePlusPlus("face/setuserid", faceApiKey, faceApiSecret, { face_token: faceToken, user_id: user.username });
  await facePlusPlus("faceset/train", faceApiKey, faceApiSecret, { outer_id: facesetId });

  // 7. Save face credential
  await db.insert(schema.credentials).values({
    userId: user.id,
    credentialType: "FACE",
    credentialValue: faceToken,
    active: true,
  });

  return ok(sanitizeUser(user));
});

app.put("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  type UpdateBody = {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    status?: string;
  };
  const body = await c.req.json<UpdateBody>();
  const [user] = await db
    .update(schema.users)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.role !== undefined && { role: body.role as schema.User["role"] }),
      ...(body.department !== undefined && { department: body.department }),
      ...(body.status !== undefined && {
        status: body.status as schema.User["status"],
      }),
    })
    .where(eq(schema.users.id, id))
    .returning();
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.patch("/api/v1/users/:id/access", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  type AccessBody = { status?: string; allowedAuthMethods?: string[] };
  const body = await c.req.json<AccessBody>();
  const [user] = await db
    .update(schema.users)
    .set({
      ...(body.status !== undefined && {
        status: body.status as schema.User["status"],
      }),
      ...(body.allowedAuthMethods !== undefined && {
        allowedAuthMethods: JSON.stringify(body.allowedAuthMethods),
      }),
    })
    .where(eq(schema.users.id, id))
    .returning();
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.delete("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db.delete(schema.users).where(eq(schema.users.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// Access Logs
// ---------------------------------------------------------------------------
app.get("/api/v1/access-logs", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 500);
  const logs = await db
    .select()
    .from(schema.accessLogs)
    .orderBy(desc(schema.accessLogs.timestamp))
    .limit(limit);
  return ok(logs);
});

app.post("/api/v1/access-logs", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type LogBody = {
    userId?: number;
    method: string;
    success: boolean;
    location?: string;
    action?: string;
  };
  const body = await c.req.json<LogBody>();
  const [log] = await db
    .insert(schema.accessLogs)
    .values({
      userId: body.userId ?? null,
      method: body.method as schema.AccessLog["method"],
      success: body.success,
      location: body.location ?? null,
      action: (body.action ?? "ENTRY") as schema.AccessLog["action"],
    })
    .returning();
  return ok(log);
});

// ---------------------------------------------------------------------------
// Temporary codes
// ---------------------------------------------------------------------------
app.get("/api/v1/temp-codes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const codes = await db
    .select()
    .from(schema.temporaryCodes)
    .orderBy(desc(schema.temporaryCodes.createdAt));
  return ok(codes);
});

app.post("/api/v1/temp-codes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type TempCodeBody = {
    location: string;
    accessType: string;
    validFrom: string;
    expiresAt: string;
    notes?: string;
  };
  const body = await c.req.json<TempCodeBody>();
  const code = generateTempCode();
  const [created] = await db
    .insert(schema.temporaryCodes)
    .values({ ...body, code, status: "ACTIVE" })
    .returning();
  return ok(created);
});

app.delete("/api/v1/temp-codes/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db.delete(schema.temporaryCodes).where(eq(schema.temporaryCodes.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// Settings / System config
// ---------------------------------------------------------------------------
const DEFAULT_SETTINGS: Record<string, string> = {
  allowFaceAuth: "true",
  allowPinAuth: "true",
  allowQrAuth: "true",
  allowBarcodeAuth: "false",
  allowRfidAuth: "true",
  failedAttemptLimit: "3",
  autoLockSeconds: "30",
  realtimeAlerts: "true",
  motionDetection: "false",
  master_pin_sha256: "",
  poll_interval_ms: "2000",
  image_retention_days: "30",
  face_confidence_threshold: "60",
  faceset_id: "VAULT_FACESET",
  faceplusplusApiKey: "",
  faceplusplusApiSecret: "",
};

app.get("/api/v1/settings", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok(parseSettings(map));
});

app.patch("/api/v1/settings", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<Record<string, unknown>>();

  const keyMap: Record<string, string> = {
    faceConfidenceThreshold: "face_confidence_threshold",
    faceplusplusFaceset: "faceset_id",
  };

  for (const [rawKey, value] of Object.entries(body)) {
    const key = keyMap[rawKey] || rawKey;
    const strVal = String(value);
    const existing = await db
      .select()
      .from(schema.settings)
      .where(eq(schema.settings.key, key))
      .limit(1);
    if (existing.length > 0) {
      await db
        .update(schema.settings)
        .set({ value: strVal, updatedAt: new Date().toISOString() })
        .where(eq(schema.settings.key, key));
    } else {
      await db
        .insert(schema.settings)
        .values({ key, value: strVal });
    }
  }
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok(parseSettings(map));
});

// ---------------------------------------------------------------------------
// Images – serve from R2
// ---------------------------------------------------------------------------

// Purge images older than image_retention_days from both R2 and D1
async function purgeOldImages(env: Bindings, db: ReturnType<typeof drizzle>): Promise<void> {
  const [retentionRow] = await db.select().from(schema.settings)
    .where(eq(schema.settings.key, "image_retention_days")).limit(1);
  const days = Number(retentionRow?.value ?? "30");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = await db.select().from(schema.images)
    .where(lt(schema.images.timestamp, cutoff)).limit(10);
  for (const img of old) {
    try { await env.IMAGES.delete(img.objectKey); } catch { /* r2 miss ok */ }
    await db.delete(schema.images).where(eq(schema.images.id, img.id));
  }
}

app.get("/api/v1/images", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  // opportunistic cleanup (max 10 at a time to stay fast)
  purgeOldImages(c.env, db).catch(() => {});
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 500);
  const motionOnly = c.req.query("motion") === "1";
  let q = db.select().from(schema.images).orderBy(desc(schema.images.timestamp));
  const imgs = await (motionOnly
    ? db.select().from(schema.images)
        .where(eq(schema.images.motionDetected, true))
        .orderBy(desc(schema.images.timestamp)).limit(limit)
    : db.select().from(schema.images)
        .orderBy(desc(schema.images.timestamp)).limit(limit));
  return ok(imgs);
});

app.get("/api/v1/images/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [img] = await db
    .select()
    .from(schema.images)
    .orderBy(desc(schema.images.timestamp))
    .limit(1);
  return ok(img ?? null);
});

// DELETE /api/v1/images/:id  — delete from R2 + D1
app.delete("/api/v1/images/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  const [img] = await db.select().from(schema.images)
    .where(eq(schema.images.id, id)).limit(1);
  if (!img) return err("Image not found", 404);
  try { await c.env.IMAGES.delete(img.objectKey); } catch { /* already gone */ }
  await db.delete(schema.images).where(eq(schema.images.id, id));
  return ok(null);
});

// POST /api/v1/images/cleanup  — manual full cleanup trigger
app.post("/api/v1/images/cleanup", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [retentionRow] = await db.select().from(schema.settings)
    .where(eq(schema.settings.key, "image_retention_days")).limit(1);
  const days = Number(retentionRow?.value ?? "30");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = await db.select().from(schema.images)
    .where(lt(schema.images.timestamp, cutoff));
  let deleted = 0;
  for (const img of old) {
    try { await c.env.IMAGES.delete(img.objectKey); } catch { /* ok */ }
    await db.delete(schema.images).where(eq(schema.images.id, img.id));
    deleted++;
  }
  return ok({ deleted, cutoff });
});

app.get("/api/v1/images/serve/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const download = c.req.query("download") === "1";
  const object = await c.env.IMAGES.get(key);
  if (!object) return err("Image not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
  if (download) {
    const filename = key.split("/").pop() ?? "image.jpg";
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  }
  return new Response(object.body, { headers });
});

// ---------------------------------------------------------------------------
// Sensor readings
// ---------------------------------------------------------------------------
app.get("/api/v1/sensor/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [reading] = await db
    .select()
    .from(schema.sensorReadings)
    .orderBy(desc(schema.sensorReadings.timestamp))
    .limit(1);
  return ok(reading ?? null);
});

// ---------------------------------------------------------------------------
// ESP32 endpoints
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Auth: PIN – ESP32 auth endpoint
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Commands – Dashboard
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Commands – ESP32
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Temporary PINs – Dashboard
// ---------------------------------------------------------------------------
app.get("/api/v1/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // Auto-delete expired pins
  await db
    .delete(schema.tempPins)
    .where(lt(schema.tempPins.expiresAt, now));

  const rows = await db
    .select()
    .from(schema.tempPins)
    .orderBy(desc(schema.tempPins.createdAt));
  // never expose the hash to the dashboard, but now we return the plain pin
  return ok(rows.map(({ pinSha256: _h, ...r }) => r));
});

app.post("/api/v1/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type Body = { pin: string; label?: string; expiresAt: string; maxUses?: number };
  const body = await c.req.json<Body>();
  if (!body.pin || !/^\d{4,8}$/.test(body.pin)) return err("pin must be 4-8 digits");
  if (!body.expiresAt) return err("expiresAt required");
  const pinSha256 = await sha256Hex(body.pin);
  const [row] = await db
    .insert(schema.tempPins)
    .values({
      pin: body.pin,
      pinSha256,
      label: body.label ?? null,
      expiresAt: body.expiresAt,
      maxUses: body.maxUses ?? 1,
    })
    .returning();
  return ok({ ...row, pinSha256: undefined });
});

app.delete("/api/v1/temp-pins/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db
    .delete(schema.tempPins)
    .where(eq(schema.tempPins.id, id));
  return ok(null);
});

app.delete("/api/v1/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.tempPins);
  return ok(null);
});

// ---------------------------------------------------------------------------
// Temporary PINs – ESP32
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Master PIN – Dashboard
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ESP32 unified config (superset of /api/v1/config)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// ESP32 unified PIN auth (checks master PIN + temp PINs)
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Face Recognition (Face++ API proxy)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Cloudflare Pages Functions export
// ---------------------------------------------------------------------------
export const onRequest = handle(app);
