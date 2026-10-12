import { SunoClient } from "./client.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = join(import.meta.dir, "..", "..", "out");
mkdirSync(OUT, { recursive: true });

const LYRICS = `[Verse]
終電逃したホーム 冷たい風が頬をなでる
君からの短いメッセージ「先に帰るね」の文字
ネオンが滲むアスファルト 傘もささず歩き出す
星空がこっそり ぼくを見守ってる

[Chorus]
星空の帰り道 ひとりじゃない気がした
遠くの瞬きが そっと背中を押すんだ
失くしたものばかり 数えていた夜に
さよならの代わりに 鼻歌を歌おう

[Verse 2]
コンビニの明かりが 温かく手を振るみたい
肉まんひとつ買って 息で指を温める
君の好きだった歌 口ずさめば笑える
涙は星屑に 変わってゆくから

[Chorus]
星空の帰り道 明日はきっといい日
瞬く星たちに誓うよ
出会いも別れも 全部抱きしめて
新しい朝まで この歌を歌おう

[Bridge]
流れる雲の切れ間に オリオンが微笑む
大丈夫、と囁く 夜空のエールに
歩幅を少しだけ 大きくしてみたら
家路がほら、少し 短くなった

[Outro]
星空の帰り道 ありがとうを添えて
瞬きの数だけ 願いをかけてみる
おやすみ、今日のぼく 明日のぼくへ
星屑メロディー そっと口ずさむ`;

const client = new SunoClient();
const manifest: Record<string, unknown> = { steps: [] as string[] };
const log = (s: string) => {
  (manifest.steps as string[]).push(s);
  console.log(s);
};

log("1. 歌詞生成API");
const aiLyrics = await client.generateLyrics("星空の帰り道、シティポップの失恋ソング");
log("lyrics ok: " + String(aiLyrics).slice(0, 80).replace(/\n/g, " "));

log("2. カスタム生成（ボーカル）: 星空の帰り道");
const customIds = await client.generateCustom({
  prompt: LYRICS,
  tags: "city pop, japanese pop, female vocal, shimmering guitar, night drive, 100bpm",
  title: "星空の帰り道",
});
log("custom ids: " + customIds.join(","));

log("3. シンプル生成（インストBGM）");
const simpleIds = await client.generateSimple("lo-fi hip hop night city BGM, mellow piano, rain sounds", true);
log("simple ids: " + simpleIds.join(","));

log("4. 完成待機");
const done = await client.waitFor([...customIds, ...simpleIds], 600000, 10000);
for (const s of done) log(`- ${s.title} [${s.status}] ${s.audio_url?.slice(0, 60)}`);
manifest.songs = done;
writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2));
log("PART1 DONE");
