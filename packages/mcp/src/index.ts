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

await server.connect(new StdioServerTransport());
