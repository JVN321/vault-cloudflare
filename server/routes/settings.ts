import { Hono } from "hono";
import { eq, desc, and, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, hashPassword, verifyPassword, sha256Hex, arrayBufferToBase64, facePlusPlus, DEFAULT_SETTINGS, parseSettings } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();


// Settings / System config

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


// Images – serve from R2


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


// Sensor readings

app.get("/api/v1/sensor/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [reading] = await db
    .select()
    .from(schema.sensorReadings)
    .orderBy(desc(schema.sensorReadings.timestamp))
    .limit(1);
  return ok(reading ?? null);
});


export default app;
