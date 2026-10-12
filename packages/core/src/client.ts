import {
  CLERK_API_VERSION,
  CLERK_BASE,
  JWT_MAX_AGE_MS,
  STUDIO_BASE,
  cookieHeader,
  loadCookies,
  loadJwt,
  saveCookies,
  saveJwt,
} from "./session.ts";

export interface SongInfo {
  id: string;
  title: string;
  status: string;
  audio_url: string;
  video_url: string;
  image_url: string;
  lyric: string;
  model_name: string;
  tags: string;
  created_at: string;
}

// chirp-carp routes to chirp-halibut which currently fails renders; hawk verified working.
const DEFAULT_MODEL = "chirp-hawk";

export class SunoClient {
  private cookies: Record<string, string>;
  private sid: string | null = null;
  private jwt: string | null = null;
  private jwtAt = 0;

  constructor(cookies?: Record<string, string>) {
    this.cookies = cookies ?? loadCookies();
    const stored = loadJwt();
    this.jwt = stored?.jwt ?? null;
    this.jwtAt = stored?.at ?? 0;
    if (Object.keys(this.cookies).length === 0 && !this.jwt) {
      throw new Error("セッションがありません。Tampermonkey Bridge か `bun run login:cookie` で連携してください");
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const deviceId = this.cookies["suno_device_id"] ?? this.cookies["ajs_anonymous_id"] ?? "unknown";
    const h: Record<string, string> = {
      Cookie: cookieHeader(this.cookies),
      "Content-Type": "application/json",
      "Affiliate-Id": "undefined",
      "Device-Id": `"${deviceId}"`,
      "x-suno-client": "Android prerelease-4nt180t 1.0.42",
      "X-Requested-With": "com.suno.android",
      ...extra,
    };
    if (this.jwt) h["Authorization"] = `Bearer ${this.jwt}`;
    return h;
  }

  setSession(sid: string) {
    this.sid = sid;
  }

  /** Resolve Clerk session id from the __client cookie. */
  async getSessionId(): Promise<string> {
    const clientCookie = this.cookies["__client"];
    if (!clientCookie) throw new Error("__client Cookieがありません。再ログインしてください");
    const url = `${CLERK_BASE}/v1/client?__clerk_api_version=${CLERK_API_VERSION}`;
    const res = await fetch(url, { headers: { Authorization: clientCookie } });
    if (!res.ok) throw new Error(`セッション取得失敗: HTTP ${res.status}（Cookie更新が必要かもしれません）`);
    const data = (await res.json()) as any;
    const sid = data?.response?.last_active_session_id;
    if (!sid) throw new Error("last_active_session_id がありません。再ログインしてください");
    this.sid = sid;
    return sid;
  }

  /** Refresh the short-lived JWT used by studio APIs. */
  async keepAlive(): Promise<string> {
    if (this.jwt && Date.now() - this.jwtAt < JWT_MAX_AGE_MS) return this.jwt;
    if (!this.cookies["__client"]) {
      throw new Error("JWT期限切れ・__clientなし。suno.com を開いて Bridge に再送させてください");
    }
    if (!this.sid) await this.getSessionId();
    const clientCookie = this.cookies["__client"]!;
    const url = `${CLERK_BASE}/v1/client/sessions/${this.sid}/tokens?__clerk_api_version=${CLERK_API_VERSION}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: clientCookie, "Content-Type": "application/json" },
      body: "{}",
    });
    if (!res.ok) throw new Error(`トークン更新失敗: HTTP ${res.status}`);
    const data = (await res.json()) as any;
    if (!data?.jwt) throw new Error("JWTが取得できませんでした");
    this.jwt = data.jwt;
    this.jwtAt = Date.now();
    saveJwt(data.jwt);
    return this.jwt;
  }

  private async api<T>(method: string, path: string, body?: unknown): Promise<T> {
    await this.keepAlive();
    const res = await fetch(`${STUDIO_BASE}${path}`, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Persist refreshed cookies
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length > 0) {
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const eq = pair.indexOf("=");
        if (eq > 0) this.cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
      }
      saveCookies(this.cookies);
    }
    if (!res.ok) throw new Error(`${method} ${path}: HTTP ${res.status} ${await res.text().then((t) => t.slice(0, 300))}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : { ok: true }) as T;
  }

  async credits() {
    const data = await this.api<any>("GET", "/api/billing/info/");
    return {
      credits_left: data.total_credits_left,
      period: data.period,
      monthly_limit: data.monthly_limit,
      monthly_usage: data.monthly_usage,
    };
  }

  async captchaCheck(): Promise<boolean> {
    const data = await this.api<any>("POST", "/api/c/check", { ctype: "generation" });
    return data.required === true;
  }

  async generateCustom(opts: {
    prompt: string;
    tags: string;
    title: string;
    make_instrumental?: boolean;
    negative_tags?: string;
    model?: string;
    vocal_gender?: "male" | "female";
    gen_duration?: number;
    is_max_mode?: boolean;
    is_mumble?: boolean;
    control_sliders?: {
      weirdness_constraint?: number;
      style_weight?: number;
      audio_weight?: number;
    };
  }) {
    const payload: Record<string, unknown> = {
      make_instrumental: opts.make_instrumental ?? false,
      mv: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt,
      generation_type: "TEXT",
      tags: opts.tags,
      title: opts.title,
      negative_tags: opts.negative_tags ?? "",
      ...(opts.vocal_gender ? { vocal_gender: opts.vocal_gender } : {}),
      ...(typeof opts.gen_duration === "number" ? { gen_duration: opts.gen_duration } : {}),
      ...(typeof opts.is_max_mode === "boolean" ? { is_max_mode: opts.is_max_mode } : {}),
      ...(typeof opts.is_mumble === "boolean" ? { is_mumble: opts.is_mumble } : {}),
      ...(opts.control_sliders ? { control_sliders: opts.control_sliders } : {}),
    };
    const data = await this.api<any>("POST", "/api/generate/v2/", payload);
    return (data.clips as any[]).map((c) => c.id as string);
  }

  async generateSimple(description: string, make_instrumental = false) {
    const payload = {
      make_instrumental,
      mv: DEFAULT_MODEL,
      gpt_description_prompt: description,
      generation_type: "TEXT",
      prompt: "",
    };
    const data = await this.api<any>("POST", "/api/generate/v2/", payload);
    return (data.clips as any[]).map((c) => c.id as string);
  }

  async feed(ids?: string[]): Promise<SongInfo[]> {
    const q = ids?.length ? `?ids=${ids.join(",")}` : "";
    const data = await this.api<any>("GET", `/api/feed/v2${q}`);
    return (data.clips as any[]).map((a) => ({
      id: a.id,
      title: a.title,
      status: a.status,
      audio_url: a.audio_url,
      video_url: a.video_url,
      image_url: a.image_url,
      lyric: a.metadata?.prompt ?? "",
      model_name: a.model_name,
      tags: a.metadata?.tags ?? "",
      created_at: a.created_at,
    }));
  }

  async waitFor(ids: string[], timeoutMs = 300000, intervalMs = 8000): Promise<SongInfo[]> {
    const start = Date.now();
    let last: SongInfo[] = [];
    while (Date.now() - start < timeoutMs) {
      last = await this.feed(ids);
      if (last.every((s) => s.status === "complete" || s.status === "streaming" || s.status === "error")) {
        return last;
      }
      await new Promise((r) => setTimeout(r, intervalMs));
    }
    return last;
  }

  async generateLyrics(prompt: string): Promise<string> {
    const gen = await this.api<any>("POST", "/api/generate/lyrics/", { prompt });
    const id = gen.id;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const data = await this.api<any>("GET", `/api/generate/lyrics/${id}`);
      if (data.status === "complete") return data.text ?? JSON.stringify(data).slice(0, 2000);
      if (data.status === "error") throw new Error("歌詞生成エラー");
    }
    throw new Error("歌詞生成タイムアウト");
  }

  async clip(clipId: string) {
    return this.api("GET", `/api/clip/${clipId}`);
  }

  /** Playback-path audio fetch (AES-CTR decrypt). Does not use the counted download endpoint. */
  async downloadClip(clipId: string): Promise<{ filename: string; ext: string; bytes: Uint8Array }> {
    const clip = (await this.clip(clipId)) as any;
    let audioUrl: string | undefined;
    let ext = "m4a";
    for (const m of clip.media_urls ?? []) {
      const ctype = String(m.content_type ?? "").toLowerCase();
      const delivery = String(m.delivery ?? "").toLowerCase();
      if (!m.url || (delivery && delivery !== "progressive")) continue;
      if (ctype.startsWith("video") || ctype === "mp4") continue;
      audioUrl = m.url;
      ext = ctype.includes("webm") ? "webm" : "m4a";
      break;
    }
    audioUrl ??= clip.audio_url;
    if (!audioUrl) throw new Error("audio_url がありません");
    const rights = await this.api<any>("POST", "/api/mango/rights", {
      content_params: { content_id: clipId, content_type: "clip" },
    });
    const enc = new TextEncoder();
    const sha = async (s: string) =>
      crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", enc.encode(s)), { name: "AES-GCM" }, false, ["decrypt"]);
    const candidates: CryptoKey[] = [];
    if (this.jwt) candidates.push(await sha(this.jwt));
    if (rights.glt) candidates.push(await sha(rights.glt));
    if (!candidates.length) throw new Error("JWTがありません");
    const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
    const cipher = await (await fetch(audioUrl)).arrayBuffer();
    let plain: Uint8Array | null = null;
    let lastErr: unknown = null;
    for (const g of candidates) {
      try {
        const unwrap = async (w: Uint8Array) =>
          crypto.subtle.decrypt({ name: "AES-GCM", iv: w.slice(0, 12), additionalData: enc.encode(clipId) }, g, w.slice(12));
        const ctrKey = await crypto.subtle.importKey("raw", await unwrap(b64(rights.key)), { name: "AES-CTR" }, false, ["decrypt"]);
        const iv = new Uint8Array(await unwrap(b64(rights.iv)));
        plain = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CTR", counter: iv, length: 128 }, ctrKey, cipher));
        if (plain[4] === 0x66 && plain[5] === 0x74 && plain[6] === 0x79 && plain[7] === 0x70) break;
        if (plain[0] === 0x1a && plain[1] === 0x45 && plain[2] === 0xdf && plain[3] === 0xa3) break;
        plain = null;
      } catch (e) {
        lastErr = e;
        plain = null;
      }
    }
    if (!plain) throw new Error(`復号失敗: ${String(lastErr ?? "unknown").slice(0, 120)}`);
    if (plain[0] === 0x1a && plain[1] === 0x45 && plain[2] === 0xdf && plain[3] === 0xa3) ext = "webm";
    const safeTitle = String(clip.title ?? clipId).replace(/[\\/:*?"<>|]/g, "_");
    return { filename: `${safeTitle} [${clipId.slice(0, 8)}].${ext}`, ext, bytes: plain };
  }

  async extendAudio(audioId: string, opts: { prompt?: string; tags?: string; title?: string; continueAt?: number; model?: string }) {
    const payload: Record<string, unknown> = {
      make_instrumental: false,
      mv: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt ?? "",
      generation_type: "TEXT",
      tags: opts.tags ?? "",
      title: opts.title ?? "",
      task: "extend",
      continue_clip_id: audioId,
      continue_at: opts.continueAt,
    };
    const data = await this.api<any>("POST", "/api/generate/v2/", payload);
    return (data.clips as any[]).map((c) => c.id as string);
  }

  async concatenate(clipId: string) {
    return this.api("POST", "/api/generate/concat/v2/", { clip_id: clipId });
  }

  async generateStems(songId: string) {
    return this.api("POST", `/api/edit/stems/${songId}`, {});
  }

  async createPlaylist(name: string) {
    return this.api<any>("POST", "/api/playlist/create", { name });
  }

  async getPlaylist(playlistId: string) {
    return this.api<any>("GET", `/api/playlist/${playlistId}`);
  }

  async addPlaylistTracks(playlistId: string, clipIds: string[]) {
    return this.api<any>("POST", `/api/playlist/v2/${playlistId}/tracks/add`, { clip_ids: clipIds });
  }

  async removePlaylistTracks(playlistId: string, indexes: number[]) {
    return this.api<any>("POST", "/api/playlist/update_clips/", {
      playlist_id: playlistId,
      update_type: "remove",
      metadata: { indexes },
    });
  }
}
