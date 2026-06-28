import { Hono } from "hono";
import { eq, desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// POST /api/v1/commands  — Dashboard: queue a new command
// ---------------------------------------------------------------------------
app.post("/api/v1/commands", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type Body = { type?: string; expiresInSecs?: number };
  const body = await c.req.json<Body>().catch(() => ({}));
  if (!body.type || !["LOCK", "UNLOCK", "PULSE"].includes(body.type))
    return err("type must be LOCK, UNLOCK or PULSE");
  const expiresAt = new Date(
    Date.now() + (body.expiresInSecs ?? 30) * 1_000
  ).toISOString();
  const [cmd] = await db
    .insert(schema.commands)
    .values({ type: body.type as schema.Command["type"], expiresAt })
    .returning();
  return ok(cmd);
});

// ---------------------------------------------------------------------------
// GET /api/v1/commands  — Dashboard: list commands
// ---------------------------------------------------------------------------
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

export default app;
