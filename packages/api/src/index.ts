import { SunoClient } from "../../core/src/client.ts";
import { loadCookies, saveCookies, saveJwt } from "../../core/src/session.ts";

const PORT = Number(process.env.PORT ?? 4123);
function getClient(): SunoClient {
  try {
    return new SunoClient();
  } catch {
    throw new Error("未ログイン: 先に `bun run login:cookie \"<Cookie>\"` を実行してください");
  }
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/v1/auth/ingest" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (body.jwt) saveJwt(body.jwt);
        if (body.cookies) saveCookies({ ...loadCookies(), ...body.cookies });
        if (body.session_id) getClient().setSession(body.session_id);
        return json({ ok: true });
      }
      if (url.pathname === "/v1/credits" && req.method === "GET") {
        return json(await getClient().credits());
      }
      if (url.pathname === "/v1/songs" && req.method === "POST") {
        const body = (await req.json()) as any;
        const ids = body.mode === "simple"
          ? await getClient().generateSimple(body.description, body.make_instrumental)
          : await getClient().generateCustom(body);
        return json({ ids }, 202);
      }
      if (url.pathname === "/v1/songs" && req.method === "GET") {
        const ids = url.searchParams.get("ids")?.split(",").filter(Boolean);
        return json(await getClient().feed(ids ?? undefined));
      }
      if (url.pathname === "/v1/library" && req.method === "GET") {
        return json(await getClient().feed());
      }
      if (url.pathname === "/v1/lyrics" && req.method === "POST") {
        const body = (await req.json()) as any;
        return json({ text: await getClient().generateLyrics(body.prompt) });
      }
      const audioMatch = url.pathname.match(/^\/v1\/songs\/([^/]+)\/audio$/);
      if (audioMatch && req.method === "GET") {
        const songs = await getClient().feed([audioMatch[1]]);
        const song = songs[0];
        if (!song?.audio_url) return json({ error: "not ready" }, 404);
        return Response.redirect(song.audio_url, 302);
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: (e as Error).message }, 500);
    }
  },
});

console.log(`suno-api listening on :${PORT}`);
