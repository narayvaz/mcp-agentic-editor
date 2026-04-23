# gemini-research-synth

## Purpose
Transform NotebookLM research output into structured article briefs for WordPress publishing.
Load this skill whenever the user mentions: research, article brief, NotebookLM output,
write article, structure content, or content plan.

## Workflow

### Generate article brief from NotebookLM
1. Query NotebookLM notebook via MCP (notebook_query)
2. Extract key facts, quotes, and data points
3. Structure into article brief:
   - Headline (max 60 chars, includes primary keyword)
   - Subheadline (max 120 chars)
   - Key points (3-5 bullet points)
   - Supporting data/quotes
   - Suggested word count based on topic depth
   - Target keywords (from GSC data if available)

### Brief-to-draft pipeline
1. Take structured brief
2. Generate WordPress-ready content using Gemini:
   - H2/H3 heading hierarchy
   - Short paragraphs (max 3 sentences)
   - One key stat or quote per section
   - Internal linking suggestions
3. Output as clean HTML (no inline styles, no div wrappers)

## Prompt patterns
- News brief: "Summarize in 4 broadcast sentences, professional tone, no brackets"
- Long-form: "Write 800-word article with H2 sections, include data from sources"
- Opinion: "Write editorial perspective, include counterpoints, cite sources"

## What this skill does NOT do
- Does not optimize SEO (that is seo-content-optimizer)
- Does not publish to WordPress (that is wp-draft-stager)
- Does not generate video (that is the video pipeline)
