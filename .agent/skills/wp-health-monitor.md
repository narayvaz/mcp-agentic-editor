# wp-health-monitor

## Purpose
Wrap LiteSpeed/Query Monitor checks into a reusable skill the agent runs pre/post any config change.
Load this skill whenever the user mentions: site health, performance, slow site, cache,
LiteSpeed, Query Monitor, uptime, or server status.

## Health checks

### Core Web Vitals
- LCP (Largest Contentful Paint): MUST be < 2.5s → PASS, 2.5-4s → WARN, >4s → FAIL
- FID (First Input Delay): MUST be < 100ms → PASS, >100ms → FAIL
- CLS (Cumulative Layout Shift): MUST be < 0.1 → PASS, 0.1-0.25 → WARN, >0.25 → FAIL

### Server checks
- Response time: < 200ms → PASS, 200-500ms → WARN, >500ms → FAIL
- PHP memory usage: < 80% limit → PASS, >80% → WARN
- Database query count per page: < 50 → PASS, 50-100 → WARN, >100 → FAIL
- LiteSpeed cache hit rate: > 90% → PASS, 70-90% → WARN, <70% → FAIL

### Pre-change checkpoint
Before any plugin/theme/config change:
1. Run all health checks
2. Store baseline metrics
3. Proceed with change
4. Run health checks again
5. Compare to baseline
6. If any metric degraded by >20%: ALERT and suggest rollback

## What this skill does NOT do
- Does not modify LiteSpeed settings (manual action only)
- Does not manage content (that is the content engine tier)
- Does not handle video rendering (that is the video pipeline tier)
