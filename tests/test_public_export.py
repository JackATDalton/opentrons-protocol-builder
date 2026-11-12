"""Exercise sanitisation before any real public push."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('export_public', REPO / 'scripts/export-public.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class PublicExportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.source = Path(self.tmp.name) / 'private'
        self.dest = Path(self.tmp.name) / 'public'
        self.source.mkdir()
        self.original = exporter.ROOT
        exporter.ROOT = self.source
        self.addCleanup(setattr, exporter, 'ROOT', self.original)
        for path in ['.github/workflows/ci.yml', '.github/workflows/deploy.yml', 'scripts/check-public.py']:
            file = self.source / path
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes((REPO / path).read_bytes())
        (self.source / 'src/config').mkdir(parents=True)
        hook = 'https://hooks.slack.com/' + 'services/T000/B000/EXAMPLE'
        (self.source / 'src/config/lab.ts').write_text('import type { NotifyConfig } from "../core/emit";\nexport const LAB_SLACK_WEBHOOK_URL = "' + hook + '";\n')
        (self.source / '.gitignore').write_text('__pycache__/\n')
        (self.source / 'README.md').write_text('# App\nHello\n')
        self.git(self.source, 'init', '-b', 'main')
        self.commit(self.source)

    def git(self, cwd, *args):
        return subprocess.check_output(['git', *args], cwd=cwd, stderr=subprocess.DEVNULL, text=True)

    def commit(self, cwd):
        self.git(cwd, 'add', '.')
        self.git(cwd, '-c', 'user.name=Test', '-c', 'user.email=test@example.org', 'commit', '-m', 'test')

    def test_strips_credentials_and_enables_pages_without_history(self):
        exporter.export(self.dest)
        self.assertNotIn('services/', (self.dest / 'src/config/lab.ts').read_text())
        self.assertIn('branches: [main]', (self.dest / '.github/workflows/deploy.yml').read_text())
        self.assertFalse((self.dest / '.git').exists())
        self.assertIn('sourceRevision', json.loads((self.dest / exporter.MANIFEST).read_text()))

    def test_unknown_credentials_abort_before_writing(self):
        (self.source / 'src/secret.ts').write_text('const key = "' + 'sk-' + 'a' * 25 + '";')
        self.commit(self.source)
        with self.assertRaisesRegex(ValueError, 'credential'):
            exporter.export(self.dest)
        self.assertFalse(self.dest.exists())

    def test_requires_committed_source_and_clean_expected_public_checkout(self):
        (self.source / 'README.md').write_text('dirty')
        with self.assertRaisesRegex(ValueError, 'Commit private'):
            exporter.export(self.dest)
        self.commit(self.source)
        exporter.export(self.dest)
        self.git(self.dest, 'init', '-b', 'main')
        self.git(self.dest, 'remote', 'add', 'origin', 'https://github.com/' + exporter.PUBLIC + '.git')
        self.commit(self.dest)
        (self.dest / 'README.md').write_text('public work')
        with self.assertRaisesRegex(ValueError, 'local changes'):
            exporter.export(self.dest)

    def test_removes_previously_managed_files_deleted_upstream(self):
        exporter.export(self.dest)
        self.git(self.dest, 'init', '-b', 'main')
        self.git(self.dest, 'remote', 'add', 'origin', 'https://github.com/' + exporter.PUBLIC + '.git')
        self.commit(self.dest)
        (self.source / 'src/config/lab.ts').unlink()
        self.commit(self.source)
        exporter.export(self.dest)
        self.assertFalse((self.dest / 'src/config/lab.ts').exists())
