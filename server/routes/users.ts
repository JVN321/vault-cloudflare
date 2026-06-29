import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { createClient } from "@supabase/supabase-js";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import {
  ok,
  err,
  hashPassword,
  arrayBufferToBase64,
  facePlusPlus,
  DEFAULT_SETTINGS,
} from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();

// ---------------------------------------------------------------------------
// Users CRUD
// ---------------------------------------------------------------------------

app.get("/api/v1/users", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const rows = await db.select().from(schema.users);
  return ok(rows.map(sanitizeUser));
});

app.get("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
    .limit(1);
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.post("/api/v1/users", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type NewUserBody = {
    username: string;
    email: string;
    password: string;
    name: string;
    role?: string;
    department?: string;
  };
  const body = await c.req.json<NewUserBody>();
  const hash = await hashPassword(body.password);
  const [user] = await db
    .insert(schema.users)
    .values({
      username: body.username,
      email: body.email,
      passwordHash: hash,
      name: body.name,
      role: (body.role as schema.User["role"]) ?? "VISITOR",
      department: body.department ?? null,
      allowedAuthMethods: "[]",
    })
    .returning();
  if (!user) return err("Failed to create user");
  return ok(sanitizeUser(user));
});

// ---------------------------------------------------------------------------
// POST /api/v1/users/enroll-face
// Dashboard: enroll a user via a previously-uploaded R2 image
// ---------------------------------------------------------------------------
app.post("/api/v1/users/enroll-face", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ name: string; objectKey: string }>();
  if (!body.name || !body.objectKey) return err("name and objectKey required", 400);

  // Load Face++ credentials from settings (fall back to env)
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;

  const facesetId = map["faceset_id"] || "VAULT_FACESET";
  const faceApiKey = map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET;

  if (!faceApiKey || !faceApiSecret)
    return err("Face++ API credentials not configured in Dashboard or Environment", 503);

  // Fetch image from Supabase and convert to base64
  const supabase = createClient(c.env.SUPABASE_URL, c.env.SUPABASE_SECRET_KEY);
  const { data: r2Obj, error } = await supabase.storage.from("vault-images").download(body.objectKey);
  if (error || !r2Obj) return err("Image not found in storage", 404);
  const imageBase64 = arrayBufferToBase64(await r2Obj.arrayBuffer());

  // Detect face in image
  const detected = await facePlusPlus("detect", faceApiKey, faceApiSecret, {
    image_base64: imageBase64,
  });
  const faces = detected.faces as Array<{ face_token: string }> | undefined;
  if (!faces?.length) return err("No face detected in selected image", 400);
  const faceToken = faces[0].face_token;

  // Add face to faceset (create if missing)
  const addResult = await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
    outer_id: facesetId,
    face_tokens: faceToken,
  });
  if ((addResult as { error_message?: string }).error_message?.includes("INVALID_OUTER_ID")) {
    await facePlusPlus("faceset/create", faceApiKey, faceApiSecret, {
      outer_id: facesetId,
      display_name: "Vault Access Faceset",
    });
    await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, {
      outer_id: facesetId,
      face_tokens: faceToken,
    });
  }

  // Create user in DB (INACTIVE by default — admin must activate)
  const username =
    body.name.toLowerCase().replace(/\s+/g, "-") +
    "-" +
    Math.floor(Math.random() * 10000);
  const email = `${username}@vault.local`;
  const [user] = await db
    .insert(schema.users)
    .values({
      username,
      email,
      passwordHash: await hashPassword(Math.random().toString()),
      name: body.name,
      role: "VISITOR",
      status: "INACTIVE",
      allowedAuthMethods: JSON.stringify(["FACE"]),
    })
    .returning();

  if (!user) return err("Failed to create user", 500);

  // Tag face with username and train
  await facePlusPlus("face/setuserid", faceApiKey, faceApiSecret, {
    face_token: faceToken,
    user_id: user.username,
  });
  await facePlusPlus("faceset/train", faceApiKey, faceApiSecret, { outer_id: facesetId });

  // Save face credential
  await db.insert(schema.credentials).values({
    userId: user.id,
    credentialType: "FACE",
    credentialValue: faceToken,
    active: true,
  });

  return ok(sanitizeUser(user));
});

app.put("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  type UpdateBody = {
    name?: string;
    email?: string;
    role?: string;
    department?: string;
    status?: string;
  };
  const body = await c.req.json<UpdateBody>();
  const [user] = await db
    .update(schema.users)
    .set({
      ...(body.name !== undefined && { name: body.name }),
      ...(body.email !== undefined && { email: body.email }),
      ...(body.role !== undefined && { role: body.role as schema.User["role"] }),
      ...(body.department !== undefined && { department: body.department }),
      ...(body.status !== undefined && { status: body.status as schema.User["status"] }),
    })
    .where(eq(schema.users.id, id))
    .returning();
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.patch("/api/v1/users/:id/access", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  type AccessBody = { status?: string; allowedAuthMethods?: string[] };
  const body = await c.req.json<AccessBody>();
  const [user] = await db
    .update(schema.users)
    .set({
      ...(body.status !== undefined && { status: body.status as schema.User["status"] }),
      ...(body.allowedAuthMethods !== undefined && {
        allowedAuthMethods: JSON.stringify(body.allowedAuthMethods),
      }),
    })
    .where(eq(schema.users.id, id))
    .returning();
  if (!user) return err("User not found", 404);
  return ok(sanitizeUser(user));
});

app.delete("/api/v1/users/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db.delete(schema.users).where(eq(schema.users.id, id));
  return ok(null);
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------
function sanitizeUser(u: schema.User): Record<string, unknown> {
  const { passwordHash: _ph, ...rest } = u;
  return {
    ...rest,
    allowedAuthMethods: JSON.parse(u.allowedAuthMethods ?? "[]") as string[],
  };
}

export default app;
