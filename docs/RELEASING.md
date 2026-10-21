# Release candidates, native review, and recovery

## Present release boundary

The current ARM64 upgrade is a test candidate. Automated verification does not prove native acceptance, a working production integration, Gatekeeper acceptance, or compatibility with an installed app's automatic updater. No workflow here publishes a stable release or replaces an installed application.

The canonical source is this repository and its reviewed commits. Each `npm run build:release` creates a **unique build instance**. The manifest includes source inputs (including the lockfile, build configuration, and public assets), artifact digests, toolchain metadata, timestamp, and an instance identity. Keep the manifest together with its exact packaged app; rebuilding the same commit creates another instance. This is traceability, not a promise of byte-identical binaries.

## Automated gate

The shared `verify-macos.yml` workflow is used by both CI and manual draft releases. It uses the explicit `macos-15` runner and asserts macOS/ARM64 before proceeding. Node.js 22 installs dependencies using `npm ci` and the committed lockfile. No production keys or Apple signing secrets are supplied.

The gate:

1. Tests the release-asset validator, checks TypeScript, runs the full application regression suite including `*.host.test.ts`, and builds frontend, backend, and Electron code. Failure of `sandbox-exec` is a failed gate; it is not skipped or replaced by a weaker sandbox.
2. Packages DMG and ZIP using `--publish never` and `mac.identity=-`. The job explicitly enables `CSC_FOR_PULL_REQUEST` because the builder otherwise skips all signing for pull requests; this credential-free job permits only ad-hoc signing and disables identity discovery. The builder signs the app ad hoc **before** producing the archives. Do not use `identity=null`, which skips signing, or sign only the unpacked app after making an archive. Never supply production signing credentials to this PR job.
3. Verifies the external packaged manifest and all manifest-listed artifacts. It checks the app's ad-hoc signature, then extracts the ZIP and mounts the DMG read-only to verify each embedded app's manifest, signature, and complete bundle fingerprint against the checked app.
4. Rejects `.env*` paths in the bundle and ASAR. It verifies `latest-mac.yml` version, local asset URLs, SHA-512 digests, and sizes against the archives; a macOS ZIP and builder-generated blockmap are required.
5. Uploads only the checked ZIP, DMG, available archive blockmaps, `latest-mac.yml`, build manifest, package verification result, SHA-256 sums, and workflow provenance. It does not upload a loose `.app`, source checkout, local settings, or broad logs. The Actions artifact retention is 14 days.

CI runs for branch pushes and pull requests with `contents: read`. It cannot create a release. Actions use maintained official major versions; the dependency lock and source commit do not pin the hosted runner image or Action implementations. Review future Action/runner changes and keep the runtime architecture assertion.

The latest local gate passed all **132 application tests and five release-asset tests**, including host sandbox tests, and all three builds. Strict packaged-bundle and manifest verification also passed locally. These results establish the automated boundary above; they do not complete the native acceptance matrix below.

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

### Native UI acceptance matrix — partial checks recorded

All local times in this review use Asia/Yerevan.

On **21 October 2026**, version **0.2.0**, build **`b5deb62ca6fe`**, was installed and its runtime identity verified. Its connection checks below are historical observations of that build; the subsequent installed Assistant repair is recorded separately below. Current settings and profile backups were retained. Native English WordPress connection, Search Console reporting and Production observations passed as recorded below; Production was checked again after a clean quit and relaunch. The authorized post-relaunch check returned to the same Article review with its draft unchanged.

Earlier checks on 20 October confirmed packaged identity, retained conversations and unsaved Settings across navigation. A separate origin served the actual frontend with clearly marked, stateful QA-only APIs; fixture results below establish UI behavior only. No production WordPress saves or model requests were made by those fixture checks. A prior candidate's native Expert/Smart observation passed at 20:50 local time; build `e2813170ed9a` passed native Search Console reporting at 21:04 for the 20 September–17 October reporting window. These historical observations are separate from the current build's checks.

The review must cover every view in the five main areas and Development lab, including every enabled button, form, menu, link, disclosure, and Assistant action. An attractive screenshot or one successful route does not complete an area. Inventory each control against the exact build, record its intended effect and observed result, and verify any disabled control explains what is missing. Use fixtures or test services for actions; production writes require their own authorization.

| Area | Views and essential coverage | Acceptance status |
| --- | --- | --- |
| Work | Overview and Article review; selection, refresh, review controls, editable fields, draft persistence and restoration | Partial: multilingual editing, isolated preview, before/after preflight, cancel, fixture save receipt, stale-revision block and draft preservation across navigation/reload observed. The b5 native build returned to the same article and unchanged draft after the authorized relaunch check. |
| Evidence | Story records; create/open/select, source links, evidence fields, provenance and freshness | Partial: create/source/claim validation, save, language output, delayed output selection and delayed conflict isolation observed. Conflict recovery and correction history/stale-output labels also observed; full retained-output interaction/export remains pending. |
| Production | Runs & outputs and Schedules; current/empty/unavailable runs, output links and truthful availability of actions | Partial: b5-build native Expert/Smart refresh passed on 21 October at 11:16 local time and fresh after clean quit/relaunch at 11:21, with matching observations. Native script export produced valid JSON with exact Armenian/Russian/English text; the operator's test draft was restored to empty. Fixture views, readable source times and unavailable executor controls also observed. |
| Audience | Search performance; refresh, data freshness, unavailable credentials and empty results | Partial: b5-build native Search Console reporting passed on 21 October at 11:07 local time for the 21 September–18 October completed reporting window. Fixture reporting, opportunities, injected unavailable state and successful retry also observed. |
| System | Health, Connections, Editorial rules, Activity and Guide; connection/rule forms, masking, validation, persistence, history and documentation | Partial: b5-build native English WordPress Test passed on 21 October at 11:06:16 local time. Redacted native settings, unsaved navigation retention/revert; fixture discard, add/remove/save site, SSH/HTTPS fields, staged rule save, activity filter and Guide observed. Not every connection/update control accepted. |
| Development lab | Prompt recipes, Code workshop and Experiments; recipe/proposal controls, immutable approval, staging, stop/cancel, conflicts and operator handoff | Partial: local recipe create/edit and fixture response; proposal preparation, exact-review checkbox, disabled validation until consent and simulated validation handoff observed. Actual isolation is covered separately by host tests. |
| Shared interface | Main/subnavigation, selected-story context, Assistant toggle and close, Assistant controls, overlays, notifications and external links | Partial: navigation, context opt-out, fixture response, Stop feedback, overlay keyboard entry/Tab wrap/Escape return, mobile navigation priority and resize recovery observed. Archived-send shortcut blocked, restore re-enables Send, and harmless attachment add/remove observed. Chat-export download receipt and full external-link coverage remain pending. |

For **every enabled control and form**, exercise loading, empty, failure, conflict, cancel and success states wherever applicable. Record a reason when a state cannot apply. Check duplicate clicks, stale results, validation errors, safe retry, cancellation during work, truthful completion feedback and state after relaunch. A missing integration must produce an actionable unavailable state rather than a fabricated success.

Review keyboard-only operation, visible focus, logical tab order, focus entry/return for overlays, Escape/close behavior, and usable screen-reader names and state announcements with macOS VoiceOver. Explicitly test dirty Settings when navigating between views, saving and discarding; article draft restoration after navigation/relaunch; and Assistant opening/closing and the keyboard toggle while work or an unsaved form is active. Credential access now resolves asynchronously only at the requested service boundary, with a three-second helper deadline and a short memory cache. Metadata/settings/health reads do not open the Keychain. Fake-helper regressions verify main-loop responsiveness, per-account independence, cancellation, redacted errors and retained saved references. An approved import of the existing Google service-account credential passed an exact cold Keychain round-trip check; the original service account was unchanged. This credential check and the recorded native reporting check do not establish acceptance of every connection control.

Only the explicitly recorded checks above have passed. Full control/error-state coverage, VoiceOver, complete keyboard-only acceptance, chat export and a native rollback rehearsal remain **pending**.

The actual frontend was measured in **224 combinations**: 14 views × eight viewport sizes × assistant closed/open. All sampled normal fixture states fit the document/header/main bounds; the assistant and composer fit their viewport. These are layout checks, not complete interaction or accessibility acceptance.

| Desktop viewport in CSS pixels | Fixture layout result |
| --- | --- |
| 320 × 800 | All 14 views; assistant closed/open; passed bounds checks. |
| 390 × 700 | All 14 views; assistant closed/open; passed. Mobile navigation priority also observed. |
| 721 × 500 | All 14 views; assistant closed/open; passed. Compact assistant screenshot reviewed. |
| 768 × 1024 | All 14 views; assistant closed/open; passed. |
| 800 × 950 | All 14 views; assistant closed/open; passed. Widening clears mobile-nav lock. |
| 1024 × 768 | All 14 views; assistant closed/open; passed. |
| 1200 × 800 | All 14 views; assistant closed/open; passed. Native startup also observed. |
| 1440 × 900 | All 14 views; assistant closed/open; passed. |

At each size, review every view with Assistant both closed and open, long Armenian/Russian/English text, empty/error/loading content, and **200% zoom**. Confirm forms and action bars fit, navigation remains reachable, focus stays visible, overlays remain dismissible, and scrolling does not trap essential controls. Record any minimum-window limitation explicitly and repeat at the smallest supported native height. The narrower sizes are desktop layout/reflow tests, including emulated content widths if the native window cannot shrink that far; they do **not** establish support on real mobile devices or mobile operating systems.

An enlarged native Production view with Assistant open was observed after Actual Size followed by five Zoom In actions. The exact zoom percentage was not measured. This is one observed view, not completion of the 200% matrix. Every-view zoom/state coverage, VoiceOver, complete keyboard/control coverage, chat-export download receipts and actual mobile operating systems remain unverified.

### Bounded production reads

Production status reads settle independently of transport callbacks. The SSH reader has a 25-second hard deadline and releases its owned process/streams; HTTPS status includes a 15-second deadline through JSON-body reading. Each worker observation has a 30-second bound, so a missing worker cannot hide a successful worker receipt. Cached failures can be retried. The three Production/Schedules GET routes have a 40-second frontend deadline; writes and AI workflows retain their existing behavior. A timeout does not claim that remote work was cancelled.

The passing gate includes never-answering helpers, late callbacks, pipe errors, stalled bodies, partial worker success and successful retry. This closes an indefinite-wait gap found during review. The checked complete bundle is installed as build `b5deb62ca6fe`; its native Production observations passed before and after clean relaunch.

Initial native reads on 21 October reached the hard 25-second timeout. The captured SSH stack mapped to opening the configured identity file for public-key probing, before authentication. A Documents-folder access Create event appeared at 11:15:18 local time, followed by the successful native refresh at 11:16 and fresh relaunch check at 11:21. The agent changed no OS permissions or key files, and the access event's trigger is unknown. The evidence strongly supports a local file-access/privacy wait; it does not establish exactly which authorization action occurred. The deadlines provide bounded failure and retry; they should not be credited with clearing the OS access wait.

### Assistant repair — native answer verified; broader recovery acceptance partial

Build `0.2.0-07aaa30570e7` passed the 132-test application gate, five asset tests and three builds; its complete package was strictly verified, installed and identified through the running app. The native Assistant restored the existing unanswered question and received a detailed reply in the same retained chat, reusing that question rather than duplicating it. The composer was empty afterward and story/research inputs were excluded. The exact reported question asking Studio to describe itself after past changes is now an informational request rather than a Development redirect. Regression coverage retains the redirect for actual app-change requests, and a current capability guide distinguishes installed features from proposals.

An isolated check of the original request returned HTTP 500 after 32,151 ms; its last provider response was HTTP 503 overload. The repaired backend returned HTTP 200 for the same question from the configured Gemma model after 42,072 ms. These are isolated service checks, not native UI acceptance or a guarantee of provider availability. Provider failures now produce fixed, actionable error categories without exposing raw provider errors or credentials.

The recovery flow retains failed questions in their original chat, keeps submitted attachments in memory and protects an existing composer draft. Automated regressions cover recovery eligibility, unchanged-turn ID reuse, narrowed retry inputs and cancellation; native forced-error/retry/attachment and changed-opt-out interactions remain pending. The native unanswered-question restore and successful response have passed. A fresh Production refresh also passed on this installed build after relaunch; initial SSH timeouts coincided with a new Documents-folder permission request. System Settings showed the existing Documents and Downloads permissions enabled. No permission or key was changed by the agent, and the access decision’s trigger remains unknown. Attachment contents are unavailable after closing or relaunching, and restoration explains the need to reattach files. This repair adds no video production, live broadcast or autonomous agent execution powers; chat continues to provide advice and drafts.

## One-time migration and retained rollback

The existing 0.1.16 installation is ad-hoc signed with a binary-specific designated requirement. A newly built ad-hoc app does not satisfy that requirement. Squirrel.Mac may reject it even when its checksum is correct. Do not disable signature verification to force an upgrade.

Migration therefore requires a separately reviewed **manual installation of a complete verified app bundle**, while Azat Studio is stopped. Before migration, retain the original complete app, original source/builds, and a private backup of local settings/history. The upgraded app loads the packaged backend; set its development workspace to the reviewed upgraded source checkout if development proposals are desired.

Use an operator-reviewed copy of `scripts/release-supervisor.mjs` outside any model-editable workspace. Keep that stable controller, its private release store, and the original recovery helper outside the candidate repository and outside app-controlled updates. Its `stage`, `status`, `activate`, and `rollback` commands identify and verify complete bundles; `activate` retains the replaced app and exchanges bundle directories atomically on macOS. It is a privileged operator tool: a stage result is not a signature, notarization, or native-QA endorsement.

Suggested sequence, with real paths/IDs recorded by the operator:

1. Back up the private state and retain the original source and app. Copy/review the stable controller separately and record its checksum. Inspect its release store with `status`.
2. Run `stage` on the original app and record its `baseline-…` ID. Run `stage` on the checked, signed candidate and record its manifest build ID. Preserve both; do not rebuild or re-sign a staged bundle in place.
3. Quit Azat Studio. Run `activate` for the candidate's exact staged ID, launch, and check the installed runtime identity and native acceptance results.
4. For an original-0.1.16 rollback, quit the app first. Atomically restore the legacy configuration's original workspace path and disable self-modification and automatic application, apply the credential compatibility rule below, then activate the retained baseline ID using the external controller. The legacy app can import the backend from that original workspace, so a bundle-only rollback is insufficient if its configured workspace still points at the upgraded checkout.

### Credential compatibility during rollback

New Keychain writes use a printable, versioned envelope that preserves exact Unicode and newline content. Existing legacy tokens remain literal; the reader does not guess that hexadecimal or base64-looking tokens are encoded. Malformed or unsupported reserved envelopes fail closed with a redacted credential error.

**An older app from before this codec cannot decode the new envelope.** Before activating such a bundle, restore backed-up compatible references for every credential migrated to the envelope, including Google credentials and WordPress username/password pairs. Restore a matching username/password pair together in one atomic settings update; preserve unrelated current preferences and credentials. Retain the compatible Keychain entries as well as their references. Do not replace the entire current settings file merely to restore migrated fields. Private recovery helpers are prepared separately for this installation; a helper that restores only Google is insufficient after another credential has been migrated. Check every restored reference against the bundle being activated.

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
