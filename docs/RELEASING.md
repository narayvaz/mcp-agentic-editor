# Release candidates, native review, and recovery

## Present release boundary

The current ARM64 upgrade is a test candidate. Automated verification does not prove native acceptance, a working production integration, Gatekeeper acceptance, or compatibility with an installed app's automatic updater. No workflow here publishes a stable release or replaces an installed application.

The canonical source is this repository and its reviewed commits. Each `npm run build:release` creates a **unique build instance**. The manifest includes source inputs (including the lockfile, build configuration, and public assets), artifact digests, toolchain metadata, timestamp, and an instance identity. Keep the manifest together with its exact packaged app; rebuilding the same commit creates another instance. This is traceability, not a promise of byte-identical binaries.

## Automated gate

The shared `verify-macos.yml` workflow is used by both CI and manual draft releases. It uses the explicit `macos-15` runner and asserts macOS/ARM64 before proceeding. Node.js 22 installs dependencies using `npm ci` and the committed lockfile. No production keys or Apple signing secrets are supplied.

The gate:

1. Tests the release-asset validator, checks TypeScript, runs the full application regression suite including `*.host.test.ts`, and builds frontend, backend, and Electron code. Failure of `sandbox-exec` is a failed gate; it is not skipped or replaced by a weaker sandbox.
2. Packages DMG and ZIP using `--publish never` and `mac.identity=-`. The builder signs the app ad hoc **before** producing the archives. Do not use `identity=null`, which skips signing, or sign only the unpacked app after making an archive.
3. Verifies the external packaged manifest and all manifest-listed artifacts. It checks the app's ad-hoc signature, then extracts the ZIP and mounts the DMG read-only to verify each embedded app's manifest, signature, and complete bundle fingerprint against the checked app.
4. Rejects `.env*` paths in the bundle and ASAR. It verifies `latest-mac.yml` version, local asset URLs, SHA-512 digests, and sizes against the archives; a macOS ZIP and builder-generated blockmap are required.
5. Uploads only the checked ZIP, DMG, available archive blockmaps, `latest-mac.yml`, build manifest, package verification result, SHA-256 sums, and workflow provenance. It does not upload a loose `.app`, source checkout, local settings, or broad logs. The Actions artifact retention is 14 days.

CI runs for branch pushes and pull requests with `contents: read`. It cannot create a release. Actions use maintained official major versions; the dependency lock and source commit do not pin the hosted runner image or Action implementations. Review future Action/runner changes and keep the runtime architecture assertion.

## Create a reviewable draft

In GitHub Actions, select **Draft test release**, choose the reviewed branch, and run it. GitHub requires a dispatchable workflow on the default branch before it appears in the UI. The selected ref is built and checked afresh; a prior artifact is not silently reused.

Only its final draft job has `contents: write`. That job downloads the exact artifact ID from its successful build job, checks the artifact digest, commit/run provenance and each asset hash, and creates a uniquely named `candidate-…` release using `--draft --prerelease --latest=false`. It neither checks out nor executes application code. A failed upload may leave an incomplete **draft** for operator inspection. It does not edit an existing published release, publish a draft, or mark anything Latest.

Keep all assets together, especially the ZIP and `latest-mac.yml`. The ZIP is required by the macOS updater even if users normally install a DMG. Metadata attached to a draft is for inspection and does not establish a live stable update feed.

## Native acceptance before any installation

Record the exact build ID, source commit, macOS version, tester, date, and results. Review these operations against an isolated test state before touching real settings:

- Launch from the packaged app and confirm it reports the packaged backend and matching frontend/backend build identity. Test clean launch, an occupied preferred port, quit, and relaunch; a different service must not be reused as the backend.
- Review Settings, configured/missing credentials, secret masking, and persistence after relaunch. Confirm an unauthenticated browser and an untrusted origin cannot invoke protected local operations.
- Exercise source research and one permitted read-only integration with test credentials. Check source links, unavailable-data messages, evidence freshness, and cancellation without publishing or deploying anything.
- Review a harmless development proposal: approval matches the immutable proposal, flags-off/stop/cancel fail closed, isolated validation runs, and the running app stays unchanged. A validated candidate is an operator handoff, not automatic activation.
- Stage a complete bundle, activate it only while the app is stopped, confirm its runtime identity after launch, then rehearse rollback using a retained complete app and a backed-up compatible settings file.

The automated suite covers many of these boundaries, but an unattended packaging result is not a record of native UI acceptance. Until that record exists, leave the GitHub release as a draft prerelease.

### Native UI acceptance matrix — all pending

The review must cover every view in the five main areas and Development lab, including every enabled button, form, menu, link, disclosure, and Assistant action. An attractive screenshot or one successful route does not complete an area. Inventory each control against the exact build, record its intended effect and observed result, and verify any disabled control explains what is missing. Use fixtures or test services for actions; production writes require their own authorization.

| Area | Views and essential coverage | Acceptance status |
| --- | --- | --- |
| Work | Overview and Article review; selection, refresh, review controls, editable fields, draft persistence and restoration | Pending |
| Evidence | Story records; create/open/search/select, source links, evidence fields, provenance and freshness | Pending |
| Production | Runs & outputs and Schedules; current/empty/unavailable runs, output links, schedule forms and truthful availability of actions | Pending |
| Audience | Search performance; site/date controls, refresh, data freshness, unavailable credentials and empty results | Pending |
| System | Health, Connections, Editorial rules, Activity and Guide; every connection/rule form, masking, validation, persistence, history and documentation links | Pending |
| Development lab | Prompt recipes, Code workshop and Experiments; all recipe/proposal controls, immutable approval, staging, stop/cancel, conflicts and operator handoff | Pending |
| Shared interface | Main/subnavigation, selected-story context, Assistant toggle and close, all Assistant controls, overlays, notifications and external links | Pending |

For **every enabled control and form**, exercise loading, empty, failure, conflict, cancel and success states wherever applicable. Record a reason when a state cannot apply. Check duplicate clicks, stale results, validation errors, safe retry, cancellation during work, truthful completion feedback and state after relaunch. A missing integration must produce an actionable unavailable state rather than a fabricated success.

Review keyboard-only operation, visible focus, logical tab order, focus entry/return for overlays, Escape/close behavior, and usable screen-reader names and state announcements with macOS VoiceOver. Explicitly test dirty Settings when navigating between views, saving and discarding; article draft restoration after navigation/relaunch; and Assistant opening/closing and the keyboard toggle while work or an unsaved form is active. These checks are **pending**.

| Desktop viewport in CSS pixels | Reflow and interaction status |
| --- | --- |
| 320 × 800 | Pending |
| 390 × 844 | Pending |
| 768 × 1024 | Pending |
| 1024 × 768 | Pending |
| 1200 × 800 | Pending |
| 1440 × 900 | Pending |

At each size, review every view with Assistant both closed and open, long Armenian/Russian/English text, empty/error/loading content, and **200% zoom**. Confirm forms and action bars fit, navigation remains reachable, focus stays visible, overlays remain dismissible, and scrolling does not trap essential controls. Record any minimum-window limitation explicitly and repeat at the smallest supported native height. The narrower sizes are desktop layout/reflow tests, including emulated content widths if the native window cannot shrink that far; they do **not** establish support on real mobile devices or mobile operating systems. All viewport/zoom acceptance remains pending until observed and recorded.

## One-time migration and retained rollback

The existing 0.1.16 installation is ad-hoc signed with a binary-specific designated requirement. A newly built ad-hoc app does not satisfy that requirement. Squirrel.Mac may reject it even when its checksum is correct. Do not disable signature verification to force an upgrade.

Migration therefore requires a separately reviewed **manual installation of a complete verified app bundle**, while Azat Studio is stopped. Before migration, retain the original complete app, original source/builds, and a private backup of local settings/history. The upgraded app loads the packaged backend; set its development workspace to the reviewed upgraded source checkout if development proposals are desired.

Use an operator-reviewed copy of `scripts/release-supervisor.mjs` outside any model-editable workspace. Keep that stable controller, its private release store, and the original recovery helper outside the candidate repository and outside app-controlled updates. Its `stage`, `status`, `activate`, and `rollback` commands identify and verify complete bundles; `activate` retains the replaced app and exchanges bundle directories atomically on macOS. It is a privileged operator tool: a stage result is not a signature, notarization, or native-QA endorsement.

Suggested sequence, with real paths/IDs recorded by the operator:

1. Back up the private state and retain the original source and app. Copy/review the stable controller separately and record its checksum. Inspect its release store with `status`.
2. Run `stage` on the original app and record its `baseline-…` ID. Run `stage` on the checked, signed candidate and record its manifest build ID. Preserve both; do not rebuild or re-sign a staged bundle in place.
3. Quit Azat Studio. Run `activate` for the candidate's exact staged ID, launch, and check the installed runtime identity and native acceptance results.
4. For an original-0.1.16 rollback, quit the app first. Atomically restore the legacy configuration's original workspace path and disable self-modification and automatic application, then activate the retained baseline ID using the external controller. The legacy app can import the backend from that original workspace, so a bundle-only rollback is insufficient if its configured workspace still points at the upgraded checkout.

Private paths, baseline IDs, settings backups, and the installation-specific `recover-original.mjs` helper do not belong in Git. Never reset a release lock or remove an incomplete stage automatically; preserve the journal and both bundles for operator recovery. Website/VPS deployments are separate actions.

## Future public releases and automatic updates

Ad-hoc signing is suitable for these controlled test packages. It provides neither Developer ID trust nor notarization. Public distribution and dependable macOS automatic updates require a separately configured, consistently identified Developer ID signing certificate, notarization, a reviewed signing transition, and end-to-end upgrade/recovery tests from the supported installed version.

Before establishing a stable feed, complete native QA, correct versioning and channel selection, notarization/Gatekeeper validation of the actual distributed archives, and a real installed-version-to-candidate updater test. Preserve signature verification. Do not turn a current ad-hoc test draft into a stable release as a substitute for that work. The app's operator-controlled application replacement boundary must remain intact.

## References

- [GitHub-hosted runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [Official checkout](https://github.com/actions/checkout), [Node setup](https://github.com/actions/setup-node), [artifact upload](https://github.com/actions/upload-artifact), and [artifact download](https://github.com/actions/download-artifact) actions
- [GitHub CLI draft/prerelease/latest flags](https://cli.github.com/manual/gh_release_create)
- [electron-builder v26 publishing controls](https://www.electron.build/v26/docs/publish/) and [macOS update requirements](https://www.electron.build/v26/docs/features/auto-update/)
- The locked builder's `macOptions.identity` documentation: `-` means ad hoc; `null` skips signing.
