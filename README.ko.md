# suno-api (self-host)

[日本語](README.md) | [English](README.en.md) | [中文](README.zh.md) | 한국어

자신의 Suno 계정으로 동작하는 셀프호스트 API + MCP 브리지. 비공식・개인용.

## 설치 (3단계)

1. API 실행
   ```sh
   bun install && bun run api   # :4123
   ```
2. Tampermonkey(Chrome 확장)를 설치하고 아래 링크를 열어 설치
   https://raw.githubusercontent.com/seitanmen/suno-api-mcp/main/packages/userscript/suno-bridge.user.js
3. `suno.com` 열기(평소 브라우저이므로 Google 로그인 가능). 우측 하단 원형 아이콘이 녹색이면 연결 완료. 세션은 60초마다 자동 전송.

## API (`http://localhost:4123`)

| 기능 | 메서드 / 경로 | 상태 |
|---|---|---|
| 크레딧 조회 | `GET /v1/credits` | ✅ |
| 심플 생성 | `POST /v1/songs {prompt, tags?, model?}` | ✅ |
| 커스텀 생성 | `POST /v1/songs {prompt, tags, title, negative_tags?, vocal_gender?, gen_duration?, is_max_mode?, control_sliders?}` | ✅ |
| 가사 생성 | `POST /v1/lyrics {prompt}` | ✅ |
| 생성 대기 | `GET /v1/songs?ids=...` / `POST /v1/wait` | ✅ |
| 라이브러리 | `GET /v1/library` | ✅ |
| 클립 조회 | `GET /v1/clips?id=...` | ✅ |
| 연장 | `POST /v1/extend {audio_id, ...}` | ✅ |
| 스템 분리 | `POST /v1/stems {song_id}` | ✅ |
| 플레이리스트(생성/조회/추가/삭제) | `POST /v1/playlists` / `GET /v1/playlists/:id` / `POST .../tracks` / `POST .../tracks/remove` | ✅ |
| 결합 | `POST /v1/concat {clip_id}` | ⚠️ 형식 확인됨, 클립에 따라 다름 |
| 오디오 취득(재생 경로・다운로드 수 미소비) | `GET /v1/download?id=...` | ✅ |
| 스피치 생성 | `POST /v1/speech {prompt, backing_music?, vocal_gender?}` | ✅ |
| 효과음 생성 | `POST /v1/sounds {prompt}` | ✅ |
| 모델 목록(동적 조회) | `GET /v1/models` | ✅ |
| 이미지 업로드 | `POST /v1/uploads/image {data_base64, content_type?}` | ⚠️ 실측정 미확인 |
| 오디오 업로드 | `POST /v1/uploads/audio {data_base64, filename, upload_type?}` | ⚠️ 실측정 미확인 |
| 보이스(persona) 생성/조회 | `POST /v1/persona` / `GET /v1/persona?id=...` | ⚠️ 실측정 미확인 |
| 참조(audio_refs/cover/sample/mashup) | `POST /v1/songs` 추가 필드 | ⚠️ 실측정 미확인 |
| 개인화 단독 API | — (생성 옵션 `use_personalization`으로 대응) | ⚠️ |

기본 모델: `chirp-hawk`(v6 계열에서 동작 확인).

## MCP 도구 (22개)

`suno_get_credits` / `suno_generate_song`(참조+모델) / `suno_generate_from_description` / `suno_check_status` / `suno_wait_for_songs` / `suno_get_recent` / `suno_generate_lyrics` / `suno_get_clip` / `suno_download_song` / `suno_extend_song` / `suno_concat_clips` / `suno_generate_stems` / `suno_create_playlist` / `suno_get_playlist` / `suno_add_playlist_tracks` / `suno_remove_playlist_tracks` / `suno_generate_speech` / `suno_generate_sound` / `suno_get_models` / `suno_upload_image` / `suno_upload_audio` / `suno_create_persona`

Claude Code 등록 예:

```sh
claude mcp add suno -- bun run /path/to/suno-api/packages/mcp/src/index.ts
```

## 부록: 쿠키 직접 붙여넣기 (브리지 사용 불가 시에만)

1. `suno.com/create` 열기, F12 → Network → 새로고침
2. `?__clerk_api_version` 포함 요청 → `Cookie` 전체 복사
3. `bun run login:cookie "<붙여넣기>"`

## 주의

- 비공식 리버스 구현. Suno 사양 변경 시 동작하지 않을 수 있음. 자기 책임.
- 세션은 `~/.suno-api/` 에 저장 (타인과 공유 금지).
