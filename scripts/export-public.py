"""Sanitise a snapshot into a separate public checkout. Never export Git history."""
import argparse
import json
import re
import subprocess
from pathlib import Path

from importlib.util import spec_from_file_location, module_from_spec

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = 'JackATDalton/opentrons-protocol-builder'
MANIFEST = '.public-export.json'
TOP = {'AGENTS.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md',
       'package.json', 'package-lock.json', 'index.html', '.gitignore',
       'tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', 'vite.config.ts'}
PREFIXES = ('src/', 'tests/', 'docs/', 'labware/', 'protocols/reference/')
SCRIPTS = {'scripts/new-protocol.ts', 'scripts/write-fixtures.ts', 'scripts/simulate.sh',
           'scripts/check-public.py', 'scripts/export-public.py', 'scripts/publish-pages.py'}
HOOK = re.compile(r'https://hooks[.]slack[.]com/services/[^\s"\'<>]+')


SEED = re.compile(r'const SEED = `([^`]*)`;')
RACK_ORDER = [f'{row}{col}' for col in range(1, 7) for row in 'ABCD']  # column-major, as the rack fills


def _seed(text, path, rewrite):
    """Rewrite a view's SEED sample list; fail loudly if the view no longer has one."""
    match = SEED.search(text)
    if not match:
        raise ValueError(f'{path}: no SEED sample list found; update the exporter before publishing.')
    return text[:match.start(1)] + rewrite(match.group(1)) + text[match.end(1):]


def anonymise_tube_seed(seed):
    """Lab part names -> rack positions. Up to one rack, so names stay unique; master-mix rows dropped."""
    header = [line for line in seed.splitlines() if line.startswith('#')]
    rows = [line for line in seed.splitlines() if line.strip() and not line.startswith('#')]
    rows = [r for r in rows if 'mastermix' not in r.lower()][:len(RACK_ORDER)]
    renamed = [', '.join([RACK_ORDER[i], *[c.strip() for c in r.split(',')[1:3]]]) for i, r in enumerate(rows)]
    return '\n'.join(header + renamed)


def anonymise_plate_seed(seed):
    """Lab part names in the name block -> the well's own name; concentrations kept."""
    out = []
    for i, line in enumerate(seed.splitlines()):
        well, _, value = line.partition(',')
        is_name = i > 0 and value.strip() and not re.fullmatch(r'[-+]?\d*\.?\d+', value.strip())
        out.append(f'{well},{well.strip()}' if is_name else line)
    return '\n'.join(out)


EXAMPLE = re.compile(r'content: `([^`]*)`')


def headers_only(text, path='src/ui/examples.ts'):
    """Each downloadable example CSV keeps its header row and nothing else."""
    if not EXAMPLE.search(text):
        raise ValueError(f'{path}: no example CSVs found; update the exporter before publishing.')
    return EXAMPLE.sub(lambda m: 'content: `' + m.group(1).split('\n', 1)[0] + '\n`', text)


PUBLIC_SEEDS = {
    'src/ui/views/TubeNormalisationView.tsx': anonymise_tube_seed,
    'src/ui/views/PlateNormalisationView.tsx': anonymise_plate_seed,
}


def git(*args, cwd=None):
    return subprocess.check_output(['git', *args], cwd=cwd or ROOT, text=True).strip()


def export(destination):
    if git("status", "--porcelain"):
        raise ValueError("Commit private source changes before exporting a release.")
    destination = destination.resolve()
    if destination == ROOT or ROOT in destination.parents:
        raise ValueError('Export must be outside the private repository.')
    manifest_path = destination / MANIFEST
    if destination.exists() and any(destination.iterdir()):
        if not (destination / '.git').is_dir() or not manifest_path.is_file():
            raise ValueError('Existing destination must be a public checkout with an export manifest.')
        remote = git('remote', 'get-url', 'origin', cwd=destination)
        if remote not in [f'https://github.com/{PUBLIC}.git', f'git@github.com:{PUBLIC}.git']:
            raise ValueError('Destination origin is not the expected personal public repository.')
        if git('status', '--porcelain', cwd=destination):
            raise ValueError('Public checkout has local changes. Commit or resolve them before syncing.')
    tracked = git('ls-files', '-z').split('\0')
    files = {}
    for path in tracked:
        if not path or not (path in TOP or path in SCRIPTS or path.startswith(PREFIXES)):
            continue
        source = ROOT / path
        if not source.is_file() or source.is_symlink():
            continue
        data = source.read_bytes()
        try:
            text = data.decode()
        except UnicodeDecodeError:
            files[path] = data
            continue
        text = HOOK.sub('', text)
        text = text.replace('https://github.com/JackATDalton/opentrons-protocol-builder', f'https://github.com/{PUBLIC}')
        if path == 'src/ui/examples.ts':
            # Templates only: the lab's example rows stay private.
            text = headers_only(text, path)
        if path in PUBLIC_SEEDS:
            # The lab's own parts and readings stay private; the public app
            # opens with the same example numbers, named by position.
            text = _seed(text, path, PUBLIC_SEEDS[path])
        if path == 'src/config/lab.ts':
            start = text.index('import type')
            text = '/** Public defaults: notifications are opt-in and configured in the app. */\n' + text[start:]
        if path in {'AGENTS.md', 'CLAUDE.md'}:
            start = text.find('- The lab Slack webhook is in')
            if start >= 0:
                text = text[:start] + '- Never commit webhooks or other credentials. Configure Slack in the app.\n'
        if path == '.gitignore':
            text = re.sub(r'# Never commit credentials[\s\S]*?config.local.json', '# Never commit credentials.\nconfig.local.json', text)
        files[path] = text.encode()
    for path in ['.github/workflows/ci.yml', '.github/workflows/deploy.yml']:
        text = (ROOT / path).read_text()
        if path.endswith('ci.yml'):
            start = text.index('      # A protocol') if '      # A protocol' in text else text.index('      - name: Scan public')
            end = text.index('      - uses: actions/setup-node', start)
            text = text[:start] + '      - name: Scan public source for credentials\n        run: python3 scripts/check-public.py\n\n' + text[end:]
        else:
            start = text.index('# GitHub Pages') if '# GitHub Pages' in text else text.index('on:')
            end = text.index('permissions:')
            text = text[:start] + 'on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\n' + text[end:]
            text = text.replace('      - run: npm run build', '      - run: python3 scripts/check-public.py\n      - run: npm run check\n      - run: npm run build')
        files[path] = text.encode()
    files['README.md'] = (f'# Opentrons Protocols\n\n[Open the web app](https://jackatdalton.github.io/opentrons-protocol-builder/) · [Source](https://github.com/{PUBLIC})\n\n'
        'Public edition: no Slack credentials are bundled. Configure your own optional webhook in the app.\n'
        'It stays in the current tab and is embedded in downloaded protocols; treat those files as private when notifications are enabled.\n\n'
        'Lab hardware and pipetting settings are examples derived from the Steel Lab Flex. Select and verify the deck and labware for your robot.\n\n'
        + files['README.md'].decode().partition('\n')[2]).encode()
    files[MANIFEST] = (json.dumps({'sourceRevision': git('rev-parse', 'HEAD'), 'files': sorted(files)}, indent=2) + '\n').encode()
    # Check the complete candidate in isolation BEFORE touching a public checkout.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='public-export-check-') as staging:
        stage = Path(staging)
        for path, data in files.items():
            (stage / path).parent.mkdir(parents=True, exist_ok=True)
            (stage / path).write_bytes(data)
        spec = spec_from_file_location('public_check', ROOT / 'scripts/check-public.py')
        module = module_from_spec(spec)
        spec.loader.exec_module(module)
        module.check(stage, list(files))
    previous = json.loads(manifest_path.read_text())['files'] if manifest_path.exists() else []
    destination.mkdir(parents=True, exist_ok=True)
    for path in previous:
        if path not in files:
            target = (destination / path).resolve()
            if destination not in target.parents:
                raise ValueError('Unsafe path in previous manifest.')
            target.unlink(missing_ok=True)
    for path, data in files.items():
        target = destination / path
        if target.is_symlink() or any(parent.is_symlink() for parent in target.parents if parent != destination.parent):
            raise ValueError('Symlinks are not allowed in the public checkout.')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f'Exported {len(files)} sanitised files to {destination}. No Git history copied.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('destination', type=Path)
    args = parser.parse_args()
    try:
        export(args.destination)
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')
