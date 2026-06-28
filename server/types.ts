export type Env = {
  DB: D1Database;
  IMAGES: R2Bucket;
  SESSION_SECRET: string;
  CAMERA_API_KEY: string;
  FACEPLUSPLUS_API_KEY?: string;
  FACEPLUSPLUS_API_SECRET?: string;
  /** Optional env-override admin credentials (set via wrangler secret or .dev.vars) */
  ADMIN_EMAIL?: string;
  ADMIN_PASSWORD?: string;
};
