import { createHash, randomBytes } from "node:crypto";

const PREFIX = "mk_";
const API_KEY_PATTERN = /^mk_[A-Za-z0-9_-]{43}$/;

// make a new api key
export function generateApiKey(): string {
  return PREFIX + randomBytes(32).toString("base64url");
}

// hash the key before saving it
export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

// check if the key has the right format
export function looksLikeApiKey(key: string): boolean {
  return API_KEY_PATTERN.test(key);
}