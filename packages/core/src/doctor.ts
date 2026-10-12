import { SunoClient } from "./client.ts";
import { COOKIES_PATH, PROFILE_DIR } from "./session.ts";
import { existsSync } from "node:fs";

let ok = true;
console.log(`profile: ${PROFILE_DIR} (${existsSync(PROFILE_DIR) ? "あり" : "なし"})`);
console.log(`cookies: ${COOKIES_PATH} (${existsSync(COOKIES_PATH) ? "あり" : "なし"})`);
try {
  const c = new SunoClient();
  const sid = await c.getSessionId();
  console.log(`session: OK (${sid.slice(0, 8)}...)`);
  await c.keepAlive();
  console.log("jwt: OK");
  console.log("credits:", JSON.stringify(await c.credits()));
} catch (e) {
  ok = false;
  console.log("NG:", (e as Error).message);
}
process.exit(ok ? 0 : 1);
