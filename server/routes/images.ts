import { Hono } from "hono";
import { eq, desc, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Helper: purge images older than retention window (runs opportunistically)
// ---------------------------------------------------------------------------
async function purgeOldImages(
  env: Env,
  db: ReturnType<typeof drizzle<typeof schema>>
): Promise<void> {
  const [retentionRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "image_retention_days"))
    .limit(1);
  const days = Number(retentionRow?.value ?? "30");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = await db
    .select()
    .from(schema.images)
    .where(lt(schema.images.timestamp, cutoff))
    .limit(10);
  for (const img of old) {
    try {
      await env.IMAGES.delete(img.objectKey);
    } catch {
      /* R2 miss is fine */
    }
    await db.delete(schema.images).where(eq(schema.images.id, img.id));
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/images
// ---------------------------------------------------------------------------
app.get("/api/v1/images", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  // opportunistic cleanup (max 10 at a time to stay fast)
  purgeOldImages(c.env, db).catch(() => {});
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 500);
  const motionOnly = c.req.query("motion") === "1";
  const imgs = await (motionOnly
    ? db
        .select()
        .from(schema.images)
        .where(eq(schema.images.motionDetected, true))
        .orderBy(desc(schema.images.timestamp))
        .limit(limit)
    : db
        .select()
        .from(schema.images)
        .orderBy(desc(schema.images.timestamp))
        .limit(limit));
  return ok(imgs);
});

// ---------------------------------------------------------------------------
// GET /api/v1/images/latest
// ---------------------------------------------------------------------------
app.get("/api/v1/images/latest", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [img] = await db
    .select()
    .from(schema.images)
    .orderBy(desc(schema.images.timestamp))
    .limit(1);
  return ok(img ?? null);
});

// ---------------------------------------------------------------------------
// GET /api/v1/images/serve/:key  — stream image bytes from R2
// ---------------------------------------------------------------------------
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
// DELETE /api/v1/images/:id  — delete from R2 + D1
// ---------------------------------------------------------------------------
app.delete("/api/v1/images/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  const [img] = await db
    .select()
    .from(schema.images)
    .where(eq(schema.images.id, id))
    .limit(1);
  if (!img) return err("Image not found", 404);
  try {
    await c.env.IMAGES.delete(img.objectKey);
  } catch {
    /* already gone */
  }
  await db.delete(schema.images).where(eq(schema.images.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// POST /api/v1/images/cleanup  — manual full retention cleanup
// ---------------------------------------------------------------------------
app.post("/api/v1/images/cleanup", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const [retentionRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "image_retention_days"))
    .limit(1);
  const days = Number(retentionRow?.value ?? "30");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const old = await db
    .select()
    .from(schema.images)
    .where(lt(schema.images.timestamp, cutoff));
  let deleted = 0;
  for (const img of old) {
    try {
      await c.env.IMAGES.delete(img.objectKey);
    } catch {
      /* ok */
    }
    await db.delete(schema.images).where(eq(schema.images.id, img.id));
    deleted++;
  }
  return ok({ deleted, cutoff });
});

export default app;
