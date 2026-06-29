import { Hono } from "hono";
import { eq, desc, lt, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createClient } from "@supabase/supabase-js";
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
  const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY);
  const [retentionRow] = await db
    .select()
    .from(schema.settings)
    .where(eq(schema.settings.key, "image_retention_days"))
    .limit(1);
  const days = Number(retentionRow?.value ?? "30");
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();

  // 1. Delete by retention date (max 10)
  const old = await db
    .select()
    .from(schema.images)
    .where(lt(schema.images.timestamp, cutoff))
    .limit(10);

  if (old.length > 0) {
    const keys = old.map((o) => o.objectKey);
    await supabase.storage.from("vault-images").remove(keys);
    for (const img of old) {
      await db.delete(schema.images).where(eq(schema.images.id, img.id));
    }
  }

  // 2. Delete by total size limit (> 800MB) (max 10)
  const [sizeRes] = await db
    .select({ total: sql<number>`sum(${schema.images.fileSize})` })
    .from(schema.images);

  if ((sizeRes?.total ?? 0) > 838_860_800) { // 800 MB
    const oldestToFree = await db
      .select()
      .from(schema.images)
      .orderBy(schema.images.timestamp)
      .limit(10);

    if (oldestToFree.length > 0) {
      const keys = oldestToFree.map((o) => o.objectKey);
      await supabase.storage.from("vault-images").remove(keys);
      for (const img of oldestToFree) {
        await db.delete(schema.images).where(eq(schema.images.id, img.id));
      }
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/images
// ---------------------------------------------------------------------------
app.get("/api/v1/images", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  // opportunistic cleanup (max 10 at a time to stay fast)
  purgeOldImages(c.env, db).catch(() => { });
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

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  const { data, error } = await supabase.storage.from("vault-images").download(key);

  if (error || !data) return err("Image not found", 404);
  const headers = new Headers();
  headers.set("Content-Type", "image/jpeg");
  headers.set("Cache-Control", "public, max-age=86400");
  if (download) {
    const filename = key.split("/").pop() ?? "image.jpg";
    headers.set("Content-Disposition", `attachment; filename="${filename}"`);
  }
  return new Response(data, { headers });
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

  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  await supabase.storage.from("vault-images").remove([img.objectKey]);

  await db.delete(schema.images).where(eq(schema.images.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// POST /api/v1/images/cleanup  — manual full retention cleanup
// ---------------------------------------------------------------------------
app.post("/api/v1/images/cleanup", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  let deleted = 0;

  // 1. Full cleanup by retention days
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

  if (old.length > 0) {
    const keys = old.map(o => o.objectKey);
    await supabase.storage.from("vault-images").remove(keys);
    for (const img of old) {
      await db.delete(schema.images).where(eq(schema.images.id, img.id));
      deleted++;
    }
  }

  // 2. Full cleanup by 800MB limit
  let currentSize = 0;
  const [sizeRes] = await db
    .select({ total: sql<number>`sum(${schema.images.fileSize})` })
    .from(schema.images);
  currentSize = sizeRes?.total ?? 0;

  if (currentSize > 838_860_800) { // 800 MB
    // Keep deleting the oldest images one by one until size is under limit
    const allImages = await db
      .select()
      .from(schema.images)
      .orderBy(schema.images.timestamp);

    for (const img of allImages) {
      if (currentSize <= 838_860_800) break;

      await supabase.storage.from("vault-images").remove([img.objectKey]);
      await db.delete(schema.images).where(eq(schema.images.id, img.id));
      currentSize -= (img.fileSize ?? 0);
      deleted++;
    }
  }

  return ok({ deleted, cutoff });
});

export default app;
