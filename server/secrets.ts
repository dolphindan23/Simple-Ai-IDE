import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100000;

const PROJECT_ROOT = path.resolve(process.cwd());
const SECRETS_DIR = path.join(PROJECT_ROOT, ".simpleide");
const SECRETS_FILE = path.join(SECRETS_DIR, "secrets.enc");

interface SecretsVault {
  secrets: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, "sha256");
}

function encrypt(data: string, password: string): Buffer {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const key = deriveKey(password, salt);
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  
  return Buffer.concat([salt, iv, authTag, encrypted]);
}

function decrypt(encryptedData: Buffer, password: string): string {
  const salt = encryptedData.subarray(0, SALT_LENGTH);
  const iv = encryptedData.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = encryptedData.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const data = encryptedData.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  
  const key = deriveKey(password, salt);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  
  return decipher.update(data) + decipher.final("utf8");
}

export function vaultExists(): boolean {
  return fs.existsSync(SECRETS_FILE);
}

export function createVault(masterPassword: string): void {
  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
  }
  
  const vault: SecretsVault = {
    secrets: {},
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  
  const encrypted = encrypt(JSON.stringify(vault), masterPassword);
  fs.writeFileSync(SECRETS_FILE, encrypted);
}

export function unlockVault(masterPassword: string): SecretsVault | null {
  if (!vaultExists()) {
    return null;
  }
  
  try {
    const encryptedData = fs.readFileSync(SECRETS_FILE);
    const decrypted = decrypt(encryptedData, masterPassword);
    return JSON.parse(decrypted) as SecretsVault;
  } catch (error) {
    return null;
  }
}

export function saveVault(vault: SecretsVault, masterPassword: string): void {
  if (!fs.existsSync(SECRETS_DIR)) {
    fs.mkdirSync(SECRETS_DIR, { recursive: true });
  }
  
  vault.updatedAt = new Date().toISOString();
  const encrypted = encrypt(JSON.stringify(vault), masterPassword);
  fs.writeFileSync(SECRETS_FILE, encrypted);
}

export function getSecret(vault: SecretsVault, key: string): string | undefined {
  return vault.secrets[key];
}

export function setSecret(vault: SecretsVault, key: string, value: string): void {
  vault.secrets[key] = value;
}

export function deleteSecret(vault: SecretsVault, key: string): boolean {
  if (key in vault.secrets) {
    delete vault.secrets[key];
    return true;
  }
  return false;
}

export function listSecretKeys(vault: SecretsVault): string[] {
  return Object.keys(vault.secrets);
}

export function maskSecret(value: string): string {
  if (value.length <= 4) {
    return "****";
  }
  return value.slice(0, 2) + "..." + value.slice(-2);
}
