import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /api/v1/access-logs
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

// ---------------------------------------------------------------------------
// POST /api/v1/access-logs
// ---------------------------------------------------------------------------
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

export default app;
