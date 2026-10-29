# Studio recovery baseline

This operator tool protects the current desktop foundation before a migration. It never stops or starts Studio, resolves Keychain entries, calls a provider, restores a live database, or enables an agent. Run it with Studio already closed normally, after preserving any unsent attachments. No checkpoint is accepted while queued, running, approved, uncertain or leased task work remains.

The snapshot contains the complete installed application, the backend state and ordinary Electron profile, plus a consistent PostgreSQL logical dump. Raw live PostgreSQL data, socket, logs and nested database backups are excluded. Historical incomplete release archives under `release-controller/recovery` are also excluded and left untouched: they may contain links into retired source checkouts. The current complete installed bundle and active release metadata are captured separately. Every exclusion is recorded in the checkpoint manifest. Configuration and connector references are copied as opaque private bytes. Keychain contents remain in the original account; this is not a cross-account credentials backup. Memory-only attachment contents cannot be recovered from disk.

Every copied directory is 0700. Backend and renderer files are 0600. The private primary application snapshot retains owner execute bits (0700 for executables); original modes are recorded. Quarantined verification copies remove all execute bits. Relative internal symlinks are retained. Absolute, escaping, broken and cyclic links, special files, changing files, existing destinations and overlapping roots are rejected. A failed capture may leave a partial private directory, with no accepted manifest; it must not be treated as a usable checkpoint.

The ordinary renderer directory is `~/Library/Application Support/mcp-agentic-editor`, rather than `Azat Studio`. Explicit `AZAT_STATE_DIR` profiles instead use `<state>/desktop-profile`; supply both overrides when capturing one. A checkpoint brackets its file copy and logical dump with process checks, stable filesystem metadata and read-only ledger counts/content digests. This relies on other operators leaving sources quiescent; it is not an operating-system-wide atomic snapshot.

The tool accepts only the dedicated local Studio PostgreSQL Unix-socket reference from `agent-runtime.json`. It rejects network connections, embedded passwords and arbitrary connection options. Connection parameters are supplied through a sanitized child environment, not displayed or inserted into command arguments. PostgreSQL command output and errors remain private.

Example from the repository root, choosing new absolute destination paths with existing parents:

```sh
python3 scripts/studio-recovery-baseline.py snapshot --destination /private/tmp/studio-checkpoint-unique
python3 scripts/studio-recovery-baseline.py verify --snapshot /private/tmp/studio-checkpoint-unique --destination /private/tmp/studio-restore-unique
```

`verify` first verifies every captured file, restores copies into a new non-executable quarantined directory, then initializes a new PostgreSQL cluster. It starts only that PostgreSQL child with no TCP listener and an owner-only Unix socket, restores the ledger into a new database, compares counts, schema versions and content digests, and stops the child. It never points Studio at restored approvals. Use a short verification destination: PostgreSQL Unix socket paths have a strict length limit.

Private `verification.json` and `isolated-database.json` receipts retain evidence and the stopped cluster's local reference for a later separately reviewed fixture. Do not start the app from these restored files. A restored approval might describe an external action that already occurred after the snapshot. Activation requires fresh authority, invalidated old approvals and leases, and reconciliation of destinations.

This verifies file integrity and offline database restoration. It does not prove recovered UI journeys, Keychain portability, future migrations, publication rollback or execution-safe replay. Keep the original application and account until those acceptance checks are complete. Retained private snapshots also retain old content; do not promise deletion from backups while they remain.

Synthetic helper tests (no live profile or database access):

```sh
python3 tests/studio-recovery-baseline.test.py
```
