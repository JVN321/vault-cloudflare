import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, hashPassword, verifyPassword } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Session constants
// ---------------------------------------------------------------------------
const SESSION_COOKIE = "vault_session";
const SESSION_TTL_HOURS = 24;

function getCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("Cookie") ?? "";
  for (const part of header.split(";").map((s) => s.trim())) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1);
  }
  return undefined;
}

function sanitizeUser(u: schema.User): Record<string, unknown> {
  const { passwordHash: _ph, ...rest } = u;
  return {
    ...rest,
    allowedAuthMethods: JSON.parse(u.allowedAuthMethods ?? "[]") as string[],
  };
}

// ---------------------------------------------------------------------------
// POST /api/v1/auth/signin
// ---------------------------------------------------------------------------
app.post("/api/v1/auth/signin", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  let body: { email?: string; password?: string };
  try {
    body = await c.req.json<{ email?: string; password?: string }>();
  } catch {
    return err("Invalid JSON");
  }

  const { email, password } = body;
  if (!email || !password) return err("Email and password required");

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (!user) return err("Invalid credentials", 401);

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) return err("Invalid credentials", 401);

  if (user.status !== "ACTIVE") return err("Account is not active", 403);

  // Create session
  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000
  ).toISOString();

  await db.insert(schema.sessions).values({ id: sessionId, userId: user.id, expiresAt });

  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`
  );

  return Response.json(
    { success: true, data: { user: sanitizeUser(user) } },
    { headers }
  );
});

// ---------------------------------------------------------------------------
// POST /api/v1/auth/signout
// ---------------------------------------------------------------------------
app.post("/api/v1/auth/signout", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (sessionId) {
    await db.delete(schema.sessions).where(eq(schema.sessions.id, sessionId));
  }
  const headers = new Headers();
  headers.set(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
  return Response.json({ success: true, data: null }, { headers });
});

// ---------------------------------------------------------------------------
// GET /api/v1/auth/me
// ---------------------------------------------------------------------------
app.get("/api/v1/auth/me", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const sessionId = getCookie(c.req.raw, SESSION_COOKIE);
  if (!sessionId) return err("Unauthorized", 401);

  const now = new Date().toISOString();
  const [session] = await db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, sessionId))
    .limit(1);

  if (!session || session.expiresAt < now) return err("Session expired", 401);

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, session.userId))
    .limit(1);

  if (!user) return err("User not found", 404);
  return ok({ user: sanitizeUser(user) });
});

export default app;
