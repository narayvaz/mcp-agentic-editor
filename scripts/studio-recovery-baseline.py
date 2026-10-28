#!/usr/bin/env python3
"""Operator-only Studio recovery checkpoint. Never starts Studio or restores live data."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import signal
import stat
import subprocess
import sys
import time
from urllib.parse import parse_qs, urlencode, urlsplit


class BaselineError(Exception):
    """Messages are controlled strings; never forward subprocess output or data."""


SCHEMA = 1
EXCLUDED_BACKEND = {
    "agent-db/data", "agent-db/run", "agent-db/logs", "agent-db/backups",
    # Historical incomplete releases may contain links to retired checkouts.
    # Preserve those archives in place; capture the complete current app separately.
    "release-controller/recovery",
}
STATUS_SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL timezone = 'UTC';
SELECT json_build_object(
 'queued',count(*) FILTER (WHERE status='queued'),
 'running',count(*) FILTER (WHERE status='running'),
 'waitingApproval',count(*) FILTER (WHERE status='waiting-approval'),
 'uncertain',count(*) FILTER (WHERE EXISTS
   (SELECT 1 FROM jsonb_array_elements(COALESCE(data->'steps','[]'::jsonb)) step WHERE step->>'status'='uncertain')),
 'retainedApprovals',count(*) FILTER (WHERE data->'approval'->>'status' IN ('pending','approved')),
 'activeLeases',count(*) FILTER (WHERE lease_until > clock_timestamp()),
 'totalRuns',count(*)) FROM azat_agent.runs;
COMMIT;"""
COUNTS_SQL = """BEGIN READ ONLY;
SET LOCAL timezone = 'UTC';
SELECT json_build_object(
 'projects',(SELECT count(*) FROM azat_agent.projects),
 'runs',(SELECT count(*) FROM azat_agent.runs),
 'events',(SELECT count(*) FROM azat_agent.events),
 'migrations',(SELECT json_agg(version ORDER BY version) FROM azat_agent.migrations),
 'projectDigest',(SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM azat_agent.projects t),
 'runDigest',(SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM azat_agent.runs t),
 'eventDigest',(SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY id),'')) FROM azat_agent.events t),
 'migrationDigest',(SELECT md5(COALESCE(string_agg(md5(row_to_json(t)::text),'' ORDER BY version),'')) FROM azat_agent.migrations t));
COMMIT;"""


def utc_now():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def private_json(path, value):
    with open(path, "x", encoding="utf-8") as handle:
        os.chmod(path, 0o600)
        json.dump(value, handle, indent=2)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def within(path, root):
    return path == root or root in path.parents


def source_root(path):
    path = Path(path).absolute()
    if path.is_symlink() or not path.is_dir():
        raise BaselineError("A required source directory is missing or symlinked.")
    return path.resolve(strict=True)


def new_private_directory(path, sources=()):
    path = Path(path).absolute()
    parent = path.parent.resolve(strict=True)
    path = parent / path.name
    if path.exists() or path.is_symlink():
        raise BaselineError("The destination must be new; no existing data is overwritten.")
    if any(within(path, Path(item).resolve()) or within(Path(item).resolve(), path) for item in sources):
        raise BaselineError("The destination must be separate from every source.")
    path.mkdir(mode=0o700)
    return path


def safe_relative(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise BaselineError("The manifest contains an invalid relative path.")
    relative = PurePosixPath(value)
    if relative.is_absolute() or ".." in relative.parts or str(relative) != value:
        raise BaselineError("The manifest contains an unsafe relative path.")
    return value


def excluded(relative, exclusions):
    return any(relative == item or relative.startswith(item + "/") for item in exclusions)


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def inventory(root, exclusions=()):
    """No following symlinks. Socket/pipe/device files fail closed."""
    root = source_root(root)
    result = {}

    def visit(directory, prefix=""):
        before = directory.stat()
        for entry in sorted(os.scandir(directory), key=lambda item: item.name):
            relative = f"{prefix}/{entry.name}" if prefix else entry.name
            if excluded(relative, exclusions):
                continue
            safe_relative(relative)
            info = entry.stat(follow_symlinks=False)
            row = {"signature": signature(info), "originalMode": stat.S_IMODE(info.st_mode)}
            full = Path(entry.path)
            if stat.S_ISLNK(info.st_mode):
                target = os.readlink(full)
                if os.path.isabs(target):
                    raise BaselineError("Absolute symlinks are not portable recovery sources.")
                try:
                    resolved = full.resolve(strict=True)
                except (OSError, RuntimeError):
                    raise BaselineError("A recovery source has a broken or cyclic symlink.") from None
                if not within(resolved, root) or excluded(resolved.relative_to(root).as_posix(), exclusions):
                    raise BaselineError("A recovery source symlink escapes its captured tree.")
                row.update(type="symlink", target=target)
            elif stat.S_ISDIR(info.st_mode):
                row["type"] = "directory"
            elif stat.S_ISREG(info.st_mode):
                row["type"] = "file"
            else:
                raise BaselineError("A recovery source contains an unsupported special file.")
            result[relative] = row
            if row["type"] == "directory":
                visit(full, relative)
        if signature(before) != signature(directory.stat()):
            raise BaselineError("A recovery source directory changed during inspection.")

    visit(root)
    return result


def copy_tree(source, destination, exclusions=(), before=None, preserve_execute=False):
    source = source_root(source)
    before = inventory(source, exclusions) if before is None else before
    destination.mkdir(mode=0o700)
    output = {}
    for relative, item in before.items():
        original, target = source / relative, destination / relative
        if signature(original.lstat()) != item["signature"]:
            raise BaselineError("A recovery source changed before it was copied.")
        row = {key: value for key, value in item.items() if key != "signature"}
        if item["type"] == "directory":
            target.mkdir(mode=0o700)
        elif item["type"] == "symlink":
            os.symlink(item["target"], target)
            row["sha256"] = digest(os.fsencode(item["target"]))
        else:
            flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
            descriptor = os.open(original, flags)
            hasher = hashlib.sha256()
            try:
                if signature(os.fstat(descriptor)) != item["signature"]:
                    raise BaselineError("A recovery source changed while it was opened.")
                with open(target, "xb") as copied:
                    mode = 0o700 if preserve_execute and item["originalMode"] & 0o100 else 0o600
                    os.chmod(target, mode)
                    while chunk := os.read(descriptor, 1024 * 1024):
                        copied.write(chunk)
                        hasher.update(chunk)
                    copied.flush()
                    os.fsync(copied.fileno())
                if signature(os.fstat(descriptor)) != item["signature"]:
                    raise BaselineError("A recovery source changed while it was copied.")
            finally:
                os.close(descriptor)
            row.update(sha256=hasher.hexdigest(), bytes=item["signature"][3], capturedMode=mode)
        output[relative] = row
    if inventory(source, exclusions) != before:
        raise BaselineError("A recovery source changed during copying; checkpoint rejected.")
    return output


def command(arguments, *, environment=None, input_text=None, timeout=120):
    try:
        result = subprocess.run(arguments, input=input_text, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                env=environment, timeout=timeout, check=False)
    except (OSError, subprocess.TimeoutExpired):
        raise BaselineError("A required recovery command was unavailable or timed out.") from None
    if result.returncode:
        raise BaselineError("A required recovery command failed; private output was withheld.")
    return result.stdout


def assert_studio_absent(app_bundle):
    output = command(["/bin/ps", "-axo", "pid=,comm="], timeout=10)
    executable_root = str(Path(app_bundle).resolve()) + "/Contents/"
    for line in output.splitlines():
        fields = line.strip().split(None, 1)
        if len(fields) == 2 and fields[1].startswith(executable_root):
            raise BaselineError("Quit the installed Studio application before taking or verifying a checkpoint.")


def local_database_environment(state):
    """Only the dedicated local Unix socket; never a network URL or password."""
    try:
        settings = json.loads((state / "agent-runtime.json").read_text(encoding="utf-8"))
        parsed = urlsplit(settings["databaseUrl"])
        parameters = parse_qs(parsed.query, strict_parsing=True)
        if parsed.scheme not in ("postgres", "postgresql") or parsed.netloc or parsed.fragment:
            raise ValueError()
        if set(parameters) - {"host", "port", "user"} or any(len(value) != 1 for value in parameters.values()):
            raise ValueError()
        host = Path(parameters["host"][0])
        expected_host = (state / "agent-db/run").resolve(strict=True)
        if not host.is_absolute() or host.resolve(strict=True) != expected_host:
            raise ValueError()
        database, user = parsed.path.removeprefix("/"), parameters["user"][0]
        port = parameters.get("port", ["55433"])[0]
        if database != "azat_studio" or user != "azat_studio" or port != "55433":
            raise ValueError()
    except (KeyError, ValueError, TypeError, OSError, RuntimeError):
        raise BaselineError("The database reference must identify the expected dedicated local Studio socket.") from None
    return {
        "PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
        "PGHOST": str(expected_host), "PGPORT": port,
        "PGDATABASE": database, "PGUSER": user,
        "PGPASSFILE": "/dev/null", "PGCONNECT_TIMEOUT": "5",
        "PGOPTIONS": "-c default_transaction_read_only=on -c statement_timeout=5000 -c lock_timeout=1000",
    }


def database_json(binary, environment, sql):
    output = command([str(binary / "psql"), "-X", "-w", "-A", "-t", "-q",
                      "-v", "ON_ERROR_STOP=1"], environment=environment,
                     input_text=sql, timeout=15)
    try:
        value = json.loads(output.strip())
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except ValueError:
        raise BaselineError("The database inspection did not return the expected metadata.") from None


def assert_idle(status):
    if any(status.get(key) != 0 for key in ("queued", "running", "waitingApproval", "retainedApprovals", "uncertain", "activeLeases")):
        raise BaselineError("Pending, approved or uncertain agent work needs reconciliation before this checkpoint.")


def pg_binary(path):
    root = source_root(path)
    for name in ("psql", "pg_dump", "pg_restore", "initdb", "postgres", "pg_isready"):
        file = root / name
        if not file.is_file() or not os.access(file, os.X_OK):
            raise BaselineError("The complete expected PostgreSQL toolset is required.")
    return root


def snapshot(args):
    if sys.platform != "darwin":
        raise BaselineError("The live Studio checkpoint requires macOS.")
    os.umask(0o077)
    state, renderer, application = map(source_root, (args.state_dir, args.renderer_dir, args.app_bundle))
    binary = pg_binary(args.pg_bin)
    assert_studio_absent(application)
    environment = local_database_environment(state)
    initial_status = database_json(binary, environment, STATUS_SQL)
    assert_idle(initial_status)
    initial_counts = database_json(binary, environment, COUNTS_SQL)
    before = {"backend": inventory(state, EXCLUDED_BACKEND),
              "renderer": inventory(renderer), "application": inventory(application)}
    destination = new_private_directory(args.destination, (state, renderer, application))
    tree = {}
    for name, root, exclusions in (("backend", state, EXCLUDED_BACKEND),
                                    ("renderer", renderer, ()), ("application", application, ())):
        copied = copy_tree(root, destination / name, exclusions, before[name], preserve_execute=name == "application")
        tree[name] = {"type": "directory", "originalMode": stat.S_IMODE(root.stat().st_mode)}
        tree.update({f"{name}/{relative}": item for relative, item in copied.items()})
    dump = destination / "ledger.dump"
    command([str(binary / "pg_dump"), "-w", "--format=custom", "--no-owner", "--no-privileges",
             "--file", str(dump)], environment=environment, timeout=180)
    os.chmod(dump, 0o600)
    command([str(binary / "pg_restore"), "--list", str(dump)], timeout=30)
    tree["ledger.dump"] = {"type": "file", "bytes": dump.stat().st_size,
                            "sha256": digest(dump.read_bytes()), "originalMode": 0o600, "capturedMode": 0o600}
    final_status = database_json(binary, environment, STATUS_SQL)
    assert_idle(final_status)
    if initial_status != final_status or initial_counts != database_json(binary, environment, COUNTS_SQL):
        raise BaselineError("The ledger changed during checkpoint creation.")
    for name, root, exclusions in (("backend", state, EXCLUDED_BACKEND),
                                    ("renderer", renderer, ()), ("application", application, ())):
        if inventory(root, exclusions) != before[name]:
            raise BaselineError("A checkpoint source changed; partial data was retained but is not accepted.")
    assert_studio_absent(application)
    manifest = {
        "schemaVersion": SCHEMA, "capturedAt": utc_now(), "executionQuarantined": True,
        "sources": {"backend": str(state), "renderer": str(renderer), "application": str(application)},
        "excludedBackendSubtrees": sorted(EXCLUDED_BACKEND), "tree": tree,
        "historicalRecoveryArchives": "Excluded and left untouched; the complete current installed application is captured separately.",
        "postgresVersion": command([str(binary / "postgres"), "--version"], timeout=10).strip(),
        "databaseMetadata": initial_counts, "agentState": final_status,
        "keychain": "Not read or exported; opaque saved references retained for this same macOS account.",
        "attachments": "Memory-only attachment bytes are not recoverable from disk.",
        "scope": "Quiescent app/profile and logical ledger checkpoint; no application launch or live restore.",
        "permissions": "Private application snapshot retains owner execute bits; all other captured files are 0600. Quarantined restore files lose execute bits. Original modes are recorded.",
    }
    private_json(destination / "manifest.json", manifest)
    verify_tree(destination, manifest)
    return {"ok": True, "action": "snapshot", "files": sum(row["type"] == "file" for row in tree.values()),
            "checkpointDirectory": str(destination), "liveChanges": 0, "restoreRehearsed": False}


def load_manifest(root):
    manifest_file = root / "manifest.json"
    if manifest_file.is_symlink() or not manifest_file.is_file() or manifest_file.stat().st_size > 32_000_000:
        raise BaselineError("The checkpoint manifest is missing or invalid.")
    try:
        manifest = json.loads(manifest_file.read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != SCHEMA or manifest.get("executionQuarantined") is not True:
            raise ValueError()
        if not isinstance(manifest.get("tree"), dict) or not manifest["tree"]:
            raise ValueError()
        for relative, row in manifest["tree"].items():
            safe_relative(relative)
            if row.get("type") not in ("directory", "file", "symlink"):
                raise ValueError()
    except (ValueError, TypeError, AttributeError):
        raise BaselineError("The checkpoint manifest schema is invalid.") from None
    return manifest


def verify_tree(root, manifest, nonlaunchable=False):
    if stat.S_IMODE(root.stat().st_mode) & 0o077:
        raise BaselineError("Recovery directories must be private to this account.")
    expected, observed = manifest["tree"], inventory(root, {"manifest.json"})
    if set(observed) != set(expected):
        raise BaselineError("The checkpoint has missing or unexpected files.")
    for relative, row in expected.items():
        actual, file = observed[relative], root / relative
        if actual["type"] != row["type"]:
            raise BaselineError("A checkpoint entry has the wrong type.")
        if row["type"] == "file":
            mode = 0o600 if nonlaunchable else row.get("capturedMode", 0o600)
            if mode not in (0o600, 0o700) or actual["originalMode"] != mode or file.stat().st_size != row.get("bytes") or digest(file.read_bytes()) != row.get("sha256"):
                raise BaselineError("A checkpoint file failed permission or integrity verification.")
        elif row["type"] == "directory" and actual["originalMode"] != 0o700:
            raise BaselineError("A checkpoint directory has unsafe permissions.")
        elif row["type"] == "symlink" and (actual["target"] != row.get("target") or digest(os.fsencode(actual["target"])) != row.get("sha256")):
            raise BaselineError("A checkpoint symlink failed verification.")


def restore_database(binary, dump, destination, expected):
    """Start only a fresh local PostgreSQL child, restore data, stop it reliably."""
    cluster, socket = destination / "isolated-postgres", destination / "socket"
    socket.mkdir(mode=0o700)
    if len(str(socket)) > 85:
        raise BaselineError("Choose a shorter verification destination for the PostgreSQL Unix socket.")
    environment = {"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C",
                   "PGHOST": str(socket), "PGPORT": "55434", "PGDATABASE": "postgres",
                   "PGPASSFILE": "/dev/null", "PGCONNECT_TIMEOUT": "2"}
    command([str(binary / "initdb"), "-D", str(cluster), "--auth-local=trust", "--auth-host=reject",
             "--no-locale", "--encoding=UTF8"], environment=environment, timeout=45)
    log_file = destination / "postgres-restore.log"
    process = None
    try:
        with open(log_file, "xb") as log:
            os.chmod(log_file, 0o600)
            process = subprocess.Popen([str(binary / "postgres"), "-D", str(cluster),
                "-c", "listen_addresses=", "-c", f"unix_socket_directories={socket}",
                "-c", "unix_socket_permissions=0700", "-c", "port=55434",
                "-c", "logging_collector=off", "-c", "log_statement=none",
                "-c", "log_min_error_statement=panic", "-c", "log_parameter_max_length_on_error=0"],
                stdout=log, stderr=log, env=environment)
            deadline = time.monotonic() + 15
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise BaselineError("The isolated recovery database failed to start.")
                try:
                    command([str(binary / "pg_isready"), "-q"], environment=environment, timeout=2)
                    break
                except BaselineError:
                    time.sleep(0.1)
            else:
                raise BaselineError("The isolated recovery database did not become ready.")
            # This new cluster/database has no existing Studio connection or runtime.
            command([str(binary / "psql"), "-X", "-w", "-q", "-v", "ON_ERROR_STOP=1"],
                    environment=environment, input_text="CREATE DATABASE studio_recovery;", timeout=15)
            environment["PGDATABASE"] = "studio_recovery"
            command([str(binary / "pg_restore"), "-w", "--exit-on-error", "--no-owner", "--no-privileges",
                     "--dbname", "studio_recovery", str(dump)], environment=environment, timeout=180)
            environment["PGOPTIONS"] = "-c default_transaction_read_only=on -c statement_timeout=5000"
            actual = database_json(binary, environment, COUNTS_SQL)
            if actual != expected:
                raise BaselineError("The isolated restored ledger metadata differs from its checkpoint.")
            private_json(destination / "isolated-database.json", {
                "cluster": str(cluster), "socket": str(socket), "port": 55434,
                "database": "studio_recovery", "tcpListener": False,
                "running": False, "runtimeLaunched": False,
                "databaseUrl": "postgresql:///studio_recovery?" + urlencode({"host": str(socket), "port": "55434"}),
                "note": "Verification cluster is stopped. Never point installed Studio at this restored ledger.",
            })
            return actual
    finally:
        if process is not None and process.poll() is None:
            process.send_signal(signal.SIGINT)
            try:
                process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
        if process is not None and process.poll() is None:
            raise BaselineError("The isolated recovery database stop could not be confirmed.")


def verify(args):
    os.umask(0o077)
    root = source_root(args.snapshot)
    manifest = load_manifest(root)
    assert_studio_absent(manifest["sources"]["application"])
    verify_tree(root, manifest)
    binary = pg_binary(args.pg_bin)
    destination = new_private_directory(args.destination, (root,))
    private_json(destination / "DO-NOT-LAUNCH.json", {
        "executionQuarantined": True, "liveRestore": False,
        "reason": "Retained approvals and effects require fresh authority and reconciliation before any execution.",
    })
    restored = destination / "restored"
    copy_tree(root, restored, {"manifest.json"})
    # Keep the original manifest separately; all restored payload files stay 0600.
    private_json(restored / "manifest.json", manifest)
    verify_tree(restored, manifest, nonlaunchable=True)
    actual = restore_database(binary, restored / "ledger.dump", destination, manifest["databaseMetadata"])
    verify_tree(root, manifest)
    assert_studio_absent(manifest["sources"]["application"])
    private_json(destination / "verification.json", {
        "schemaVersion": SCHEMA, "verifiedAt": utc_now(), "passed": True,
        "checkpointManifestSha256": digest((root / "manifest.json").read_bytes()),
        "fileIntegrity": True, "databaseRestoreMetadata": actual,
        "isolatedDatabaseStopped": True, "applicationLaunched": False,
        "liveRestore": False, "providerRequests": 0,
        "limitations": ["No Keychain export or cross-account connector recovery tested.",
                       "No recovery of memory-only attachments.",
                       "No application execution, UI journey or effect replay acceptance performed."],
    })
    return {"ok": True, "action": "verify", "restoreRehearsed": True,
            "fileIntegrity": True, "isolatedDatabaseStopped": True,
            "applicationLaunched": False, "liveChanges": 0,
            "verificationDirectory": str(destination)}


def parser():
    argument_parser = argparse.ArgumentParser(description=__doc__)
    commands = argument_parser.add_subparsers(dest="action", required=True)
    capture = commands.add_parser("snapshot")
    capture.add_argument("--destination", required=True)
    capture.add_argument("--state-dir", default=str(Path.home() / ".mcp-agentic-editor"))
    capture.add_argument("--renderer-dir", default=str(Path.home() / "Library/Application Support/mcp-agentic-editor"))
    capture.add_argument("--app-bundle", default="/Applications/Azat Studio.app")
    capture.add_argument("--pg-bin", default="/opt/homebrew/opt/postgresql@18/bin")
    check = commands.add_parser("verify")
    check.add_argument("--snapshot", required=True)
    check.add_argument("--destination", required=True)
    check.add_argument("--pg-bin", default="/opt/homebrew/opt/postgresql@18/bin")
    return argument_parser


if __name__ == "__main__":
    try:
        arguments = parser().parse_args()
        print(json.dumps(snapshot(arguments) if arguments.action == "snapshot" else verify(arguments)))
    except BaselineError as error:
        print(json.dumps({"ok": False, "error": str(error)}), file=sys.stderr)
        sys.exit(1)
    except Exception:
        print(json.dumps({"ok": False, "error": "Recovery verification failed; private details were withheld. No live restore was attempted."}), file=sys.stderr)
        sys.exit(1)
