import { defineConfig } from "drizzle-kit";
import * as fs from "fs";
import * as path from "path";

function getLocalD1DbPath(): string | null {
  const d1Dir = path.join(process.cwd(), ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  if (!fs.existsSync(d1Dir)) return null;
  const files = fs.readdirSync(d1Dir);
  const dbFile = files.find((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite");
  return dbFile ? path.join(d1Dir, dbFile) : null;
}

const localPath = getLocalD1DbPath();
const isLocal = !process.env["CLOUDFLARE_D1_TOKEN"] && localPath;

export default defineConfig(
  isLocal
    ? {
        schema: "./drizzle/schema.ts",
        out: "./drizzle/migrations",
        dialect: "sqlite",
        dbCredentials: {
          url: localPath,
        },
      }
    : {
        schema: "./drizzle/schema.ts",
        out: "./drizzle/migrations",
        dialect: "sqlite",
        driver: "d1-http",
        dbCredentials: {
          accountId: process.env["CLOUDFLARE_ACCOUNT_ID"] ?? "",
          databaseId: process.env["CLOUDFLARE_D1_DATABASE_ID"] ?? "",
          token: process.env["CLOUDFLARE_D1_TOKEN"] ?? "",
        },
      }
);

