import { execFileSync, execSync } from "child_process";
import { webcrypto } from "crypto";

const crypto = webcrypto;

async function hashPassword(password) {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArr = new Uint8Array(bits);
  const saltHex = Buffer.from(salt).toString("hex");
  const hashHex = Buffer.from(hashArr).toString("hex");
  return `pbkdf2:${saltHex}:${hashHex}`;
}

async function main() {
  console.log("Generating password hash for default user...");
  const password = "admin123";
  const hash = await hashPassword(password);

  // Build the SQL string in JS — the allowed_auth_methods is proper JSON
  const authMethods = JSON.stringify(["PIN", "QR", "FACE"]);
  const sql = `INSERT OR IGNORE INTO users (id, username, email, password_hash, name, role, status, allowed_auth_methods) VALUES (1, 'admin', 'admin@vault.io', '${hash}', 'Admin User', 'ADMIN', 'ACTIVE', '${authMethods}');`;

  console.log("Running local migration check first...");
  try {
    // Pass "y\n" via stdin to auto-confirm the migration prompt
    execSync("pnpm db:migrate", { stdio: ["pipe", "inherit", "inherit"], input: "y\n" });
  } catch {
    console.error("Migration failed, trying to continue seed anyway...");
  }

  console.log("Inserting admin user into local D1 database...");
  try {
    // Use execFileSync with an args array — no shell involved, so no quote mangling
    execFileSync(
      "npx",
      ["wrangler", "d1", "execute", "vault-db", "--local", "--command", sql],
      { stdio: "inherit" }
    );
    console.log("\n==================================================");
    console.log("Success! Local admin user seeded.");
    console.log("Email:    admin@vault.io");
    console.log("Password: admin123");
    console.log("==================================================");
  } catch (err) {
    console.error("Failed to seed local database:", err.message);
  }
}

main();
