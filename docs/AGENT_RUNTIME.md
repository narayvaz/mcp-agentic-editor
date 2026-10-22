# Agent tasks — first execution foundation

Studio 0.3 adds a task workspace alongside the existing advice chat. The coordinator chooses registered tools, the backend validates and authorizes each action, and PostgreSQL retains progress and receipts. Capability rollout remains incremental.

Studio 0.4 adds [live voice collaboration](LIVE_VOICE.md): a spoken interface with transcripts, proposed assignment handoff and controls for one explicitly selected task. Voice uses the same durable executor and approval boundary; it does not create a second executor or add publishing permissions.

## Operator workflow

1. Open **Work → Agent tasks**, create/select a project and describe the assignment. **Work on a task** in Assistant transfers its typed instruction into this workspace without sending attachments.
2. Optionally attach the selected evidence record or WordPress article. The task captures that identity and its tool grants; later selection changes do not retarget it.
3. Choose tools and start. Reads and local evidence/draft writes are selected by default. External WordPress edits are off by default.
4. Inspect the plan, steps, retained outputs and events. Pause, stop or supply guidance as needed. Guidance cannot add permissions.
5. Open evidence outputs for editorial review. Source capture, source-linked claims, translation and drafting do not establish factual verification or language parity.
6. For a selected WordPress edit, review the exact proposed fields/patches before approving. Approval is tied to that action, task revision and a 15-minute expiry. A later edit needs another approval.

## Enabled tool boundary

| Tool | Effect and scope |
| --- | --- |
| `selection.read` | Read only the attached record/article. Long articles are read in 5,000-character sections. |
| `research.search` | Search public sources; retain available passages. Search snippets remain leads. Search may be unavailable. |
| `research.capture` | Capture an accessible public URL directly, honoring the existing address, redirect, robots and size limits. Failed capture cannot become invented evidence. |
| `evidence.save` | Create a local draft from sources retained in this task. All claims start unverified. |
| `evidence.draft` | Retain a HY, EN or RU output from attached or same-task evidence. Human factual/language review is required. |
| `wordpress.edit` | Change title/content/excerpt only on the attached site/post, with fresh revision, exact approval and readback. No status change or new post creation. |
| `production.observe` | Read Expert/Smart observations. No pipeline start/stop or publication authority. |

The agent cannot execute shell commands, install code, publish posts, start broadcasts, send messages or obtain new credentials. Existing credentials resolve inside service adapters; values are never supplied to the coordinator. The installed session and individual task must both grant each capability.

Before a generated article is retained, a script/encoding screen rejects replacement characters, invalid Unicode, mixed Latin/Armenian/Cyrillic letters within a word and the wrong dominant language. Proper names, acronyms and source IDs remain supported. This screen can request the configured fallback; it does not establish fluency, translation parity or factual correctness.

For a long WordPress article, text patches must refer to exact passages already read at the current revision. Anchors must be unique, text-only and nonoverlapping; original HTML outside the replacement is preserved. The configured destination and remote revision are checked again immediately before saving. Patches are conservative text edits, not a general HTML sanitizer.

## Persistence and setup

The agent requires a separately provisioned PostgreSQL database. It never silently falls back to local JSON for task/approval records. Missing or unreachable PostgreSQL disables task execution while existing Studio features remain available. The local evidence library retains its existing file format; it is not migrated into PostgreSQL by this release.

Configure **one** backend-only connection source:

- `AZAT_AGENT_DATABASE_URL` in the application launch environment; or
- a private `agent-runtime.json` beside Studio's `config.json`, containing `{"databaseUrl":"postgresql:///azat_agent?host=/private/socket/directory"}`. This is an illustrative local socket, not an installed service.

The environment value takes precedence. Protect the configuration file and database with the operating account's permissions. Restart Studio after changing the connection. No database URL or credential is returned to the renderer.

Provision a dedicated database/role with permission to create and use its own `azat_agent` schema. Initialization applies versioned migrations under a transaction/advisory lock. Use authenticated TLS for a network database or a private local Unix socket; do not expose PostgreSQL publicly for desktop access. Provisioning, durable startup, backup/restore and monitoring are deployment responsibilities, not automatic package side effects. Test and pilot databases must never be reused for real editorial work.

The ledger contains projects, runs, steps/artifacts/approvals within run records, and append-only revision events. Transactions atomically change a run and its event. Repeated starts with the same request UUID and immutable input return the same run. Conflicting reuse is rejected.

## Execution, recovery and limits

- Execution currently lives in the desktop backend. Keep Studio open. Closing or crashing stops progress; no always-on VPS executor is enabled here.
- A database lease with a fencing token permits one active executor. Heartbeat failure stops authority; expired owners cannot commit new state.
- On restart, interrupted work pauses for inspection. An uncertain write is never automatically repeated. Verify the local/remote outcome and begin a separate recovery task after review.
- Normal desktop quit immediately revokes execution authority and gives persistence a bounded shutdown window. A stalled provider or database cannot trap the app in quit. Recovery also checks leases that expire after startup, before any new model or tool call.
- A temporary model/quota failure between actions pauses the task with successful work retained. Resume after the AI connection recovers. An identical retained write is blocked from automatic repetition; an uncertain write still requires reconciliation.
- Pause, stop and redirection cannot undo an action already sent. Such a write is labeled uncertain until reconciled.
- Model proposals are untrusted JSON. Native JSON mode improves formatting; strict application validation still rejects malformed decisions. The existing configured fallback may be used within the same bounded request when the primary fails or returns an invalid decision. Saved model preferences are unchanged.
- Defaults: at most 20 tool steps, 15 active minutes, bounded model/tool operations, and at most five agent provider requests per minute. Waiting for approval/input does not consume active execution time. These are execution limits, not a monetary spending cap.
- Source receipts, arguments and model context are bounded. Truncated observations are labeled; the model must not infer unseen text.

## Verification and activation

Run `npm run lint`, and `npm run test:agent` against real PostgreSQL using `AZAT_AGENT_TEST_DATABASE_URL`. Provision a separate `azat_agent_service_test` database (or set `AZAT_AGENT_SERVICE_TEST_DATABASE_URL`) for HTTP/workflow tests. Tests create and remove their own data. Do not point them at an editorial database.

CI adds a PostgreSQL 18 transaction/workflow job before macOS packaging. The macOS gate retains all existing host-sandbox, release integrity and archive checks. Local PostgreSQL verification, real-model acceptance, packaged backend checks and native UI acceptance are distinct gates. Build/package success does not establish native acceptance or production editorial quality. See [RELEASING.md](RELEASING.md) for staged installation and rollback.

## Subsequent capability gates

1. Accept this research → evidence → multilingual draft workflow in the packaged/native app, with a durable database and recovery rehearsal.
2. Accept one explicitly selected WordPress correction with exact approval and independently verified readback.
3. Add a separately authenticated VPS executor, deployment health/backup checks, execution location and supervised schedule controls. Remote database storage alone does not provide remote execution.
4. Add source monitors/liveblog drafts, then public profile/investigation datasets with source access and identity rules.
5. Add broadcast preparation/rehearsal, then separately approved live controls and distribution receipts.
6. Add evaluation-driven improvement proposals and isolated validation. Installing code or changing an active service remains a separate release operation.

No later capability is activated merely by being described in a task or roadmap.

For the proposed MacBook, Samsung A16 and iPhone X clients, see [CROSS_DEVICE_ROLLOUT.md](CROSS_DEVICE_ROLLOUT.md). Remote clients and shared execution are subsequent work, not part of this desktop release.
