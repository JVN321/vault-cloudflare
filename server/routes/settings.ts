import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, DEFAULT_SETTINGS, parseSettings } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /api/v1/settings
// ---------------------------------------------------------------------------
app.get("/api/v1/settings", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok(parseSettings(map));
});

// ---------------------------------------------------------------------------
// PATCH /api/v1/settings
// ---------------------------------------------------------------------------
app.patch("/api/v1/settings", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<Record<string, unknown>>();

  // Some frontend keys differ from DB keys
  const keyMap: Record<string, string> = {
    faceConfidenceThreshold: "face_confidence_threshold",
    faceplusplusFaceset: "faceset_id",
    imageRetentionDays: "image_retention_days",
    pollIntervalMs: "poll_interval_ms",
    livestreamActive: "livestream_active",
  };

  for (const [rawKey, value] of Object.entries(body)) {
    const key = keyMap[rawKey] ?? rawKey;
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
      await db.insert(schema.settings).values({ key, value: strVal });
    }
  }

  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;
  return ok(parseSettings(map));
});

export default app;
