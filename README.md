# suno-api (self-host)

日本語 | [English](README.en.md) | [中文](README.zh.md) | [한국어](README.ko.md)

自分の Suno アカウントで動くセルフホスト API + MCP ブリッジ。非公式・個人利用向け。

## 導入（3ステップ）

1. APIを起動する
   ```sh
   bun install && bun run api   # :4123
   ```
2. Tampermonkey（Chrome拡張）を入れ、下記リンクを開いてインストール
   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
3. `suno.com` を開く（普段のブラウザなのでGoogleログインも可）。右下の丸アイコンが緑になれば接続完了。セッションは60秒ごとに自動送信される。

## API（`http://localhost:4123`）

| 機能 | メソッド・パス | 状態 |
|---|---|---|
| 残量確認 | `GET /v1/credits` | ✅ |
| シンプル生成 | `POST /v1/songs {prompt, tags?, model?}` | ✅ |
| カスタム生成 | `POST /v1/songs {prompt, tags, title, negative_tags?, vocal_gender?, gen_duration?, is_max_mode?, control_sliders?}` | ✅ |
| 歌詞生成 | `POST /v1/lyrics {prompt}` | ✅ |
| 生成待ち | `GET /v1/songs?ids=...` / `POST /v1/wait` | ✅ |
| ライブラリ | `GET /v1/library` | ✅ |
| クリップ取得 | `GET /v1/clips?id=...` | ✅ |
| 延長 | `POST /v1/extend {audio_id, ...}` | ✅ |
| ステム分離 | `POST /v1/stems {song_id}` | ✅ |
| プレイリスト作成・取得・追加・削除 | `POST /v1/playlists` / `GET /v1/playlists/:id` / `POST .../tracks` / `POST .../tracks/remove` | ✅ |
| 結合 | `POST /v1/concat {clip_id}` | ⚠️ 形状確定も対象クリップ依存で未成功 |
| 音声取得（再生経路・DL数非消費） | `GET /v1/download?id=...` | ✅ |
| スピーチ生成 | `POST /v1/speech {prompt, backing_music?, vocal_gender?}` | ✅ |
| 効果音生成 | `POST /v1/sounds {prompt}` | ✅ |
| パーソナライズ単体API | —（生成時オプション `use_personalization` として対応） | ⚠️ |

既定モデル: `chirp-hawk`（v6系で動作確認済み）。

## MCPツール（18）

`suno_get_credits` / `suno_generate_song`（高度なオプション対応） / `suno_generate_from_description` / `suno_check_status` / `suno_wait_for_songs` / `suno_get_recent` / `suno_generate_lyrics` / `suno_get_clip` / `suno_download_song` / `suno_extend_song` / `suno_concat_clips` / `suno_generate_stems` / `suno_create_playlist` / `suno_get_playlist` / `suno_add_playlist_tracks` / `suno_remove_playlist_tracks` / `suno_generate_speech` / `suno_generate_sound`

Claude Codeへの登録例:

```sh
claude mcp add suno -- bun run /path/to/suno-api/packages/mcp/src/index.ts
```

## 付録: Cookie手貼り（Bridgeが使えない場合のみ）

1. `suno.com/create` を開き、F12→Network→リロード
2. `?__clerk_api_version` を含むリクエスト→Headers→`Cookie` 全体をコピー
3. `bun run login:cookie "<貼付>"`

## 注意

- 非公式リバース実装。Suno の仕様変更で壊れることがある。自己責任。
- `~/.suno-api/` にセッションを保存（他人と共有しないこと）。
