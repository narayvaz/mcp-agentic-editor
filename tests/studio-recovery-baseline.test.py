"""Synthetic filesystem fixtures only; no Studio, database, or private profile access."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[1] / 'scripts/studio-recovery-baseline.py'
SPEC = importlib.util.spec_from_file_location('studio_recovery_baseline', MODULE_PATH)
recovery = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery)


class RecoveryFixtureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'source'
        self.source.mkdir(mode=0o700)
        (self.source / 'nested').mkdir(mode=0o700)
        (self.source / 'nested/payload.txt').write_text('synthetic Armenian Հայերեն fixture')

    def test_copy_preserves_bytes_but_removes_execute_and_other_account_access(self):
        os.chmod(self.source / 'nested/payload.txt', 0o755)
        copied = self.root / 'copied'
        tree = recovery.copy_tree(self.source, copied)
        self.assertEqual((copied / 'nested/payload.txt').read_bytes(), (self.source / 'nested/payload.txt').read_bytes())
        self.assertEqual((copied / 'nested/payload.txt').stat().st_mode & 0o777, 0o600)
        self.assertEqual((copied / 'nested').stat().st_mode & 0o777, 0o700)
        self.assertEqual(tree['nested/payload.txt']['originalMode'], 0o755)

    def test_safe_internal_relative_symlink_is_retained(self):
        (self.source / 'alias').symlink_to('nested/payload.txt')
        copied = self.root / 'copied'
        tree = recovery.copy_tree(self.source, copied)
        self.assertEqual(os.readlink(copied / 'alias'), 'nested/payload.txt')
        self.assertEqual(tree['alias']['type'], 'symlink')

    def test_primary_application_can_retain_owner_execute_permission(self):
        os.chmod(self.source / 'nested/payload.txt', 0o755)
        copied = self.root / 'copied'
        tree = recovery.copy_tree(self.source, copied, preserve_execute=True)
        self.assertEqual((copied / 'nested/payload.txt').stat().st_mode & 0o777, 0o700)
        recovery.verify_tree(copied, {'tree': tree})
        restored = self.root / 'restored'
        recovery.copy_tree(copied, restored)
        recovery.verify_tree(restored, {'tree': tree}, nonlaunchable=True)

    def test_escape_absolute_and_broken_symlinks_are_rejected(self):
        outside = self.root / 'outside'
        outside.write_text('fixture')
        for target in ('../outside', str(outside), 'missing'):
            with self.subTest(target=target):
                (self.source / 'alias').symlink_to(target)
                with self.assertRaises(recovery.BaselineError):
                    recovery.inventory(self.source)
                (self.source / 'alias').unlink()

    def test_special_files_are_rejected(self):
        os.mkfifo(self.source / 'pipe')
        with self.assertRaises(recovery.BaselineError):
            recovery.inventory(self.source)

    def test_raw_database_subtree_is_excluded(self):
        (self.source / 'agent-db/data').mkdir(parents=True)
        os.mkfifo(self.source / 'agent-db/data/uncopyable')
        tree = recovery.copy_tree(self.source, self.root / 'copied', recovery.EXCLUDED_BACKEND)
        self.assertIn('agent-db', tree)
        self.assertNotIn('agent-db/data', tree)

    def test_changed_source_is_rejected_before_copy(self):
        before = recovery.inventory(self.source)
        (self.source / 'nested/payload.txt').write_text('changed fixture')
        with self.assertRaises(recovery.BaselineError):
            recovery.copy_tree(self.source, self.root / 'copied', before=before)

    def test_old_incomplete_release_archive_is_excluded_without_following_links(self):
        archive = self.source / 'release-controller/recovery/old-incomplete'
        archive.mkdir(parents=True)
        (archive / 'retired').symlink_to('/missing-retired-checkout')
        (self.source / 'release-controller/current.json').write_text('{"fixture":true}')
        tree = recovery.copy_tree(self.source, self.root / 'copied', recovery.EXCLUDED_BACKEND)
        self.assertIn('release-controller/current.json', tree)
        self.assertNotIn('release-controller/recovery', tree)
        self.assertTrue((archive / 'retired').is_symlink())

    def test_destination_cannot_overlap_or_overwrite(self):
        with self.assertRaises(recovery.BaselineError):
            recovery.new_private_directory(self.source / 'inside', (self.source,))
        with self.assertRaises(recovery.BaselineError):
            recovery.new_private_directory(self.source, ())

    def test_manifest_verification_detects_tampering_and_extra_files(self):
        copied = self.root / 'copied'
        manifest = {'tree': recovery.copy_tree(self.source, copied)}
        recovery.verify_tree(copied, manifest)
        (copied / 'extra').write_text('unlisted')
        os.chmod(copied / 'extra', 0o600)
        with self.assertRaises(recovery.BaselineError):
            recovery.verify_tree(copied, manifest)
        (copied / 'extra').unlink()
        (copied / 'nested/payload.txt').write_text('changed')
        with self.assertRaises(recovery.BaselineError):
            recovery.verify_tree(copied, manifest)

    def test_manifest_paths_reject_traversal_and_aliases(self):
        for value in ('../escape', '/absolute', 'a/../b', 'a//b', './a', 'a\\b', ''):
            with self.subTest(value=value), self.assertRaises(recovery.BaselineError):
                recovery.safe_relative(value)

    def test_expected_local_socket_url_becomes_environment_only(self):
        (self.source / 'agent-db/run').mkdir(parents=True)
        from urllib.parse import urlencode
        url = 'postgresql:///azat_studio?' + urlencode({'host': str(self.source / 'agent-db/run'), 'port': '55433', 'user': 'azat_studio'})
        (self.source / 'agent-runtime.json').write_text(json.dumps({'databaseUrl': url}))
        env = recovery.local_database_environment(self.source)
        self.assertEqual(env['PGDATABASE'], 'azat_studio')
        self.assertEqual(env['PGHOST'], str((self.source / 'agent-db/run').resolve()))
        self.assertNotIn('PGPASSWORD', env)

    def test_network_credentials_other_socket_and_extra_query_are_rejected(self):
        (self.source / 'agent-db/run').mkdir(parents=True)
        urls = [
            'postgresql://user:private@127.0.0.1/azat_studio',
            'postgresql:///azat_studio?host=/tmp&port=55433&user=azat_studio',
            'postgresql:///azat_studio?host=/tmp&port=55433&user=azat_studio&options=unsafe',
        ]
        for url in urls:
            with self.subTest(url=url):
                (self.source / 'agent-runtime.json').write_text(json.dumps({'databaseUrl': url}))
                with self.assertRaises(recovery.BaselineError):
                    recovery.local_database_environment(self.source)

    def test_process_guard_fails_closed_and_does_not_print_process_arguments(self):
        with patch.object(recovery, 'command', return_value='123 /Applications/Azat Studio.app/Contents/MacOS/Azat Studio\n'):
            with self.assertRaises(recovery.BaselineError):
                recovery.assert_studio_absent('/Applications/Azat Studio.app')
        with patch.object(recovery, 'command', side_effect=recovery.BaselineError('guard unavailable')):
            with self.assertRaises(recovery.BaselineError):
                recovery.assert_studio_absent('/Applications/Azat Studio.app')

    def test_approved_or_uncertain_work_refuses_snapshot(self):
        idle = dict.fromkeys(('queued', 'running', 'waitingApproval', 'retainedApprovals', 'uncertain', 'activeLeases'), 0)
        recovery.assert_idle(idle)
        for key in idle:
            with self.subTest(key=key), self.assertRaises(recovery.BaselineError):
                recovery.assert_idle({**idle, key: 1})


if __name__ == '__main__':
    unittest.main()
