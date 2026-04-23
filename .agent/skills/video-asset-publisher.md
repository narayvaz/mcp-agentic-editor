# video-asset-publisher

## Purpose
Close the video pipeline loop — generate thumbnails, upload to WordPress media library,
and attach to post drafts. Load this skill whenever the user mentions: publish video,
upload video, thumbnail, video to WordPress, or attach media.

## Workflow

### Generate thumbnail
1. Extract frame at 2-second mark from final_broadcast_premium.mp4
2. Resize to 1280×720 (WP featured image standard)
3. Add subtle vignette and title overlay using Pillow
4. Save as thumbnail_[project_name].jpg

### Upload to WordPress
1. Read WP credentials from settings (siteId from config)
2. POST to /wp-json/wp/v2/media with:
   - file: the final MP4
   - title: project_name
   - alt_text: auto-generated from script first sentence
3. Store returned media_id
4. POST thumbnail as separate media item
5. Store thumbnail media_id

### Attach to post draft
1. If post_id provided: attach media to existing post
2. If no post_id: create new draft post with:
   - title: "[Breaking] " + first sentence of script
   - content: video shortcode + transcript
   - featured_image: thumbnail media_id
   - status: "draft" (NEVER "publish")
   - categories: auto-detect from script content
3. Return post_id and edit URL to user

## Quality gates before upload
- [ ] Video file size < 100MB
- [ ] Video duration < 10 min
- [ ] Thumbnail generated successfully
- [ ] WP credentials valid (test with /wp-json/wp/v2/users/me first)

## What this skill does NOT do
- Does not render videos (that is liveportrait-orchestrator)
- Does not set post status to "publish" (manual action only)
- Does not manage SEO meta (that is seo-content-optimizer)
