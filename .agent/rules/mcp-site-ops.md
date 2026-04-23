# MCP Rules — Site Operations

## Scope
These rules apply to ALL site management tasks: health monitoring, performance reporting,
configuration changes, and agent safety enforcement.

## Health check thresholds (ENFORCED)
```
LCP: < 2.5s PASS | 2.5-4s WARN | > 4s FAIL
FID: < 100ms PASS | > 100ms FAIL
CLS: < 0.1 PASS | 0.1-0.25 WARN | > 0.25 FAIL
Response time: < 200ms PASS | 200-500ms WARN | > 500ms FAIL
DB queries per page: < 50 PASS | 50-100 WARN | > 100 FAIL
Cache hit rate: > 90% PASS | 70-90% WARN | < 70% FAIL
```

## Change management
```
BEFORE any plugin/theme/config change:
  1. Run health baseline
  2. Store metrics snapshot
AFTER change:
  3. Run health check again
  4. Compare to baseline
  IF any_metric degraded > 20% THEN alert AND suggest_rollback
```

## Agent safety (ALWAYS ENFORCED — global scope)
```
NEVER display API keys in responses
NEVER include secrets in error logs
NEVER modify: package.json, electron/, node_modules/, .env via self-mod
ALWAYS create backup before self-modification
ALWAYS require approval_code for self-mod changes
MASK .env values with **** when referenced

Rate limits:
  WordPress API: max 10 calls/min
  Gemini API: max 5 calls/min
  Self-mod proposals: max 3 per session
```

## Allowed file system paths
```
ALLOW: ~/.gemini/antigravity/scratch/*
ALLOW: ~/Downloads/mcp-agentic-editor/src/*
BLOCK: all other system paths for write operations
```

## Skills loaded for this domain
- wp-health-monitor
- gsc-perf-reporter
- agent-safety-gatekeeper (ALWAYS loaded)
