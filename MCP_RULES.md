# MCP News Website - Core Rules & Standards

## Rule 0: Absolute User Consent (NON-NEGOTIABLE)
- **Zero Autonomy**: The agent must NEVER modify code, restart services, or change configurations without first explaining the intent in plain language and receiving a "Yes" from the user.
- **Process Over Results**: Adherence to this rule is more important than "fixing" the app or being "helpful."
- **Failure Handling**: If a process is stuck or an error is detected, the agent must report it and wait for instructions. It must NEVER attempt a fix autonomously.

## 1. Journalistic Integrity
- All headlines must be objective and factual. No clickbait.
- Sources must be cited if provided in the draft.
- Tone should be professional, neutral, and authoritative.

## 2. SEO Standards
- Primary keyword must appear in the first 100 words.
- Meta descriptions must be between 140-160 characters.
- Use H2 and H3 tags for readability.
- Images must have descriptive ALT text.

## 3. WordPress Configuration Rules
- LiteSpeed Cache: Object Cache must be enabled for performance.
- Query Monitor: No database queries should take longer than 0.5s.
- Plugins: Only essential plugins should be active.

## 4. Automation Rules
- Never publish a post automatically; always save as "Draft" or "Pending Review".
- Always run a "Health Check" before and after any configuration change.

## 5. Styling and Theme Changes (Chat Colors)
- If requested to change chat, bubble, or background colors, modify ONLY the CSS variables inside the \`:root\` block of \`src/index.css\`:
  - \`--user-chat-bubble-bg\`: user bubble color
  - \`--agent-chat-bubble-bg\`: agent bubble color
  - \`--liquid-surface-strong\`: sidebar and chat window background
- Never rewrite the entire \`src/index.css\` file; only modify the target lines inside the \`:root\` block.
