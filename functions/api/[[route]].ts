// functions/api/[[route]].ts
// Cloudflare Pages Functions – handles all /api/* requests via Hono

import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { drizzle } from "drizzle-orm/d1";
import { eq, desc, and } from "drizzle-orm";
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
  for (const [key, value] of Object.entries(body)) {
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
app.get("/api/v1/images", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const limit = Math.min(Number(c.req.query("limit") ?? "20"), 100);
  const imgs = await db
    .select()
    .from(schema.images)
    .orderBy(desc(schema.images.timestamp))
    .limit(limit);
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

app.get("/api/v1/images/serve/:key", async (c) => {
  const key = decodeURIComponent(c.req.param("key"));
  const object = await c.env.IMAGES.get(key);
  if (!object) return err("Image not found", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=86400");
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
  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (apiKey !== c.env.CAMERA_API_KEY) return err("Unauthorized", 401);

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
  };
}

function generateTempCode(): string {
  const seg = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  return `VLT-${seg()}-${seg()}`;
}

// Password hashing via Web Crypto PBKDF2
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
