# MCP Rules — Video Pipeline

## Scope
These rules apply to ALL video production tasks: script generation, voice synthesis,
animation (LivePortrait/EchoMimic), lip-sync (MuseTalk), and final assembly.

## Pipeline sequence (ENFORCED)
```
Script → Voice → Animate → Lipsync → Assembly → Quality Gate → Stage Draft
```
Skipping stages is NOT allowed. Each stage must complete successfully before the next begins.

## Render constraints
```
IF render_time > 8min THEN kill_process AND retry_with_lower_resolution
IF retry_count >= 3 THEN move_to_dead_letter AND alert_user
IF output_file_size == 0 THEN mark_FAILED (do not retry, asset issue)
```

## Output requirements
```
REQUIRE resolution >= 1280x720
REQUIRE format == mp4/h264
REQUIRE audio_track_present IF script_provided
REQUIRE duration <= 600s
REQUIRE no_black_frames IN first_3_seconds
```

## Voice requirements
```
REQUIRE model == "gemini-2.5-flash-preview-tts"
REQUIRE voice IN [Kore, Charon, Fenrir]
REQUIRE output_format == WAV/PCM16/24kHz
NEVER use macOS "say" as primary (fallback only)
```

## Publishing gate
```
NEVER auto-publish video to WordPress
ALWAYS set post status to "draft" or "pending"
REQUIRE human approval before status change to "publish"
```

## Skills loaded for this domain
- video-queue-manager
- liveportrait-orchestrator
- video-asset-publisher
