# video-queue-manager

## Purpose
Manage the lifecycle of video production jobs in Azat Studio (LivePortrait / MuseTalk / EchoMimic pipeline).
Load this skill whenever the user mentions: video job, render queue, stuck render, retry video,
video failed, queue status, LivePortrait, MuseTalk, EchoMimic, or video production.

## Job states
QUEUED → PROCESSING → RENDERED → STAGED_DRAFT
                  ↓ (error)
               FAILED → (retry ≤3) → QUEUED
                      → (max retries) → DEAD_LETTER

## Priority levels
- P1: Breaking news — process immediately, interrupt lower-priority jobs
- P2: Scheduled publish — process in order
- P3: Batch / archive — process when queue is idle

## Job schema
Every job must carry:
- job_id: uuid
- priority: P1 | P2 | P3
- model: liveportrait | musetalk | echomimic
- asset_refs: [source_video, avatar_image, script_text]
- created_at: ISO timestamp
- retry_count: integer (max 3)
- status: QUEUED | PROCESSING | RENDERED | STAGED_DRAFT | FAILED | DEAD_LETTER
- error_log: string | null

## Workflows

### Enqueue a new job
1. Validate all asset_refs exist and are accessible
2. Assign priority based on post scheduled date (≤2h = P1, ≤24h = P2, else P3)
3. Write job to queue store with status: QUEUED
4. Confirm to user: job_id, estimated position, estimated render time

### Check queue status
1. List all jobs grouped by status
2. Flag any job in PROCESSING for longer than max_render_time (default: 8 min)
3. Surface DEAD_LETTER jobs with error summary for manual review

### Handle a failed job
1. Increment retry_count
2. If retry_count < 3: reset status to QUEUED, log failure reason, re-enqueue
3. If retry_count >= 3: set status to DEAD_LETTER, notify user via Ask Studio panel
4. Never silently discard a failed job

### Promote job to WordPress
Only run after status == RENDERED and quality gate passes:
- Minimum resolution: 1280×720
- Maximum duration: 10 min
- File format: mp4 (h264)
Set WP post status to "pending" (never "publish") and attach video as featured media.

## Quality gate checks (RENDERED → STAGED_DRAFT)
- [ ] Resolution meets minimum
- [ ] Duration within limit
- [ ] File format is mp4/h264
- [ ] No black frames in first 3 seconds
- [ ] Audio track present (if script was provided)

## Error recovery patterns
- Timeout (>8 min): kill process, log "render_timeout", retry with lower resolution preset
- Model crash: capture stderr, log "model_crash", retry with fallback model
- Asset missing: do not retry, set DEAD_LETTER immediately, surface missing asset path

## What this skill does NOT do
- Does not publish posts (that is wp-draft-stager's job)
- Does not modify WordPress plugin settings
- Does not delete videos from media library
- Does not run health checks (that is wp-health-monitor's job)
