import { Hono } from "hono";
import { desc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// GET /api/v1/sensor/latest  — dashboard: most recent sensor reading
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

export default app;
