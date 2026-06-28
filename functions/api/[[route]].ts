// functions/api/[[route]].ts
// Cloudflare Pages Functions – handles all /api/* requests via Hono

import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import type { Env } from "../../server/types";
import { err } from "../../server/utils/helpers";

import authApp from "../../server/routes/auth";
import usersApp from "../../server/routes/users";
import commandsApp from "../../server/routes/commands";
import tempPinsApp from "../../server/routes/tempPins";
import settingsApp from "../../server/routes/settings";
import accessLogsApp from "../../server/routes/accessLogs";
import imagesApp from "../../server/routes/images";
import espApp from "../../server/routes/esp";
import sensorApp from "../../server/routes/sensor";
import faceApp from "../../server/routes/face";

// ---------------------------------------------------------------------------
// Session constants (must match server/routes/auth.ts)
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "vault_session";

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";").map((s) => s.trim())) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1);
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Path-based bypass rules – these never require a dashboard session
// ---------------------------------------------------------------------------
function isPublicPath(path: string): boolean {
  return (
    path === "/api/v1/auth/signin" ||
    // ESP32 / hardware endpoints (use CAMERA_API_KEY instead)
    path.startsWith("/api/v1/esp/") ||
    path.startsWith("/api/v1/face/") ||
    path === "/api/v1/sensor" ||
    path === "/api/v1/upload" ||
    path === "/api/v1/latest" ||
    path === "/api/v1/config" ||
    // Image serving is public (URLs are opaque R2 keys)
    path.startsWith("/api/v1/images/serve/") ||
    // Livestream frame served without session (image URL embedded in <img> tag)
    path === "/api/v1/livestream/frame"
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------
const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Auth middleware – verify dashboard session via D1 sessions table
// ---------------------------------------------------------------------------
app.use("*", async (c, next) => {
  const path = c.req.path;

  // Only guard /api/v1/* routes
  if (!path.startsWith("/api/v1/")) return next();
  if (isPublicPath(path)) return next();

  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (!sessionId) return err("Unauthorized", 401);

  const db = drizzle(c.env.DB, { schema });
  const now = new Date().toISOString();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session || session.expiresAt < now) return err("Session expired", 401);

  return next();
});

// ---------------------------------------------------------------------------
// Mount route modules
// ---------------------------------------------------------------------------
app.route("/", authApp);
app.route("/", usersApp);
app.route("/", commandsApp);
app.route("/", tempPinsApp);
app.route("/", settingsApp);
app.route("/", accessLogsApp);
app.route("/", imagesApp);
app.route("/", espApp);
app.route("/", sensorApp);
app.route("/", faceApp);

// ---------------------------------------------------------------------------
// Cloudflare Pages Functions export
// ---------------------------------------------------------------------------
export const onRequest = handle(app);
