# seo-content-optimizer

## Purpose
Inject GSC performance signals during content creation and enforce SEO quality gates.
Load this skill whenever the user mentions: SEO, meta description, keywords, search performance,
CTR, impressions, position, or optimize content.

## Pre-publish SEO checklist (ENFORCED — block publish if failing)
- [ ] Title tag: 50-60 characters, includes primary keyword
- [ ] Meta description: 140-160 characters, includes CTA
- [ ] H1: exactly one per page, matches title intent
- [ ] H2s: 3-6 per article, include secondary keywords
- [ ] Images: all have descriptive ALT text (not filename)
- [ ] Internal links: minimum 2 per article
- [ ] Word count: minimum 400 words
- [ ] No duplicate title across site
- [ ] Slug: lowercase, hyphenated, max 5 words

## GSC signal integration
When available, pull from /api/seo-stats:
- Underperforming queries (position 5-20): suggest content additions targeting these
- High-impression low-CTR queries: suggest title/meta rewrites
- Top-performing queries: protect existing rankings, don't change these pages

## Enforcement rules
```
IF meta_description_chars NOT IN [140,160] THEN block_publish
IF h1_count != 1 THEN block_publish
IF alt_text_missing > 0 THEN warn (block if > 3 images missing)
IF word_count < 400 THEN block_publish
IF internal_links < 2 THEN warn
```

## What this skill does NOT do
- Does not write content (that is gemini-research-synth)
- Does not upload to WordPress (that is wp-draft-stager)
- Does not manage site health (that is wp-health-monitor)
