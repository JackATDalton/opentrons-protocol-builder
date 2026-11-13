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


class PublicSeedTest(unittest.TestCase):
    """The lab's sample names never ship as the public app's defaults."""

    def test_real_views_export_with_position_names_only(self):
        for path, rewrite in exporter.PUBLIC_SEEDS.items():
            seed = exporter.SEED.search(exporter._seed((REPO / path).read_text(), path, rewrite)).group(1)
            names = [line.split(',')[0].strip() for line in seed.splitlines()[1:] if line.strip() and not line.startswith('#')]
            self.assertTrue(names, path)
            for name in names:
                self.assertRegex(name, r'^[A-H]\d{1,2}$', f'{path}: "{name}" is not a position')

    def test_tube_names_stay_unique_within_one_rack(self):
        seed = '# part\n' + '\n'.join(f'P{i}, 40, 50' for i in range(30)) + '\nC4J, 60, 3600, mastermix'
        names = [line.split(',')[0] for line in exporter.anonymise_tube_seed(seed).splitlines()[1:]]
        self.assertEqual(names, exporter.RACK_ORDER)
        self.assertNotIn('C4J', exporter.anonymise_tube_seed(seed))

    def test_plate_keeps_concentrations(self):
        out = exporter.anonymise_plate_seed('Location,Name\nA1,P1d\nA1,114')
        self.assertEqual(out, 'Location,Name\nA1,A1\nA1,114')

    def test_missing_seed_stops_the_export(self):
        with self.assertRaisesRegex(ValueError, 'no SEED'):
            exporter._seed('const OTHER = 1;', 'view.tsx', exporter.anonymise_tube_seed)

    def test_example_sheets_ship_as_headers_only(self):
        out = exporter.headers_only((REPO / 'src/ui/examples.ts').read_text())
        contents = exporter.EXAMPLE.findall(out)
        self.assertGreater(len(contents), 3)
        for content in contents:
            self.assertEqual(content.count('\n'), 1, content)
            self.assertIn(',', content)

    def test_missing_examples_stop_the_export(self):
        with self.assertRaisesRegex(ValueError, 'no example CSVs'):
            exporter.headers_only('export const X = 1;')
