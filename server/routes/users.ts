import { Hono } from "hono";
import { eq, desc, and, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, hashPassword, verifyPassword, sha256Hex, arrayBufferToBase64, facePlusPlus, DEFAULT_SETTINGS, parseSettings } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();


// Users CRUD

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
app.post("/api/v1/users/enroll-face", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const body = await c.req.json<{ name: string; objectKey: string }>();
  if (!body.name || !body.objectKey) return err("name and objectKey required", 400);

  // 2. Setup Face++ variables
  const rows = await db.select().from(schema.settings);
  const map: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const row of rows) map[row.key] = row.value;

  const facesetId = map["faceset_id"] || "VAULT_FACESET";
  const faceApiKey = map["faceplusplusApiKey"] || c.env.FACEPLUSPLUS_API_KEY;
  const faceApiSecret = map["faceplusplusApiSecret"] || c.env.FACEPLUSPLUS_API_SECRET;

  if (!faceApiKey || !faceApiSecret) {
    return err("Face++ API credentials not configured in Dashboard or Environment", 503);
  }

  // 1. Fetch image from R2
  const r2Obj = await c.env.IMAGES.get(body.objectKey);
  if (!r2Obj) return err("Image not found in storage", 404);
  const imgBuffer = await r2Obj.arrayBuffer();
  const imageBase64 = arrayBufferToBase64(imgBuffer);

  // 3. Face++ Detect
  const detected = await facePlusPlus("detect", faceApiKey, faceApiSecret, { image_base64: imageBase64 });
  const faces = detected.faces as Array<{ face_token: string }> | undefined;
  if (!faces?.length) return err("No face detected in selected image", 400);
  const faceToken = faces[0].face_token;

  // 4. Add face to faceset
  const addResult = await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, { outer_id: facesetId, face_tokens: faceToken });
  if ((addResult as { error_message?: string }).error_message?.includes("INVALID_OUTER_ID")) {
    await facePlusPlus("faceset/create", faceApiKey, faceApiSecret, { outer_id: facesetId, display_name: "Vault Access Faceset" });
    await facePlusPlus("faceset/addface", faceApiKey, faceApiSecret, { outer_id: facesetId, face_tokens: faceToken });
  }

  // 5. Create user in DB (INACTIVE by default)
  const username = body.name.toLowerCase().replace(/\s+/g, '-') + '-' + Math.floor(Math.random() * 10000);
  const email = `${username}@vault.local`;
  const [user] = await db
    .insert(schema.users)
    .values({
      username,
      email,
      passwordHash: await hashPassword(Math.random().toString()), // random inaccessible password
      name: body.name,
      role: "VISITOR",
      status: "INACTIVE", // default access to off
      allowedAuthMethods: JSON.stringify(["FACE"]),
    })
    .returning();

  if (!user) return err("Failed to create user", 500);

  // 6. Set user id in Face++
  await facePlusPlus("face/setuserid", faceApiKey, faceApiSecret, { face_token: faceToken, user_id: user.username });
  await facePlusPlus("faceset/train", faceApiKey, faceApiSecret, { outer_id: facesetId });

  // 7. Save face credential
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
      ...(body.status !== undefined && {
        status: body.status as schema.User["status"],
      }),
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
      ...(body.status !== undefined && {
        status: body.status as schema.User["status"],
      }),
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


// Access Logs

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


// Temporary codes

app.get("/api/v1/temp-codes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const codes = await db
    .select()
    .from(schema.temporaryCodes)
    .orderBy(desc(schema.temporaryCodes.createdAt));
  return ok(codes);
});

app.post("/api/v1/temp-codes", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  type TempCodeBody = {
    location: string;
    accessType: string;
    validFrom: string;
    expiresAt: string;
    notes?: string;
  };
  const body = await c.req.json<TempCodeBody>();
  const code = generateTempCode();
  const [created] = await db
    .insert(schema.temporaryCodes)
    .values({ ...body, code, status: "ACTIVE" })
    .returning();
  return ok(created);
});

app.delete("/api/v1/temp-codes/:id", async (c) => {
  const db = drizzle(c.env.DB, { schema });
  const id = Number(c.req.param("id"));
  await db.delete(schema.temporaryCodes).where(eq(schema.temporaryCodes.id, id));
  return ok(null);
});


export default app;
