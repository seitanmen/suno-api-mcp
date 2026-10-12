# suno-api (self-host) — 設計仕様 v0.1

Stack: TypeScript + Bun/Node / Auth: ブラウザプロファイル方式（初回のみ実ブラウザでログイン）

## 背景調査の結論

- 公式API: 2026-09 時点で公共セルフサーブなし。パートナープログラムのみ。よって非公式リバース実装が必要。
- gcui-art/suno-api (★3256): 最多スターだが最終コード更新 2026-03、未解決 issue 108。Cookie 貼付 + 有料 2Captcha + Playwright。Clerk 固定バージョンが脆弱点。
- Suno-API/Suno-API (Go, ★159): 最終更新 2024-12。凍結。
- Malith-Rukshan/Suno-API (Python): 最終更新 2024-07。凍結。
- wlhtea/Suno2openai: 最終更新 2025-01。停滞。
- AceDataCloud/SunoMCP: 連日更新で活発だが自社有料 API への中継。自己ログインのセルフホストではない。
- suno-mcp (PyPI 0.1.0, 2026-06, David Shibley): 自アカウント + Playwright プロファイル方式で最も目標に近い。GitHub リポジトリは API で 404（改名・削除・非公開のいずれか）。単発リリース。
- frankxai/suno-mcp-server (★1, 2026-10-11): 実験的スキャフォールド。参照のみ。

## Suno WebUI の仕組み（静的解析、要実機検証）

出典: gcui-art/suno-api `src/lib/SunoApi.ts`（870行）。

1. Cookie（`__client` 含む）をブラウザセッションから取得。
2. `GET https://auth.suno.com/v1/client?__clerk_api_version=...`（Header: `Authorization: <__client>`）
   → `response.last_active_session_id` を sid として保存。
3. `POST /v1/client/sessions/<sid>/tokens` → `jwt` を取得。以後の業務 API は `Authorization: Bearer <jwt>`。
4. `POST https://suno.com/api/user/create_session_id/`（deviceId 付与）→ `session_id`。
5. 生成前に `POST /api/c/check`（ctype=generation）で CAPTCHA 要否を確認。要なら Playwright + 2Captcha で解消。
6. 生成・歌詞・延長・ステータスポーリング・MP3 取得の業務 API を叩く。Cookie は Set-Cookie で逐次更新。

注意: `CLERK_VERSION = 5.117.0` と `__clerk_api_version=2025-11-10` はハードコード。Suno 側の更新で壊れる脆弱点。実機検証で最新値を再取得する。

## 構成

```
suno-api/
  packages/api/      Bun + Hono REST サーバ（セルフホスト）
  packages/mcp/      MCP サーバ（stdio、API サーバに接続 or 直結モード）
  packages/core/     認証・トークン更新・生成クライアント（共通）
  Dockerfile         api + chromium 同梱
```

## REST API（案）

- `POST /v1/auth/login` — プロファイルログイン開始（ブラウザ表示 or デバイスフロー）
- `GET /v1/credits` — 残クレジット
- `POST /v1/songs` — 生成（custom: lyrics+style / simple: description）
- `GET /v1/songs/:id` — ステータス
- `GET /v1/songs/:id/audio` — MP3 リダイレクト/プロキシ
- `GET /v1/library` — 最近の楽曲
- `POST /v1/lyrics` — 歌詞生成
- `GET /health` — 診断

## MCP ツール（案）

`suno_get_credits`, `suno_generate_song`, `suno_generate_from_description`,
`suno_check_status`, `suno_wait_for_songs`, `suno_download_song`, `suno_get_recent`

## 認証設計（ブラウザプロファイル方式）

- `~/.suno-api/browser-profile` に Chromium 永続プロファイルを保持。
- 初回のみ非ヘッドレスで開き、ユーザが suno.com にログイン。セッション Cookie を保存。
- 以後はヘッドレスで Cookie 読出し → 上記 2〜4 のトークン更新フローで JWT を取得・定期更新（keepAlive）。
- Cookie 手貼りもフォールバックとして残す（`SUNO_COOKIE` env）。
- 2Captcha は使わない。hCaptcha 発生時は生成前チェックで検出し、非ヘッドレス再ログインを促す。

## クロスプラットフォーム

- Bun ランタイム: mac (arm64/x64) / Windows x64 / Linux x64 を CI マトリクスで検証。
- Playwright Chromium は各 OS に `playwright install chromium` で調達。Docker イメージは chromium 同梱。
- 配布: GitHub Releases に OS 別バイナリ + Docker Hub/GHCR イメージ + npm パッケージ。
- 注意（2026-10-12 実測）: この環境の Bun 1.4.2 では `bun build --compile` が hello world でも InvalidObject で失敗する。単一バイナリはツールチェーン側の問題。配布の主経路は `bun run`（3 OS）+ Docker とし、compile は Bun 更新後に再評価。

## 次の手順（Build）

1. `packages/core` の Clerk トークンフローを実機（ユーザのログイン済みブラウザ）で検証・最新化。
2. 生成〜ポーリング〜MP3 取得の最小 E2E を通す。
3. REST + MCP を実装し、3 OS で起動確認。
4. GitHub 公開（MIT、免責: 非公式・自己責任・ToS 留意を README に明記）。
