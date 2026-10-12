import type { BrowserContext } from "playwright";
import { PROFILE_DIR, ensureSunoDir, probeSession, saveCookies } from "./session.ts";

export async function openProfile(headless: boolean): Promise<BrowserContext> {
  ensureSunoDir();
  const { chromium } = await import("playwright");
  return chromium.launchPersistentContext(PROFILE_DIR, { headless });
}

export async function launchLogin(): Promise<void> {
  ensureSunoDir();
  const { chromium } = await import("playwright");
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("https://suno.com/", { waitUntil: "domcontentloaded" });

  console.log(">>> ブラウザで Suno にログインしてください。検出後に自動で閉じます（最大10分）。");
  const deadline = Date.now() + 10 * 60 * 1000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const record: Record<string, string> = {};
    for (const domain of ["https://suno.com", "https://auth.suno.com"]) {
      for (const c of await context.cookies(domain)) record[c.name] = c.value;
    }
    const clientCookie = record["__client"];
    if (!clientCookie) continue;
    const sid = await probeSession(clientCookie).catch(() => null);
    if (sid) {
      saveCookies(record);
      console.log(`>>> ログイン検出: session_id=${sid.slice(0, 12)}... Cookieを保存しました。`);
      await context.close();
      return;
    }
    console.log("... ログイン待ち（__client はあるがセッション未確立）");
  }
  await context.close();
  throw new Error("タイムアウト: 10分以内にログインが検出できませんでした");
}
