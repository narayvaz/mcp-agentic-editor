# wp-draft-stager

## Purpose
Handle all WordPress scaffolding — schema markup, meta, Gutenberg blocks, image ALT text — in one pass.
Load this skill whenever the user mentions: publish draft, stage post, WordPress post,
Gutenberg, schema markup, or format article.

## Workflow

### Stage a draft
1. Receive content from gemini-research-synth or manual input
2. Apply SEO checks via seo-content-optimizer (MUST pass before staging)
3. Build WordPress post payload:
   - title: from article brief
   - content: clean HTML with Gutenberg block comments
   - excerpt: first 160 chars or custom
   - status: "draft" (NEVER "publish" — enforced)
   - categories: auto-detect or user-specified
   - tags: from keyword analysis
   - featured_image: if video thumbnail available, attach it
4. POST to /wp-json/wp/v2/posts
5. Return post_id, edit URL, and preview URL

### Gutenberg block formatting
- Paragraphs: <!-- wp:paragraph -->
- Headings: <!-- wp:heading {"level":2} -->
- Images: <!-- wp:image {"id":X} -->
- Video embed: <!-- wp:video {"id":X} -->
- Quote blocks for pull quotes

### Schema markup injection
- Article: NewsArticle schema for news content
- Video: VideoObject schema when video is attached
- Author: Person schema linked to site author

## Safety rules
- NEVER set status to "publish" — always "draft" or "pending"
- ALWAYS run SEO checks before staging
- ALWAYS preserve existing post content if updating (merge, don't overwrite)

## What this skill does NOT do
- Does not write content (that is gemini-research-synth)
- Does not optimize SEO (that is seo-content-optimizer, called as dependency)
- Does not manage videos (that is video-asset-publisher)
