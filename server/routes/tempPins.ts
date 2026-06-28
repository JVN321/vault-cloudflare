import { Hono } from "hono";
import { eq, desc, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, sha256Hex } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /api/v1/temp-pins  — Dashboard: list active temp PINs (no hash exposed)
// ---------------------------------------------------------------------------
app.get("/api/v1/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  // Auto-delete expired pins
  await db.delete(schema.tempPins).where(lt(schema.tempPins.expiresAt, now));
  const rows = await db
    .select()
    .from(schema.tempPins)
    .orderBy(desc(schema.tempPins.createdAt));
  // Never expose the SHA-256 hash to the dashboard
  return ok(rows.map(({ pinSha256: _h, ...r }) => r));
});

// ---------------------------------------------------------------------------
// POST /api/v1/temp-pins  — Dashboard: create a new temp PIN
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// DELETE /api/v1/temp-pins/:id  — Dashboard: revoke a specific temp PIN
// ---------------------------------------------------------------------------
app.delete("/api/v1/temp-pins/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db.delete(schema.tempPins).where(eq(schema.tempPins.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// DELETE /api/v1/temp-pins  — Dashboard: revoke all temp PINs
// ---------------------------------------------------------------------------
app.delete("/api/v1/temp-pins", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  await db.delete(schema.tempPins);
  return ok(null);
});

export default app;
