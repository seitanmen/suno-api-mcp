import { SunoClient } from "../../core/src/client.ts";
import { loadCookies, loadJwt, saveCookies, saveJwt } from "../../core/src/session.ts";

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

const probes = new Map<string, any>();
const probeResults = new Map<string, any>();
const apiLog: string[] = [];

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    try {
      if (url.pathname === "/health") return json({ ok: true });
      if (url.pathname === "/v1/probe" && req.method === "POST") {
        const body = (await req.json()) as any;
        const id = Math.random().toString(36).slice(2, 10);
        probes.set(id, { ...body, claimed: false, token: body.token ?? loadJwt()?.jwt ?? null });
        return json({ id });
      }
      if (url.pathname === "/v1/probe/pending" && req.method === "GET") {
        for (const [id, p] of probes) {
          if (!p.claimed) {
            p.claimed = true;
            return json({ id, method: p.method, path: p.path, body: p.body ?? null, base: p.base ?? null, token: p.token ?? null, js: p.js ?? null });
          }
        }
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/v1/probe/result" && req.method === "POST") {
        const body = (await req.json()) as any;
        const cap = probes.get(body.id)?.full ? 500000 : 3000;
        probeResults.set(body.id, { status: body.status, text: String(body.text ?? "").slice(0, cap), at: Date.now() });
        return json({ ok: true });
      }
      if (url.pathname === "/v1/probe/results" && req.method === "GET") {
        return json(Object.fromEntries(probeResults));
      }
      if (url.pathname === "/v1/pfetch" && req.method === "POST") {
        const body = (await req.json()) as any;
        const id = Math.random().toString(36).slice(2, 10);
        probes.set(id, { ...body, claimed: false, full: true, token: body.token ?? loadJwt()?.jwt ?? null });
        for (let i = 0; i < 100; i++) {
          await new Promise((r) => setTimeout(r, 300));
          if (probeResults.has(id)) {
            const res = probeResults.get(id);
            probeResults.delete(id);
            probes.delete(id);
            return json(res);
          }
        }
        probes.delete(id);
        return json({ status: 0, text: "probe timeout: browser tab not polling?" }, 504);
      }
      if (url.pathname === "/v1/auth/ingest" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (body.jwt) saveJwt(body.jwt);
        if (body.cookies) saveCookies({ ...loadCookies(), ...body.cookies });
        if (body.session_id) getClient().setSession(body.session_id);
        return json({ ok: true });
      }
      if (url.pathname === "/v1/apilog" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (typeof body.line === "string") {
          apiLog.push(body.line.slice(0, 3000));
          while (apiLog.length > 200) apiLog.shift();
        }
        return json({ ok: true });
      }
      if (url.pathname === "/v1/apilog" && req.method === "GET") {
        return json({ lines: apiLog });
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
      if (url.pathname === "/v1/speech" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.prompt) return json({ error: "prompt required" }, 400);
        return json({ ids: await getClient().generateSpeech(body.prompt, body) }, 202);
      }
      if (url.pathname === "/v1/sounds" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.prompt) return json({ error: "prompt required" }, 400);
        return json({ ids: await getClient().generateSound(body.prompt) }, 202);
      }
      if (url.pathname === "/v1/clips" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        return json(await getClient().clip(id));
      }
      if (url.pathname === "/v1/models" && req.method === "GET") {
        return json({ models: await getClient().getModels() });
      }
      if (url.pathname === "/v1/uploads/image" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.data_base64) return json({ error: "data_base64 required" }, 400);
        const bin = Uint8Array.from(atob(body.data_base64), (ch) => ch.charCodeAt(0));
        return json(await getClient().uploadImage(bin, body.content_type ?? "image/png"));
      }
      if (url.pathname === "/v1/uploads/audio" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.data_base64 || !body.filename) return json({ error: "data_base64 and filename required" }, 400);
        const bin = Uint8Array.from(atob(body.data_base64), (ch) => ch.charCodeAt(0));
        return json(await getClient().uploadAudio(bin, body.filename, body), 202);
      }
      if (url.pathname === "/v1/persona" && req.method === "POST") {
        const body = (await req.json()) as any;
        return json(await getClient().createPersona(body), 202);
      }
      if (url.pathname === "/v1/persona" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        return json(await getClient().getPersona(id));
      }
      if (url.pathname === "/v1/download" && req.method === "GET") {
        const id = url.searchParams.get("id");
        if (!id) return json({ error: "id required" }, 400);
        const dl = await getClient().downloadClip(id);
        return new Response(dl.bytes, {
          headers: {
            "Content-Type": dl.ext === "webm" ? "audio/webm" : "audio/mp4",
            "Content-Disposition": `attachment; filename="${encodeURIComponent(dl.filename)}"`,
          },
        });
      }
      if (url.pathname === "/v1/extend" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.audio_id) return json({ error: "audio_id required" }, 400);
        const ids = await getClient().extendAudio(body.audio_id, body);
        return json({ ids }, 202);
      }
      if (url.pathname === "/v1/concat" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.clip_id) return json({ error: "clip_id required" }, 400);
        return json(await getClient().concatenate(body.clip_id));
      }
      if (url.pathname === "/v1/stems" && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!body.song_id) return json({ error: "song_id required" }, 400);
        return json(await getClient().generateStems(body.song_id));
      }
      if (url.pathname === "/v1/playlists" && req.method === "POST") {
        const body = (await req.json()) as any;
        return json(await getClient().createPlaylist(body.name ?? "新規プレイリスト"));
      }
      const plMatch = url.pathname.match(/^\/v1\/playlists\/([^/]+)$/);
      if (plMatch && req.method === "GET") {
        return json(await getClient().getPlaylist(plMatch[1]));
      }
      const plAddMatch = url.pathname.match(/^\/v1\/playlists\/([^/]+)\/tracks$/);
      if (plAddMatch && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!Array.isArray(body.clip_ids)) return json({ error: "clip_ids required" }, 400);
        return json(await getClient().addPlaylistTracks(plAddMatch[1], body.clip_ids));
      }
      const plDelMatch = url.pathname.match(/^\/v1\/playlists\/([^/]+)\/tracks\/remove$/);
      if (plDelMatch && req.method === "POST") {
        const body = (await req.json()) as any;
        if (!Array.isArray(body.indexes)) return json({ error: "indexes required" }, 400);
        return json(await getClient().removePlaylistTracks(plDelMatch[1], body.indexes));
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
