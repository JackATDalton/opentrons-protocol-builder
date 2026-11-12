"""Fail closed on credential shapes and machine-specific paths; never print matches."""
import re
import subprocess
from pathlib import Path

PATTERNS = [
    re.compile(r'https://hooks[.]slack[.]com/services/[A-Za-z0-9/_-]+'),
    re.compile(r'xox[baprs]-[0-9A-Za-z-]{10,}'),
    re.compile(r'sk-[A-Za-z0-9]{20,}'),
    re.compile(r'AKIA[0-9A-Z]{16}'),
    re.compile(r'-----BEGIN [A-Z ]*PRIVATE KEY-----'),
    re.compile(r'/Users/[A-Za-z0-9_-]+/'),
]


def check(root, paths):
    failures = []
    for path in paths:
        file = root / path
        if file.is_symlink():
            failures.append(path)
            continue
        if not file.is_file():
            continue
        try:
            content = file.read_text()
        except UnicodeDecodeError:
            continue
        if any(pattern.search(content) for pattern in PATTERNS):
            failures.append(path)
    if failures:
        raise ValueError('Public export contains credential or local-path patterns in: ' + ', '.join(failures))


if __name__ == '__main__':
    root = Path.cwd()
    paths = subprocess.check_output(['git', 'ls-files', '-z'], cwd=root).decode().split('\0')
    check(root, [p for p in paths if p])
    print('Public credential/path scan passed.')
