"""Build a clean PUBLIC checkout and publish static assets to gh-pages without custom Actions."""
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
REMOTE = 'https://github.com/JackATDalton/opentrons-protocol-builder.git'


def run(*args, cwd=ROOT, **kwargs):
    return subprocess.run(args, cwd=cwd, check=True, **kwargs)


def publish():
    origin = subprocess.check_output(['git', 'remote', 'get-url', 'origin'], cwd=ROOT, text=True).strip()
    if origin not in [REMOTE, 'git@github.com:JackATDalton/opentrons-protocol-builder.git']:
        raise ValueError('Run this only from the personal public checkout, never the private lab repo.')
    if subprocess.check_output(['git', 'status', '--porcelain'], cwd=ROOT, text=True).strip():
        raise ValueError('Commit or resolve public changes before publishing.')
    run('python3', 'scripts/check-public.py')
    run('npm', 'run', 'check')
    run('npm', 'run', 'build', env={**os.environ, 'BASE_PATH': '/opentrons-protocol-builder/'})
    spec = importlib.util.spec_from_file_location('public_check', ROOT / 'scripts/check-public.py')
    scanner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scanner)
    scanner.check(ROOT, [str(p.relative_to(ROOT)) for p in (ROOT / 'dist').rglob('*') if p.is_file()])
    with tempfile.TemporaryDirectory(prefix='opentrons-pages-') as folder:
        checkout = Path(folder) / 'pages'
        run('git', 'clone', '--single-branch', '--branch', 'gh-pages', REMOTE, str(checkout))
        for path in checkout.iterdir():
            if path.name == '.git':
                continue
            if path.is_dir() and not path.is_symlink():
                shutil.rmtree(path)
            else:
                path.unlink()
        shutil.copytree(ROOT / 'dist', checkout, dirs_exist_ok=True)
        (checkout / '.nojekyll').touch()
        run('git', 'add', '.', cwd=checkout)
        if subprocess.check_output(['git', 'status', '--porcelain'], cwd=checkout, text=True).strip():
            revision = subprocess.check_output(['git', 'rev-parse', '--short', 'HEAD'], cwd=ROOT, text=True).strip()
            run('git', 'commit', '-m', 'Deploy public source ' + revision, cwd=checkout)
            run('git', 'push', 'origin', 'gh-pages', cwd=checkout)
        else:
            print('Static build already matches gh-pages.')
    print('Pages branch published. Check https://jackatdalton.github.io/opentrons-protocol-builder/')


if __name__ == '__main__':
    publish()
