import { Hono } from "hono";
import { Env } from "../types";

const app = new Hono<{ Bindings: Env }>();

// Face recognition routes are handled in esp.ts (require CAMERA_API_KEY):
//   POST /api/v1/face/enroll
//   POST /api/v1/face/verify
//
// Dashboard-side face enrollment (from R2 image) is in users.ts:
//   POST /api/v1/users/enroll-face

export default app;
