import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { SunoClient } from "../../core/src/client.ts";

function getClient(): SunoClient {
  try {
    return new SunoClient();
  } catch {
    throw new Error("未ログイン: 先に `bun run login:cookie \"<Cookie>\"` を実行してください");
  }
}
const server = new McpServer({ name: "suno-selfhost", version: "0.1.0" });

server.registerTool(
  "suno_get_credits",
  { description: "残クレジット照会", inputSchema: {} },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().credits()) }],
  })
);

server.registerTool(
  "suno_generate_song",
  {
    description: "カスタムモード生成（歌詞+スタイル指定）",
    inputSchema: {
      prompt: z.string(),
      tags: z.string(),
      title: z.string(),
      make_instrumental: z.boolean().optional(),
      negative_tags: z.string().optional(),
      model: z.string().optional(),
      vocal_gender: z.enum(["male", "female"]).optional(),
      gen_duration: z.number().optional(),
      is_max_mode: z.boolean().optional(),
      is_mumble: z.boolean().optional(),
      control_sliders: z.object({
        weirdness_constraint: z.number().min(0).max(100).optional(),
        style_weight: z.number().min(0).max(100).optional(),
        audio_weight: z.number().min(0).max(100).optional(),
      }).optional(),
      use_personalization: z.boolean().optional(),
      personalization_user_uuid: z.string().optional(),
      do_personalize_lyrics: z.boolean().optional(),
      audio_refs: z.array(z.object({
        clip_id: z.string(),
        style_prompt: z.string().optional(),
        lyrics: z.string().optional(),
        duration_s: z.number().optional(),
      })).optional(),
      sample_clip_ids: z.array(z.string()).optional(),
      chop_sample_clip_id: z.string().optional(),
      cover_clip_id: z.string().optional(),
      mashup_clip_ids: z.array(z.string()).optional(),
      continue_clip_id: z.string().optional(),
      continue_at: z.number().optional(),
      underpainting_clip_id: z.string().optional(),
      overpainting_clip_id: z.string().optional(),
      user_uploaded_image_ids: z.array(z.string()).optional(),
    },
  },
  async (args) => {
    const ids = await getClient().generateCustom(args as any);
    return { content: [{ type: "text", text: JSON.stringify({ ids }) }] };
  }
);

server.registerTool(
  "suno_generate_from_description",
  {
    description: "シンプルモード生成（説明文のみ）",
    inputSchema: { description: z.string() },
  },
  async (args) => {
    const ids = await getClient().generateSimple(args.description);
    return { content: [{ type: "text", text: JSON.stringify({ ids }) }] };
  }
);

server.registerTool(
  "suno_generate_speech",
  {
    description: "スピーチ生成（ナレーション等。backing_music=falseでドライ声）",
    inputSchema: { prompt: z.string(), backing_music: z.boolean().optional(), vocal_gender: z.enum(["male", "female"]).optional() },
  },
  async (args) => {
    const ids = await getClient().generateSpeech(args.prompt, args);
    return { content: [{ type: "text", text: JSON.stringify({ ids }) }] };
  }
);

server.registerTool(
  "suno_generate_sound",
  {
    description: "効果音生成（雨・雷等）",
    inputSchema: { prompt: z.string() },
  },
  async (args) => {
    const ids = await getClient().generateSound(args.prompt);
    return { content: [{ type: "text", text: JSON.stringify({ ids }) }] };
  }
);

server.registerTool(
  "suno_check_status",
  { description: "生成ステータス照会", inputSchema: { ids: z.array(z.string()) } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().feed(args.ids)) }],
  })
);

server.registerTool(
  "suno_wait_for_songs",
  { description: "完成まで待機", inputSchema: { ids: z.array(z.string()) } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().waitFor(args.ids)) }],
  })
);

server.registerTool(
  "suno_get_recent",
  { description: "最近の楽曲一覧", inputSchema: {} },
  async () => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().feed()) }],
  })
);

server.registerTool(
  "suno_generate_lyrics",
  { description: "歌詞生成", inputSchema: { prompt: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: await getClient().generateLyrics(args.prompt) }],
  })
);

server.registerTool(
  "suno_download_song",
  {
    description: "音声取得（再生経路・DL数非消費）。out_dirに保存しパスを返す",
    inputSchema: { clip_id: z.string(), out_dir: z.string().optional() },
  },
  async (args) => {
    const dl = await getClient().downloadClip(args.clip_id);
    const dir = args.out_dir ?? `${process.env.HOME}/Downloads`;
    const path = `${dir}/${dl.filename}`;
    await Bun.write(path, dl.bytes);
    return { content: [{ type: "text", text: JSON.stringify({ path, bytes: dl.bytes.length }) }] };
  }
);

server.registerTool(
  "suno_get_clip",
  { description: "クリップ単体取得", inputSchema: { clip_id: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().clip(args.clip_id)) }],
  })
);

server.registerTool(
  "suno_extend_song",
  {
    description: "延長生成",
    inputSchema: {
      audio_id: z.string(),
      prompt: z.string().optional(),
      tags: z.string().optional(),
      title: z.string().optional(),
      continue_at: z.number().optional(),
      model: z.string().optional(),
    },
  },
  async (args) => {
    const ids = await getClient().extendAudio(args.audio_id, args as any);
    return { content: [{ type: "text", text: JSON.stringify({ ids }) }] };
  }
);

server.registerTool(
  "suno_concat_clips",
  { description: "結合", inputSchema: { clip_id: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().concatenate(args.clip_id)) }],
  })
);

server.registerTool(
  "suno_generate_stems",
  { description: "ステム分離", inputSchema: { song_id: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().generateStems(args.song_id)) }],
  })
);

server.registerTool(
  "suno_create_playlist",
  { description: "プレイリスト作成", inputSchema: { name: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().createPlaylist(args.name)) }],
  })
);

server.registerTool(
  "suno_get_playlist",
  { description: "プレイリスト取得", inputSchema: { playlist_id: z.string() } },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().getPlaylist(args.playlist_id)) }],
  })
);

server.registerTool(
  "suno_add_playlist_tracks",
  {
    description: "プレイリストへ曲追加",
    inputSchema: { playlist_id: z.string(), clip_ids: z.array(z.string()) },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().addPlaylistTracks(args.playlist_id, args.clip_ids)) }],
  })
);

server.registerTool(
  "suno_remove_playlist_tracks",
  {
    description: "プレイリストから曲削除（indexes指定）",
    inputSchema: { playlist_id: z.string(), indexes: z.array(z.number()) },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().removePlaylistTracks(args.playlist_id, args.indexes)) }],
  })
);

server.registerTool(
  "suno_get_models",
  { description: "利用可能モデル一覧（billingから動的取得。verifiedは動作確認済み）", inputSchema: {} },
  async () => ({
    content: [{ type: "text", text: JSON.stringify({ models: await getClient().getModels() }) }],
  })
);

server.registerTool(
  "suno_upload_image",
  {
    description: "画像アップロード（生成時のuser_uploaded_image_ids用asset idを返す。data_base64で画像を渡す）",
    inputSchema: { data_base64: z.string(), content_type: z.string().optional() },
  },
  async (args) => {
    const bin = Uint8Array.from(atob(args.data_base64), (ch) => ch.charCodeAt(0));
    return {
      content: [{ type: "text", text: JSON.stringify(await getClient().uploadImage(bin, args.content_type ?? "image/png")) }],
    };
  }
);

server.registerTool(
  "suno_upload_audio",
  {
    description: "オーディオアップロード（data_base64+filename→clip_idを返す。参照・カバー・サンプルの元に使う）",
    inputSchema: { data_base64: z.string(), filename: z.string(), upload_type: z.string().optional() },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().uploadAudio(
      Uint8Array.from(atob(args.data_base64), (ch) => ch.charCodeAt(0)), args.filename, args)) }],
  })
);

server.registerTool(
  "suno_create_persona",
  {
    description: "ボイス（persona）作成。root_clip_id+description必須、またはvox_audio_id+vocal_start_s+vocal_end_s",
    inputSchema: { name: z.string(), description: z.string().optional(), root_clip_id: z.string().optional(), vox_audio_id: z.string().optional(), vocal_start_s: z.number().optional(), vocal_end_s: z.number().optional() },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().createPersona(args as any)) }],
  })
);

server.registerTool(
  "suno_check_upload",
  {
    description: "アップロード処理ステータス照会（kind=audio|image、id=upload_id|asset_id）",
    inputSchema: { kind: z.enum(["audio", "image"]), id: z.string() },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(args.kind === "audio"
      ? await getClient().audioUploadStatus(args.id)
      : await getClient().imageAssetStatus(args.id)) }],
  })
);

server.registerTool(
  "suno_get_persona",
  {
    description: "ボイス（persona）取得",
    inputSchema: { persona_id: z.string() },
  },
  async (args) => ({
    content: [{ type: "text", text: JSON.stringify(await getClient().getPersona(args.persona_id)) }],
  })
);

await server.connect(new StdioServerTransport());
