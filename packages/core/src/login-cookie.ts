import { CLERK_API_VERSION, CLERK_BASE, saveCookies } from "./session.ts";

const raw = process.argv[2] ?? process.env.SUNO_COOKIE;
if (!raw) {
  console.error("使い方: bun run login:cookie \"<Cookieヘッダの値>\" または SUNO_COOKIE 環境変数");
  process.exit(2);
}

const record: Record<string, string> = {};
for (const part of raw.split(";")) {
  const eq = part.indexOf("=");
  if (eq > 0) record[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
}
if (!record["__client"]) {
  console.error("NG: __client がCookieに含まれていません。?__clerk_api_version リクエストのCookie全体をコピーしてください");
  process.exit(1);
}

const url = `${CLERK_BASE}/v1/client?__clerk_api_version=${CLERK_API_VERSION}`;
const res = await fetch(url, { headers: { Authorization: record["__client"] } });
if (!res.ok) {
  console.error(`NG: セッション確認失敗 HTTP ${res.status}（Cookieが古い可能性があります）`);
  process.exit(1);
}
const data = (await res.json()) as any;
const sid = data?.response?.last_active_session_id;
if (!sid) {
  console.error("NG: last_active_session_id なし（未ログイン状態のCookieです）");
  process.exit(1);
}
saveCookies(record);
console.log(`OK: session_id=${String(sid).slice(0, 8)}... 保存しました。\n次: bun run doctor`);
