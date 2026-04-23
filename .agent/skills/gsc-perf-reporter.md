# gsc-perf-reporter

## Purpose
Turn dashboard metrics into actionable delta reports.
Load this skill whenever the user mentions: GSC report, search performance, traffic report,
weekly stats, analytics summary, or position changes.

## Report structure

### Weekly delta report
1. Pull current week metrics from /api/seo-stats
2. Compare to previous week (stored in local cache)
3. Generate report:
   - Total clicks: value + delta% + trend arrow
   - Total impressions: value + delta% + trend arrow
   - Average position: value + delta + direction
   - CTR: value + delta%
4. Top 5 gaining queries (biggest position improvement)
5. Top 5 losing queries (biggest position drop)
6. New queries appearing this week
7. Action items: specific recommendations based on deltas

### Monthly summary
- Same as weekly but with 4-week aggregation
- Include: best performing content, worst performing content
- Seasonal comparison if prior year data available

## Alert thresholds
- Position drop > 5 positions on any top-20 query: ALERT
- Click drop > 30% week-over-week: ALERT
- New query entering top 10: OPPORTUNITY flag

## What this skill does NOT do
- Does not modify content (that is the content engine tier)
- Does not manage WordPress settings
- Does not generate videos
