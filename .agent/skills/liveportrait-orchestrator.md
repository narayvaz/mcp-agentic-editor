# liveportrait-orchestrator

## Purpose
Codify best parameter presets and recovery patterns for LivePortrait and EchoMimic animation runs.
Load this skill whenever the user mentions: animate, animation quality, LivePortrait settings,
driving video, facial expression, anchor animation, or EchoMimic.

## Supported models
- LivePortrait (expression transfer from driving video)
- EchoMimic v2 (audio-driven, single-pass, recommended upgrade)

## LivePortrait parameter presets

### journalist-standard (default)
- Source: anchor_front.jpg (512×512 minimum, centered face)
- Driving: journalist_driver.mp4 (10s, subtle head nods, eye blinks, neutral expression)
- Flags: --flag-pasteback (full frame output)
- MPS fallback: enabled
- Expected output: 10s animated MP4 at source resolution

### journalist-expressive
- Same as standard but driving video includes more head movement
- Use for editorial/opinion segments
- Flags: --flag-pasteback --flag-relative-motion

### static-loop (legacy fallback)
- Uses d0.mp4 generic driver
- No pasteback (cropped face only)
- Lower quality but faster render
- Use only if LivePortrait crashes with other presets

## EchoMimic v2 presets

### echomimic-news-anchor
- Source: anchor_front.jpg
- Audio: speech_premium.wav
- Pose: pose_ref_sigA (neutral seated anchor pose)
- Resolution: 768×768
- FPS: 25
- Steps: 20 (balance of quality/speed)
- CFG scale: 2.5
- Device: mps (with float32 patches)

## Workflow

### Run animation
1. Check which model is available (EchoMimic preferred, LivePortrait fallback)
2. Load the appropriate preset
3. Validate source image (face detected, sufficient resolution)
4. Validate driving video/audio exists
5. Run the model with MPS fallback enabled
6. If render fails: retry once with static-loop preset
7. Output to: scratch/anchor_animated/

### Quality checks on output
- [ ] Output video has frames (not 0-byte)
- [ ] Face is visible in first frame
- [ ] Duration matches driving video/audio length (±1s tolerance)
- [ ] No visual artifacts in first 3 frames

## Recovery patterns
- MPS OOM: Reduce resolution to 512×512, retry
- Model not found: Fall back to LivePortrait if EchoMimic unavailable
- Black output: Re-run with different driving video preset
- InsightFace crash: Ensure onnxruntime-silicon is installed, not onnxruntime-gpu

## File paths
- LivePortrait dir: ~/.gemini/antigravity/scratch/LivePortrait
- EchoMimic dir: ~/.gemini/antigravity/scratch/echomimic_v2
- Source images: ~/.gemini/antigravity/scratch/anchor_front.jpg
- Output dir: ~/.gemini/antigravity/scratch/anchor_animated/

## What this skill does NOT do
- Does not generate voice/audio (that is gemini_voice_premium.py)
- Does not lip-sync (that is MuseTalk, only if not using EchoMimic)
- Does not composite onto backgrounds (that is premium_assembly.py)
- Does not manage the job queue (that is video-queue-manager)
