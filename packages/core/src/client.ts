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

const DEFAULT_MODEL = "V5";

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
    const h: Record<string, string> = {
      Cookie: cookieHeader(this.cookies),
      "Content-Type": "application/json",
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
    return (await res.json()) as T;
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
  }) {
    const payload: Record<string, unknown> = {
      make_instrumental: opts.make_instrumental ?? false,
      mv: opts.model ?? DEFAULT_MODEL,
      prompt: opts.prompt,
      generation_type: "TEXT",
      tags: opts.tags,
      title: opts.title,
      negative_tags: opts.negative_tags ?? "",
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
}
