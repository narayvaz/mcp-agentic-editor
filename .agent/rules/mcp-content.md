# MCP Rules — Content Engine

## Scope
These rules apply to ALL content creation tasks: research, writing, SEO optimization,
and WordPress draft staging.

## Content quality gates (ENFORCED — block publish if failing)
```
IF meta_description_chars NOT IN [140,160] THEN block_publish
IF h1_count != 1 THEN block_publish
IF title_chars NOT IN [50,60] THEN warn
IF word_count < 400 THEN block_publish
IF internal_links < 2 THEN warn
IF alt_text_missing > 0 THEN warn (block if > 3 images)
IF duplicate_title_exists THEN block_publish
IF slug_words > 5 THEN warn
```

## Content formatting
```
REQUIRE paragraphs <= 3 sentences each
REQUIRE H2 headings: 3-6 per article
REQUIRE clean HTML output (no inline styles, no div wrappers)
REQUIRE Gutenberg block comments for WordPress
```

## NotebookLM integration
```
REQUIRE notebook_id for any research query
REQUIRE source attribution in generated content
NEVER fabricate data not present in notebook sources
IF notebook_query fails THEN retry once, then surface error to user
```

## Publishing safety
```
NEVER set WordPress post status to "publish" automatically
ALWAYS stage as "draft" first
REQUIRE SEO checklist pass before staging
PRESERVE existing post content when updating (merge, don't overwrite)
```

## Skills loaded for this domain
- gemini-research-synth
- seo-content-optimizer
- wp-draft-stager
