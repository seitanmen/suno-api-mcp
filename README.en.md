# suno-api (self-host)

[日本語](README.md) | English | [中文](README.zh.md) | [한국어](README.ko.md)

A self-hosted API + MCP bridge running on your own Suno account. Unofficial, for personal use.

## Setup (3 steps)

1. Start the API
   ```sh
   bun install && bun run api   # :4123
   ```
2. Install Tampermonkey (Chrome extension), then open the link below and install
   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
3. Open `suno.com` (your regular browser, so Google login works). A green dot in the bottom-right means connected. The session is auto-sent every 60 seconds.

## API (`http://localhost:4123`)

| Feature | Method / Path | Status |
|---|---|---|
| Credits | `GET /v1/credits` | ✅ |
| Simple generation | `POST /v1/songs {prompt, tags?, model?}` | ✅ |
| Custom generation | `POST /v1/songs {prompt, tags, title, negative_tags?, vocal_gender?, gen_duration?, is_max_mode?, control_sliders?}` | ✅ |
| Lyrics | `POST /v1/lyrics {prompt}` | ✅ |
| Wait for songs | `GET /v1/songs?ids=...` / `POST /v1/wait` | ✅ |
| Library | `GET /v1/library` | ✅ |
| Clip info | `GET /v1/clips?id=...` | ✅ |
| Extend | `POST /v1/extend {audio_id, ...}` | ✅ |
| Stems | `POST /v1/stems {song_id}` | ✅ |
| Playlists (create/get/add/remove) | `POST /v1/playlists` / `GET /v1/playlists/:id` / `POST .../tracks` / `POST .../tracks/remove` | ✅ |
| Concat | `POST /v1/concat {clip_id}` | ⚠️ Shape known, clip-dependent |
| Raw audio (playback path, download quota untouched) | `GET /v1/download?id=...` | ✅ |
| Speech synthesis | `POST /v1/speech {prompt, backing_music?, vocal_gender?}` | ✅ |
| Sound effects | `POST /v1/sounds {prompt}` | ✅ |
| Standalone personalize API | — (covered as `use_personalization` generate option) | ⚠️ |

Default model: `chirp-hawk` (verified on the v6 family).

## MCP tools (18)

`suno_get_credits` / `suno_generate_song` (advanced options) / `suno_generate_from_description` / `suno_check_status` / `suno_wait_for_songs` / `suno_get_recent` / `suno_generate_lyrics` / `suno_get_clip` / `suno_download_song` / `suno_extend_song` / `suno_concat_clips` / `suno_generate_stems` / `suno_create_playlist` / `suno_get_playlist` / `suno_add_playlist_tracks` / `suno_remove_playlist_tracks` / `suno_generate_speech` / `suno_generate_sound`

Register with Claude Code:

```sh
claude mcp add suno -- bun run /path/to/suno-api/packages/mcp/src/index.ts
```

## Appendix: manual cookie paste (only if the bridge is unavailable)

1. Open `suno.com/create`, F12 → Network → reload
2. Find a request containing `?__clerk_api_version` → copy the whole `Cookie` header
3. `bun run login:cookie "<paste>"`

## Notes

- Unofficial reverse engineering. May break when Suno changes. Your responsibility.
- Sessions are stored in `~/.suno-api/` (do not share).
