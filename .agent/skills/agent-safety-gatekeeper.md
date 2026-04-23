# agent-safety-gatekeeper

## Purpose
Sanitize every user input going through Ask Studio and enforce safety rules at the skill level.
This is a GLOBAL skill — always loaded regardless of task context.

## Rules (ENFORCED — not advisory)

### Publishing safety
```
RULE: no_auto_publish
  IF action == "publish" AND target == "wordpress"
  THEN status MUST be "draft" OR "pending"
  NEVER set status to "publish" without explicit user confirmation
  VIOLATION: block action, notify user
```

### Input sanitization
```
RULE: sanitize_inputs
  IF user_input contains SQL injection patterns THEN block and warn
  IF user_input contains script tags THEN strip tags
  IF user_input references system paths outside workspace THEN block
  ALLOWED paths: ~/.gemini/antigravity/scratch/*, ~/Downloads/mcp-agentic-editor/*
```

### Self-modification safety
```
RULE: self_mod_safety
  IF action == "self_modify"
  THEN create backup BEFORE any change
  AND require approval_code from user
  AND log all changes to modification_history
  NEVER modify: package.json, electron/, node_modules/, .env
```

### API key protection
```
RULE: protect_secrets
  NEVER display API keys in chat responses
  NEVER include API keys in error logs shown to user
  IF .env file is referenced THEN mask values with ****
```

### Rate limiting
```
RULE: rate_limit
  Max 10 WordPress API calls per minute
  Max 5 Gemini API calls per minute  
  Max 3 self-modification proposals per session
  IF limit exceeded THEN queue remaining, notify user
```

## What this skill does NOT do
- Does not manage content quality (that is seo-content-optimizer)
- Does not handle video rendering
- Does not modify agent capabilities
