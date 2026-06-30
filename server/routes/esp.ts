import { Hono } from "hono";
import { eq, and, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import {
  ok,
  err,
  sha256Hex,
  arrayBufferToBase64,
  facePlusPlus,
  DEFAULT_SETTINGS,
} from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// ESP32 API-Key Middleware
// ---------------------------------------------------------------------------
// All ESP32-facing paths require X-API-Key: <CAMERA_API_KEY> (or ?api_key=).
// Dashboard-facing paths in this same file (/livestream toggle, /livestream/frame,
// /settings/master-pin) are deliberately excluded — they rely on the global
// session auth middleware in [[route]].ts instead.
// ---------------------------------------------------------------------------
const ESP32_PATHS: Array<string | ((p: string) => boolean)> = [
  "/api/v1/sensor",
  "/api/v1/upload",
  "/api/v1/latest",
  "/api/v1/config",
  (p) => p.startsWith("/api/v1/esp/"),
  (p) => p.startsWith("/api/v1/face/"),
];

function isEsp32Path(path: string): boolean {
  return ESP32_PATHS.some((rule) =>
    typeof rule === "string" ? path === rule : rule(path)
  );
}

app.use("*", async (c, next) => {
  if (!isEsp32Path(c.req.path)) return next();

  const apiKey = c.req.header("X-API-Key") ?? c.req.query("api_key");
  if (!apiKey || apiKey !== c.env.CAMERA_API_KEY) {
    return err("Unauthorized — X-API-Key required", 401);
  }
  return next();
});

// ---------------------------------------------------------------------------
// POST /api/v1/sensor  — ESP32 ingest sensor reading
// ---------------------------------------------------------------------------
app.post("/api/v1/sensor", async (c) => {
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

// ---------------------------------------------------------------------------
// POST /api/v1/upload  — ESP32 upload JPEG to R2, store metadata in D1
// ---------------------------------------------------------------------------
app.post("/api/v1/upload", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const cameraId = Number(c.req.query("camera_id") ?? "0") || null;
  const motionDetected = c.req.query("motion") === "1";

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty body");

  const objectKey = `images/${Date.now()}-${crypto.randomUUID()}.jpg`;

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  const { error } = await supabase.storage.from("vault-images").upload(objectKey, body, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) return err(`Failed to upload to Supabase: ${error.message}`, 500);

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

// ---------------------------------------------------------------------------
// GET /api/v1/latest  — ESP32 poll: latest image metadata
// ---------------------------------------------------------------------------
app.get("/api/v1/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [img] = await db
    .select()
    .from(schema.images)
    .orderBy(schema.images.timestamp)
    .limit(1);
  return ok(img ?? null);
});

// ---------------------------------------------------------------------------
// GET /api/v1/config  — ESP32 basic config (legacy; prefer /esp/config)
// ---------------------------------------------------------------------------
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
// GET /api/v1/esp/config  — ESP32 unified config
// ---------------------------------------------------------------------------
app.get("/api/v1/esp/config", async (c) => {
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
// GET /api/v1/esp/commands/pending  — ESP32 polls for queued commands
// Response also carries { livestream } so the ESP32 adjusts upload rate.
// ---------------------------------------------------------------------------
app.get("/api/v1/esp/commands/pending", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // Expire stale pending commands
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

  // Read current livestream flag from settings
  const [lsRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "livestream_active"))
    .limit(1);
  const livestream = lsRow?.value === "true";

  return ok({ command: cmd ?? null, livestream });
});

// ---------------------------------------------------------------------------
// POST /api/v1/esp/commands/:id/ack  — ESP32 acknowledges executed command
// ---------------------------------------------------------------------------
app.post("/api/v1/esp/commands/:id/ack", async (c) => {
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
// GET /api/v1/esp/temp-pins  — ESP32 fetches active PIN hashes
// ---------------------------------------------------------------------------
app.get("/api/v1/esp/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // Auto-delete expired
  await db.delete(schema.tempPins).where(lt(schema.tempPins.expiresAt, now));
  const rows = await db
    .select()
    .from(schema.tempPins)
    .where(and(eq(schema.tempPins.status, "ACTIVE"), gt(schema.tempPins.expiresAt, now)));
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
// POST /api/v1/esp/auth/pin  — ESP32 unified PIN auth (master + temp PINs)
// ---------------------------------------------------------------------------
app.post("/api/v1/esp/auth/pin", async (c) => {
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
    await db.insert(schema.accessLogs).values({ method: "PIN", success: true, timestamp: new Date().toISOString() });
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
    await db.insert(schema.accessLogs).values({ method: "PIN", success: true, userId: match.createdBy, timestamp: new Date().toISOString() });
    return ok({ granted: true, type: "temp", temp_pin_id: match.id, label: match.label });
  }

  // 3. Denied
  await db.insert(schema.accessLogs).values({ method: "PIN", success: false, timestamp: new Date().toISOString() });
  return err("Invalid PIN", 401);
});

// ---------------------------------------------------------------------------
// POST /api/v1/face/enroll  — ESP32 sends raw JPEG to enroll a face
// ---------------------------------------------------------------------------
app.post("/api/v1/face/enroll", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;

  const faceApiKey = map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET;
  if (!faceApiKey || !faceApiSecret)
    return err("Face++ API credentials not configured", 503);

  const name = c.req.query("name") ?? "Unknown";
  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty image body");
  const imageBase64 = arrayBufferToBase64(body);

  const [fsetRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "faceset_id"))
    .limit(1);
  const facesetId = fsetRow?.value ?? "VAULT_FACESET";

  // Detect
  const detected = await facePlusPlus("detect", faceApiKey, faceApiSecret, {
    image_base64: imageBase64,
  });
  const faces = detected.faces as Array<{ face_token: string }> | undefined;
  if (!faces?.length) return err("No face detected in image");
  const faceToken = faces[0].face_token;

  // Add to faceset (create if needed)
  const addResult = await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
    outer_id: facesetId,
    face_tokens: faceToken,
  });
  if ((addResult as { error_message?: string }).error_message?.includes("INVALID_OUTER_ID")) {
    await facePlusPlus("faceset/create", faceApiKey, faceApiSecret, {
      outer_id: facesetId,
      display_name: "Vault Access Faceset",
    });
    await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
      outer_id: facesetId,
      face_tokens: faceToken,
    });
  }

  // Tag and train
  await facePlusPlus("face/setuserid", faceApiKey, faceApiSecret, {
    face_token: faceToken,
    user_id: name,
  });
  await facePlusPlus("faceset/train", faceApiKey, faceApiSecret, { outer_id: facesetId });

  return ok({ status: "enrolled", name });
});

// ---------------------------------------------------------------------------
// POST /api/v1/face/verify  — ESP32 sends raw JPEG, returns grant/deny
// ---------------------------------------------------------------------------
app.post("/api/v1/face/verify", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;

  const faceApiKey = map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET;
  if (!faceApiKey || !faceApiSecret)
    return err("Face++ API credentials not configured", 503);

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty image body");
  const imageBase64 = arrayBufferToBase64(body);

  const facesetId = map["faceset_id"] || "VAULT_FACESET";
  const threshold = Number(map["face_confidence_threshold"] ?? "60");

  const result = await facePlusPlus("search", faceApiKey, faceApiSecret, {
    outer_id: facesetId,
    image_base64: imageBase64,
    return_result_count: "5",
  });

  type FaceResult = { confidence: number; user_id?: string };
  const results = result.results as FaceResult[] | undefined;
  let granted = false;
  let identifiedName = "Unknown";
  let matchedUserId: number | null = null;

  if (results?.length) {
    for (const match of results) {
      if (match.confidence < threshold) continue;

      const matchedUsername = match.user_id;
      if (!matchedUsername) continue;

      const [matchedUser] = await db
        .select()
        .from(schema.users)
        .where(eq(schema.users.username, matchedUsername))
        .limit(1);

      if (!matchedUser) {
        // Cleanup stale face token from Face++ since user no longer exists in our DB
        if (match.face_token) {
          await facePlusPlus("faceset/removeface", faceApiKey, faceApiSecret, {
            outer_id: facesetId,
            face_tokens: match.face_token,
          }).catch(() => {}); // ignore errors during background cleanup
        }
        continue;
      }

      if (
        matchedUser.status === "ACTIVE" &&
        JSON.parse(matchedUser.allowedAuthMethods ?? "[]").includes("FACE")
      ) {
        granted = true;
        identifiedName = matchedUser.name;
        matchedUserId = matchedUser.id;
        break; // found a valid active user, stop checking other matches
      }
    }
  }

  await db.insert(schema.accessLogs).values({
    method: "FACE",
    success: granted,
    userId: matchedUserId,
    timestamp: new Date().toISOString()
  });

  return ok({
    granted,
    name: identifiedName,
    confidence: results?.[0]?.confidence ?? 0,
  });
});

// ---------------------------------------------------------------------------
// POST /api/v1/esp/livestream  — ESP32 uploads a livestream frame
// Same as /upload but tagged as a livestream frame (not stored long-term)
// ---------------------------------------------------------------------------
app.post("/api/v1/esp/livestream", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  // Only accept frames while dashboard has livestream enabled
  const [lsRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "livestream_active"))
    .limit(1);
  if (lsRow?.value !== "true") return ok({ accepted: false, reason: "livestream_off" });

  const body = await c.req.arrayBuffer();
  if (!body.byteLength) return err("Empty body");

  // Overwrite a fixed Supabase key so only the latest frame is stored (no accumulation)
  const objectKey = `livestream/frame-latest.jpg`;

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  const { error } = await supabase.storage.from("vault-images").upload(objectKey, body, {
    contentType: "image/jpeg",
    upsert: true,
  });
  if (error) return err(`Failed to upload to Supabase: ${error.message}`, 500);

  return ok({ accepted: true, objectKey });
});

// ---------------------------------------------------------------------------
// POST /api/v1/livestream  — Dashboard: toggle livestream on/off
// (Protected by global session middleware in [[route]].ts)
// ---------------------------------------------------------------------------
app.post("/api/v1/livestream", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ active: boolean }>().catch(() => ({ active: false }));
  const value = body.active ? "true" : "false";
  const existing = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "livestream_active"))
    .limit(1);
  if (existing.length > 0) {
    await db
      .update(schema.settings)
      .set({ value, updatedAt: new Date().toISOString() })
      .where(eq(schema.settings.key, "livestream_active"));
  } else {
    await db.insert(schema.settings).values({ key: "livestream_active", value });
  }
  return ok({ livestreamActive: body.active });
});

// ---------------------------------------------------------------------------
// GET /api/v1/livestream/frame  — Dashboard: serve the latest livestream frame
// (Public — no auth required; URL is unguessable enough as a view-only endpoint)
// ---------------------------------------------------------------------------
app.get("/api/v1/livestream/frame", async (c) => {
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  const { data, error } = await supabase.storage.from("vault-images").download("livestream/frame-latest.jpg");

  if (error || !data) return err("No frame available", 404);
  const headers = new Headers();
  headers.set("Content-Type", "image/jpeg");
  // Short cache — dashboard polls rapidly
  headers.set("Cache-Control", "no-store");
  return new Response(data, { headers });
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/settings/master-pin  — Dashboard: set/update master PIN
// (Protected by global session middleware in [[route]].ts)
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

export default app;
