# Azat Studio technical notes

## Desktop runtime

The Electron launcher verifies the release manifest, starts the packaged Express backend on loopback and supplies a fresh session credential through a narrow preload bridge. The installed app never imports an editable workspace backend. Open the application through `npm run dev` or its packaged app; an ordinary browser tab does not receive the desktop session.

The React interface has Work, Evidence, Production, Audience and System areas, plus a separate Development Lab. Requests require the session and pass host/origin checks; WebSocket access is protected too. Public readiness exposes no configuration. Saved credentials are redacted from API responses, and new credentials are stored through macOS Keychain. Configuration and editorial records use the application state directory, normally `~/.mcp-agentic-editor`.

## Data and external services

Conversations and unsaved drafts use the desktop browser profile; evidence records and history are retained in application state. These are local stores with capacity and backup limits, not a shared newsroom database.

When requested, model interactions send the prompt, included conversation and selected editorial context to the configured model provider. Selected-story context can be excluded in the assistant. Article review and translated outputs also send their relevant text. Connected WordPress, Search Console and VPS requests communicate with those services. Public research retrieves bounded passages from source websites; capture is not factual verification. Avoid sending material that its intended provider should not receive.

Models are configured in Settings. Generation reports its actual responding model and has bounded fallback, timeout and cancellation behavior. No fixed model name is assumed to remain available.

## Editorial behavior

- WordPress editing requires raw source and an expected revision. A preview-only preflight precedes an explicit save; a readback confirms the result. External simultaneous edits cannot be atomically locked.
- Evidence links sources and claims, records revisions and corrections, and flags older dependent outputs for review. Translations require editorial parity review.
- Search cards use actual completed-window GSC data; missing measurements remain unknown. Website health is a scoped observation, not a vulnerability or uptime audit.
- The production observer reads supported status endpoints over the configured connection. Narration, rendering, broadcast and schedule execution are unavailable until real adapters exist.
- Prompt recipes are saved instructions, not executable tools. Chat advice does not apply code or production changes.

## Isolated development and releases

Development proposals freeze their exact source changes in a private copy. Protected runtime, settings, launcher and release files cannot be edited by this workflow. Validation uses the macOS OS sandbox, rejects outside-file and network access, and requires behavioral tests, types and builds. It cannot activate or restart the app; automatic application is disabled.

The operator-only release controller retains and fingerprints complete app bundles and performs atomic promotion with the app stopped. Its installed copy lives outside editable source. Legacy 0.1.16 also depends on its configured external workspace; recovery requires that matching workspace and disabled legacy research state as well as its app bundle.

`npm run build:release` runs the required tests and builds, then records artifact hashes, source/build-input identity, toolchain information and a unique build instance. `scripts/verify-packaged.mjs` checks the actual archive content and rejects packaged environment configuration. See [release and migration instructions](docs/RELEASING.md) for GitHub assets, signing and acceptance requirements.

## Verification boundaries

Automated regressions and package checks do not establish complete UI coverage. Native launch, every enabled workflow, keyboard operation, draft recovery, resizing and zoom remain separate acceptance checks. The platform is a Mac desktop app; responsive layout does not establish phone or tablet device support.
