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

  /** Captcha-era fallback: drive the real suno.com UI via Tampermonkey bridge + trusted keyboard.
   *  Chain (live-verified 2026-10-12): apilog CMDCALL fills prompt & focuses 作成 → osascript Return → new clips in feed. */
  private async bridgeCall(id: string, js: string, timeoutMs = 30000): Promise<any> {
    await fetch("http://localhost:4123/v1/apilog", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ line: `CMDCALL ${id} ||| ${js}` }),
    });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 4000));
      const d: any = await (await fetch("http://localhost:4123/v1/apilog")).json().catch(() => null);
      const hit = (d?.lines ?? []).find((l: string) => l.startsWith(`CMDRES {"id":"${id}`));
      if (hit) return JSON.parse(hit.slice(8));
    }
    throw new Error("bridge command timeout（suno.comタブとbridge 0.7.7+が必要）");
  }

  async generateViaUI(params: { prompt: string }): Promise<string[]> {
    if (process.platform !== "darwin") throw new Error("generateViaUI はmacOSのみ（osascript依存）");
    const before = new Set((await this.feed()).map((c) => c.id));
    const { execFile } = await import("node:child_process");
    const sh = (cmd: string) => new Promise<void>((res, rej) => execFile("osascript", ["-e", cmd], (e: any) => (e ? rej(e) : res())));
    const id = "gen" + Date.now().toString(36).slice(-8);
    const prompt = params.tags ? `${params.prompt} (${params.tags})` : params.prompt;
    const fill = await this.bridgeCall(id, `
      const ta = [...document.querySelectorAll("textarea")].find(t => t.id !== "BFI_DATA");
      if (!ta) return "NO-TA";
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      setter.call(ta, ${JSON.stringify(prompt)});
      ta.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise(r => setTimeout(r, 300));
      const btn = [...document.querySelectorAll("button")].find(b => (b.textContent || "").trim() === "作成" && b.getBoundingClientRect().width > 100);
      if (!btn) return "NO-BTN";
      btn.scrollIntoView({ block: "center" });
      btn.focus();
      return "FOCUSED";
    `);
    const v = String(fill?.v ?? "");
    if (!v.includes("FOCUSED")) throw new Error(`generateViaUI: ${v || "no reply"}`);
    await sh('tell application "Google Chrome" to activate');
    await new Promise((r) => setTimeout(r, 600));
    await sh('tell application "System Events" to keystroke return');
    for (let i = 0; i < 12; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      const fresh = (await this.feed()).filter((c) => !before.has(c.id));
      if (fresh.length > 0) return fresh.map((c) => c.id);
    }
    throw new Error("generateViaUI: 新しいクリップが現れません（クレジット・可視性・bridgeを確認）");
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
    use_personalization?: boolean;
    personalization_user_uuid?: string;
    do_personalize_lyrics?: boolean;
    /** References (clip ids from library) */
    audio_refs?: { clip_id: string; style_prompt?: string; lyrics?: string; duration_s?: number }[];
    sample_clip_ids?: string[];
    sample_clip_starts?: (number | null)[];
    sample_clip_ends?: (number | null)[];
    chop_sample_clip_id?: string;
    chop_sample_start_s?: number | null;
    chop_sample_end_s?: number | null;
    cover_clip_id?: string;
    cover_start_s?: number;
    cover_end_s?: number;
    mashup_clip_ids?: string[];
    continue_clip_id?: string;
    continue_at?: number;
    underpainting_clip_id?: string;
    overpainting_clip_id?: string;
    user_uploaded_image_ids?: string[];
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
      ...(opts.use_personalization ? { use_personalization: true } : {}),
      ...(opts.personalization_user_uuid ? { personalization_user_uuid: opts.personalization_user_uuid } : {}),
      ...(typeof opts.do_personalize_lyrics === "boolean" ? { do_personalize_lyrics: opts.do_personalize_lyrics } : {}),
      ...(opts.audio_refs?.length ? { audio_refs: opts.audio_refs } : {}),
      ...(opts.sample_clip_ids?.length ? { sample_clip_ids: opts.sample_clip_ids } : {}),
      ...(opts.sample_clip_starts ? { sample_clip_starts: opts.sample_clip_starts } : {}),
      ...(opts.sample_clip_ends ? { sample_clip_ends: opts.sample_clip_ends } : {}),
      ...(opts.chop_sample_clip_id ? { chop_sample_clip_id: opts.chop_sample_clip_id } : {}),
      ...(opts.chop_sample_start_s !== undefined ? { chop_sample_start_s: opts.chop_sample_start_s } : {}),
      ...(opts.chop_sample_end_s !== undefined ? { chop_sample_end_s: opts.chop_sample_end_s } : {}),
      ...(opts.cover_clip_id ? { cover_clip_id: opts.cover_clip_id, cover_start_s: opts.cover_start_s ?? 0, cover_end_s: opts.cover_end_s ?? null } : {}),
      ...(opts.mashup_clip_ids?.length ? { mashup_clip_ids: opts.mashup_clip_ids } : {}),
      ...(opts.continue_clip_id ? { continue_clip_id: opts.continue_clip_id, continue_at: opts.continue_at ?? 0 } : {}),
      ...(opts.underpainting_clip_id ? { underpainting_clip_id: opts.underpainting_clip_id } : {}),
      ...(opts.overpainting_clip_id ? { overpainting_clip_id: opts.overpainting_clip_id } : {}),
      ...(opts.user_uploaded_image_ids?.length ? { user_uploaded_image_ids: opts.user_uploaded_image_ids } : {}),
    };
    try {
      const data = await this.api<any>("POST", "/api/generate/v2/", payload);
      return (data.clips as any[]).map((c) => c.id as string);
    } catch (e: any) {
      if (/422|token_validation|couldn't verify/i.test(String(e.message)) && process.env.SUNO_UI_FALLBACK !== "0" && !opts.audio_refs?.length && !opts.cover_clip_id && !opts.sample_clip_ids?.length) {
        return this.generateViaUI({ prompt: opts.prompt, tags: opts.tags } as any);
      }
      throw e;
    }
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

  /** Speech (goose model via v2-web). backing_music=false for dry voiceover. */
  async generateSpeech(prompt: string, opts?: { backing_music?: boolean; vocal_gender?: "male" | "female" }) {
    const data = await this.api<any>("POST", "/api/generate/v2-web/", {
      prompt,
      is_speech: true,
      ...(typeof opts?.backing_music === "boolean" ? { backing_music: opts.backing_music } : {}),
      ...(opts?.vocal_gender ? { vocal_gender: opts.vocal_gender } : {}),
    });
    return (data.clips as any[]).map((c) => c.id as string);
  }

  /** Sound effects (seeds model via v2-web). */
  async generateSound(prompt: string) {
    const data = await this.api<any>("POST", "/api/generate/v2-web/", { prompt, task: "sound" });
    return (data.clips as any[]).map((c) => c.id as string);
  }

  /** Known model versions (offline fallback). Live list via getModels(). */
  static MODELS = [
    { id: "chirp-hawk", label: "v6 song (default)", verified: true },
    { id: "chirp-hawk-wild", label: "v6 wild", verified: false },
    { id: "chirp-v4-5-plus", label: "v4.5+", verified: false },
    { id: "chirp-v4-5", label: "v4.5", verified: false },
    { id: "chirp-v4", label: "v4", verified: false },
    { id: "chirp-v3-5", label: "v3.5 legacy", verified: false },
    { id: "chirp-goose", label: "v6-mini (speech)", verified: true },
    { id: "chirp-sfx", label: "sounds", verified: true },
  ];

  /**
   * Live model list from billing info (reflects additions/updates automatically).
   * Falls back to static MODELS when unreachable.
   */
  async getModels() {
    try {
      const info = await this.api<any>("GET", "/api/billing/info");
      const live = (info.models as any[])?.map((m) => ({
        id: m.external_key as string,
        label: m.name as string,
        description: m.description as string ?? "",
        default: !!m.is_default_model,
        can_use: !!m.can_use,
        major_version: m.major_version,
        features: m.features ?? [],
        verified: ["chirp-hawk", "chirp-goose", "chirp-sfx"].includes(m.external_key),
      }));
      if (live?.length) return live;
    } catch { /* offline fallback */ }
    return SunoClient.MODELS;
  }

  /** S3 presigned-POST helper shared by uploads. */
  private async s3Post(url: string, fields: Record<string, string>, data: Uint8Array, contentType: string, filename: string) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", new Blob([new Uint8Array(data)], { type: contentType }), filename);
    const put = await fetch(url, { method: "POST", body: form });
    if (!put.ok) throw new Error(`S3 upload: HTTP ${put.status}`);
  }

  /** Image upload: presigned S3 -> complete -> asset. Returns asset id for user_uploaded_image_ids. */
  /** Image upload for user_uploaded_image_ids: initiate -> S3 -> upload-finish (moderation). Returns { upload_id }. */
  async uploadImage(data: Uint8Array, contentType: string) {
    const extByType: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
    const ext = extByType[contentType] ?? contentType.split("/").pop() ?? "png";
    const init = await this.api<any>("POST", "/api/uploads/image/", { extension: ext });
    const uploadId = init.id as string;
    await this.s3Post(init.url, init.fields, data, contentType, "image." + ext);
    const fin = await this.api<any>("POST", `/api/uploads/image/${uploadId}/upload-finish/`, {});
    if (fin?.moderation_status === "rejected") throw new Error("image moderation rejected");
    return { upload_id: uploadId, moderation_status: fin?.moderation_status ?? "ok" };
  }

  /**
   * Audio upload: initiate -> S3 -> poll status -> finish -> initialize-clip.
   * Returns { upload_id, clip_id, title, has_vocal }.
   */
  async uploadAudio(data: Uint8Array, filename: string, opts?: { upload_type?: string; is_stem_mix?: boolean; contentType?: string }) {
    const ext = (filename.split(".").pop() ?? "mp3").toLowerCase();
    const init = await this.api<any>("POST", "/api/uploads/audio/", {
      extension: ext,
      is_stem_mix: opts?.is_stem_mix ?? false,
      upload_type: opts?.upload_type ?? "file_upload",
    });
    const uploadId = init.id as string;
    await this.s3Post(init.url, init.fields, data, opts?.contentType ?? "audio/mpeg", filename);
    await this.api("POST", `/api/uploads/audio/${uploadId}/upload-finish/`, {
      upload_type: opts?.upload_type ?? "file_upload",
      upload_filename: filename,
    });
    let status: any = null;
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      status = await this.api<any>("GET", `/api/uploads/audio/${uploadId}/`);
      if (status?.status === "complete") break;
      if (status?.error_type || status?.status === "failed") {
        throw new Error(`audio processing failed: ${status?.error_type ?? "unknown"}`);
      }
    }
    if (status?.status !== "complete") throw new Error("audio processing timeout");
    const clip = await this.api<any>("POST", `/api/uploads/audio/${uploadId}/initialize-clip/`, {});
    return { upload_id: uploadId, clip_id: clip.clip_id as string, title: status.title, has_vocal: status.has_vocal };
  }

  /** Audio upload status query (processing/complete/error + error_type e.g. upload_failure_match_acrcloud). */
  async audioUploadStatus(uploadId: string) {
    return this.api<any>("GET", `/api/uploads/audio/${uploadId}/`);
  }

  /** Image asset status query (ready/failed). */
  async imageAssetStatus(assetId: string) {
    return this.api<any>("GET", `/api/visual/assets/${assetId}`);
  }

  /** Persona (voice) create passthrough. vox_audio_id typically comes from an uploaded/voice clip. */
  async createPersona(params: Record<string, unknown>) {
    return this.api<any>("POST", "/api/persona/create/", params);
  }

  async getPersona(persona_id: string) {
    return this.api<any>("GET", `/api/persona/get-persona/${persona_id}/`);
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

  /** Concat requires a clip with metadata.history (e.g. an extended clip). Plain clips -> 400 "Bad history". */
  async concatenate(clipId: string) {
    return this.api("POST", "/api/generate/concat/v2/", { clip_id: clipId, is_infill: false });
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
