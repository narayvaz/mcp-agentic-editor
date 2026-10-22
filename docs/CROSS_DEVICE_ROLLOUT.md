# Studio on the MacBook, Samsung A16 and iPhone X

This is the next delivery architecture, not an already released mobile app. The current candidate is a macOS Apple Silicon desktop package; its task executor and ledger currently live on the iMac.

## Shared product, different clients

| Device | Intended client | Acceptance requirement |
| --- | --- | --- |
| MacBook Pro | Native desktop client, plus browser access | Verify processor/macOS; build and check Intel separately when needed. |
| Samsung A16 | Responsive HTTPS web app, installable to the Home Screen | Test the actual Android/browser version, touch controls, reconnect, attachments and permissions. |
| iPhone X | Lightweight Safari/Home Screen web app | Test on its actual iOS 16 version; use compatible APIs and fallbacks. Do not require current-generation iOS features. |

Research, projects, evidence, drafts and approvals should refer to the same server-side records. The phone must not hold WordPress, provider or VPS credentials. Heavy generation and task execution belong on the server, so the phone can disconnect without terminating an assignment.

## Required work before phone access

1. Accept the desktop foundation and its recovery behavior.
2. Introduce a separately authenticated server executor and central PostgreSQL/evidence storage. Migrate with verified backups and a supervised cutover; do not start competing workers against separate copies of the same task.
3. Add a remote session/API layer with encrypted transport, authorization per user/project/action, session revocation and CSRF/origin protection. Audit approvals against the same immutable action and revision on every client.
4. Reuse the editorial UI in a focused mobile shell: conversations, tasks, evidence, draft review and approvals first. Preserve edits across navigation and reconnect; show stale/offline state explicitly. Do not allow approval from a stale cached screen.
5. Add a web-app manifest, icons, safe update behavior and optional notifications. Cache static interface assets deliberately; do not indiscriminately cache authenticated evidence, credentials or approval responses.
6. Test native desktop and the actual phone browsers: sign-in/out, narrow layouts, keyboard/touch, file pickers, background/reconnect, accessibility, duplicate taps, stale approvals and device/session revocation.

The installed desktop backend is intentionally loopback-only and uses an Electron-held session token. Exposing that listener or copying its token to phones is not the mobile solution. A shared database alone also does not provide shared evidence files, remote authentication or always-on execution.

## First mobile release

Start with reading task progress and retained drafts, then add instructions and exact-action approvals after device acceptance. Add liveblog monitoring and broadcast preparation later using the same task/receipt model. Live distribution and code/service changes retain their separate approval and release controls.

For iPhone X, support basic task interaction on its older browser before considering push, media processing or other optional features. Home Screen web apps are documented by [WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/); Android web-app installation is documented by [Google Chrome](https://support.google.com/chrome/answer/9658361).
