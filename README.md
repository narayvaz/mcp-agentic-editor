# Azat Studio

Azat Studio is a native macOS desktop workspace for editorial research, source evidence, website observations, and reviewed development proposals. It uses Electron, React, TypeScript, and a local Express backend.

The current upgrade is a **test candidate**. A successful build verifies the automated checks; native acceptance review and a verified installation migration are still required. See [release and recovery instructions](docs/RELEASING.md).

## Run from source

Use an Apple Silicon Mac with Node.js 22, npm, and Apple's Command Line Tools. Run these commands from a reviewed checkout:

```bash
npm ci
npm run desktop:dev
```

This checks types, runs all regressions including the real macOS sandbox boundary tests, builds the frontend/backend/desktop entry, creates a build manifest, and opens the native app. `npm run dev` is an alias for the same desktop flow. `npm start` opens already-built files and does not rebuild them. A standalone browser cannot obtain the desktop's session credentials.

Connect services in the app's Settings as needed. Local checks and packaging need no production credentials. Keep service keys, application state, and `.env` files outside version control and release uploads. Test integrations using appropriate limited credentials and review their reported freshness and availability.

## Current behavior

- Research presents source links and evidence separately from model interpretation. External data requires a configured, reachable service; unavailable data must not be read as a successful check.
- Production observations use the configured integrations. Installing the app does not itself repair or deploy websites or pipelines.
- Self-development creates bounded proposals in an isolated candidate workspace. An exact proposal approval and successful validation are required before handing a candidate to the operator. It does not replace the running app or automatically promote an experiment.
- The installed app loads its packaged backend and verifies the release manifest. An editable development workspace is not an alternative installed backend.
- Application replacement belongs to an external operator-controlled release supervisor, with a retained rollback bundle. Native QA and recovery are separate from an automated build result.

## Verification and packaging

```bash
npm run build:release
npx --no-install electron-builder --mac dmg zip --arm64 --publish never -c.mac.identity=-
node scripts/verify-packaged.mjs 'release/mac-arm64/Azat Studio.app'
codesign --verify --deep --strict --verbose=2 'release/mac-arm64/Azat Studio.app'
```

These commands create **ad-hoc signed test packages**, not a notarized public release. The CI workflow additionally checks both archives, their update-feed checksums, packaged environment-file exclusion, and upload provenance. It retains only explicit release assets for 14 days.

GitHub Actions runs this gate for branch pushes and pull requests. The separate **Draft test release** workflow runs only when manually dispatched and creates a draft prerelease, never a published or Latest release. Signing certificates and production API keys are not required. [RELEASING.md](docs/RELEASING.md) explains the remaining native review and signing requirements.

## Main locations

| Path | Purpose |
| --- | --- |
| `src/` | Desktop interface and client services |
| `server.ts`, `server/` | Local API, integrations, security, and isolated development controller |
| `electron/` | Native startup, IPC, updater coordination, release verification |
| `scripts/` | Build identity, package verification, external release supervisor |
| `tests/` | Behavioral regressions and macOS host boundary tests |
| `.github/workflows/` | Shared macOS gate, CI, and manual draft-only packaging |

This repository contains application source. Local credentials, working history, retained installations, and private operator recovery files are separate assets and must be backed up independently.
