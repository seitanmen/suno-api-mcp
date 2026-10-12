# suno-api (self-host)

自分の Suno アカウントで動くセルフホスト API + MCP ブリッジ。非公式・個人利用向け。

## 使い方（推奨: Tampermonkey Bridge）

1. `bun run api` を起動（`:4123`）
2. 通常ブラウザに Tampermonkey を入れ、`packages/userscript/suno-bridge.user.js` を新規スクリプトとして登録
3. `suno.com` を開いてログイン（普段のブラウザなのでGoogleログインも可、自動化検出なし）
4. ページを1〜2回操作すると右下パネルに JWT 取得表示→自動でローカルAPIへ送信
5. `bun run doctor` で session/JWT/credits を確認
6. MCP: `bun run mcp`（stdio）

JWT は使うたびに再取得・再送されるため、有効期限切れは自動回復する。

## 使い方（代替: Cookie手貼り）

1. 通常ブラウザで `suno.com/create` を開き、F12→Network→リロード
2. `?__clerk_api_version` を含むリクエスト→Headers→`Cookie` の値全体をコピー
3. `bun run login:cookie "<貼付>"`

## 注意

- 非公式リバース実装。Suno の仕様変更で壊れることがある。自己責任。
- hCaptcha が出た場合は Cookie 取り直し。
- `~/.suno-api/` に Cookie を保存（他人と共有しないこと）。
