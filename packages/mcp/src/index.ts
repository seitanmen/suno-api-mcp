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

await server.connect(new StdioServerTransport());
