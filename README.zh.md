# suno-api (self-host)

[日本語](README.md) | [English](README.en.md) | 中文 | [한국어](README.ko.md)

使用自己的 Suno 账号运行的自托管 API + MCP 桥。非官方、仅限个人使用。

## 安装（3 步）

1. 克隆仓库并启动 API
   ```sh
   git clone https://github.com/seitanmen/suno-api-mcp && cd suno-api-mcp
   bun install && bun run api   # :4123
   ```
2. 安装 Tampermonkey（Chrome 扩展），打开以下链接并安装
   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
3. 打开 `suno.com`（常用浏览器，Google 登录可用）。右下角圆点变绿即连接成功。会话每 60 秒自动发送。

## API（`http://localhost:4123`）

| 功能 | 方法 / 路径 | 状态 |
|---|---|---|
| 余额查询 | `GET /v1/credits` | ✅ |
| 简单生成 | `POST /v1/songs {prompt, tags?, model?}` | ✅ |
| 自定义生成 | `POST /v1/songs {prompt, tags, title, negative_tags?, vocal_gender?, gen_duration?, is_max_mode?, control_sliders?}` | ✅ |
| 歌词生成 | `POST /v1/lyrics {prompt}` | ✅ |
| 等待歌曲 | `GET /v1/songs?ids=...` / `POST /v1/wait` | ✅ |
| 曲库 | `GET /v1/library` | ✅ |
| 单曲信息 | `GET /v1/clips?id=...` | ✅ |
| 延长 | `POST /v1/extend {audio_id, ...}` | ✅ |
| 干声分离 | `POST /v1/stems {song_id}` | ✅ |
| 播放列表（创建/获取/添加/删除） | `POST /v1/playlists` / `GET /v1/playlists/:id` / `POST .../tracks` / `POST .../tracks/remove` | ✅ |
| 拼接 | `POST /v1/concat {clip_id}` | ⚠️ 形状已知，取决于目标片段 |
| 音频获取（播放路径、不计下载次数） | `GET /v1/download?id=...` | ✅ |
| 语音合成 | `POST /v1/speech {prompt, backing_music?, vocal_gender?}` | ✅ |
| 音效生成 | `POST /v1/sounds {prompt}` | ✅ |
| 模型列表（动态获取） | `GET /v1/models` | ✅ |
| 图片上传 | `POST /v1/uploads/image {data_base64, content_type?}` | ⚠️ 待实测 |
| 音频上传 | `POST /v1/uploads/audio {data_base64, filename, upload_type?}` | ⚠️ 待实测 |
| 音色（persona）创建/获取 | `POST /v1/persona` / `GET /v1/persona?id=...` | ⚠️ 待实测 |
| 引用（audio_refs/cover/sample/mashup） | `POST /v1/songs` 附加字段 | ⚠️ 待实测 |
| 独立个性化 API | —（已作为生成选项 `use_personalization` 支持） | ⚠️ |

默认模型：`chirp-hawk`（v6 系列已验证）。

## MCP 工具（24 个）

`suno_get_credits` / `suno_generate_song`（引用+模型） / `suno_generate_from_description` / `suno_check_status` / `suno_wait_for_songs` / `suno_get_recent` / `suno_generate_lyrics` / `suno_get_clip` / `suno_download_song` / `suno_extend_song` / `suno_concat_clips` / `suno_generate_stems` / `suno_create_playlist` / `suno_get_playlist` / `suno_add_playlist_tracks` / `suno_remove_playlist_tracks` / `suno_generate_speech` / `suno_generate_sound` / `suno_get_models` / `suno_upload_image` / `suno_upload_audio` / `suno_create_persona` / `suno_check_upload` / `suno_get_persona`

注册到 Claude Code（在仓库根目录）：

```sh
claude mcp add suno-api-mcp -- bun run ./packages/mcp/src/index.ts
```

## 附录：手动粘贴 Cookie（仅在桥不可用时）

1. 打开 `suno.com/create`，F12 → Network → 刷新
2. 找到包含 `?__clerk_api_version` 的请求 → 复制整个 `Cookie` 值
3. `bun run login:cookie "<粘贴>"`

## 注意

- 非官方逆向实现。Suno 改版可能导致失效，自行负责。
- 会话保存在 `~/.suno-api/`（请勿分享给他人）。
