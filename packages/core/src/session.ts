import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SUNO_DIR = join(homedir(), ".suno-api");
export const PROFILE_DIR = join(SUNO_DIR, "browser-profile");
export const COOKIES_PATH = join(SUNO_DIR, "cookies.json");
export const JWT_PATH = join(SUNO_DIR, "jwt.json");
export const JWT_MAX_AGE_MS = 50 * 60 * 1000;

export const CLERK_BASE = "https://auth.suno.com";
export const STUDIO_BASE = "https://studio-api.prod.suno.com";
export const CLERK_API_VERSION = "2025-11-10";

function ensureDir() {
  mkdirSync(SUNO_DIR, { recursive: true });
}

export function loadCookies(): Record<string, string> {
  if (!existsSync(COOKIES_PATH)) return {};
  return JSON.parse(readFileSync(COOKIES_PATH, "utf8"));
}

export function saveCookies(cookies: Record<string, string>) {
  ensureDir();
  writeFileSync(COOKIES_PATH, JSON.stringify(cookies, null, 2));
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

export async function probeSession(clientCookie: string): Promise<string | null> {
  const url = `${CLERK_BASE}/v1/client?__clerk_api_version=${CLERK_API_VERSION}`;
  const res = await fetch(url, { headers: { Authorization: clientCookie } });
  if (!res.ok) return null;
  const data = (await res.json()) as any;
  return data?.response?.last_active_session_id ?? null;
}

export function ensureSunoDir() {
  ensureDir();
}

export function loadJwt(): { jwt: string; at: number } | null {
  if (!existsSync(JWT_PATH)) return null;
  try {
    const { jwt, at } = JSON.parse(readFileSync(JWT_PATH, "utf8"));
    if (!jwt || Date.now() - at > JWT_MAX_AGE_MS) return null;
    return { jwt, at };
  } catch {
    return null;
  }
}

export function saveJwt(jwt: string) {
  ensureDir();
  writeFileSync(JWT_PATH, JSON.stringify({ jwt, at: Date.now() }));
}
