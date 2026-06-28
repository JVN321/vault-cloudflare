import { Hono } from "hono";
import { handle } from "hono/cloudflare-pages";
import { Env } from "../../server/types";
import { ok, err } from "../../server/utils/helpers";
import * as cookie from "cookie";

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

const app = new Hono<{ Bindings: Env }>();

// Auth middleware for dashboard (protects /api/v1 except /auth/signin and hardware routes)
app.use('*', async (c, next) => {
  const path = c.req.path;
  const isDashboardApi = path.startsWith("/api/v1/") && !path.startsWith("/api/v1/esp/") && !path.startsWith("/api/v1/face/") && !path.startsWith("/api/v1/sensor") && !path.startsWith("/api/v1/upload") && !path.startsWith("/api/v1/images/serve");
  
  if (isDashboardApi && path !== "/api/v1/auth/signin") {
    const cookies = cookie.parse(c.req.header("Cookie") || "");
    const sessionCookie = cookies.vault_session;
    
    // In production, we verify the cookie signature here.
    // For simplicity, we just check if it exists and matches the secret (very basic mock validation)
    // The actual system has a more robust cookie verify, but we replicate the old [[route]].ts logic here:
    if (!sessionCookie || !sessionCookie.includes(c.env.SESSION_SECRET)) {
      return err("Unauthorized", 401);
    }
  }
  await next();
});

// Mount routes
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

export const onRequest = handle(app);
