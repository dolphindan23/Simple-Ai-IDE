import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DATA_DIR, ensureDataDirs } from "./paths";

const SESSION_SECRET_FILE = "session_secret";

export function getSessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  ensureDataDirs();
  const secretPath = path.join(DATA_DIR, SESSION_SECRET_FILE);

  if (fs.existsSync(secretPath)) {
    const stored = fs.readFileSync(secretPath, "utf8").trim();
    if (stored) {
      return stored;
    }
  }

  const secret = crypto.randomBytes(32).toString("hex");

  try {
    fs.writeFileSync(secretPath, secret, { mode: 0o600 });
  } catch {
    fs.writeFileSync(secretPath, secret);
  }

  return secret;
}

export function isSessionSecretFromEnv(): boolean {
  return !!process.env.SESSION_SECRET?.trim();
}

export function initializeSessionSecret(): void {
  const secret = getSessionSecret();
  const fromEnv = isSessionSecretFromEnv();

  process.env.SESSION_SECRET = secret;

  const isProduction = process.env.SIMPLEAIDE_ENV === "production" || process.env.NODE_ENV === "production";

  if (isProduction && !fromEnv) {
    console.warn(
      "\n⚠️  WARNING: Using auto-generated SESSION_SECRET from data directory.\n" +
      "   For clustered deployments, set SESSION_SECRET explicitly so all replicas share the same key.\n" +
      `   Secret stored at: ${path.join(DATA_DIR, SESSION_SECRET_FILE)}\n`
    );
  }
}
