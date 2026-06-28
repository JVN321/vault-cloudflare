import { Hono } from "hono";
import { eq, desc, and, gt, lt } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "../../drizzle/schema";
import { Env } from "../types";
import { ok, err, hashPassword, verifyPassword, sha256Hex, arrayBufferToBase64, facePlusPlus, DEFAULT_SETTINGS, parseSettings } from "../utils/helpers";

const app = new Hono<{ Bindings: Env }>();


// Face Recognition (Face++ API proxy)

export default app;
