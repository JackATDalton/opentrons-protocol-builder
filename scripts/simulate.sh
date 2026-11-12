#!/usr/bin/env bash
# Run every emitted fixture through opentrons_simulate.
#
# This is the check that catches a generator emitting invalid Python —
# typechecking and unit tests cannot see inside a template literal.
#
# It does NOT check that a protocol is scientifically correct. Every rule in
# docs/protocol-invariants.md was broken by code that simulated cleanly.
set -uo pipefail

DIR="${1:-tests/fixtures}"
PY="${OPENTRONS_PYTHON:-python3}"

if ! "$PY" -c "import opentrons" 2>/dev/null; then
  echo "opentrons is not importable with '$PY'."
  echo "Set OPENTRONS_PYTHON to an interpreter that has it, e.g."
  echo "  OPENTRONS_PYTHON=/opt/homebrew/Caskroom/miniforge/base/envs/opentrons/bin/python3 npm run simulate"
  exit 1
fi

shopt -s nullglob
files=("$DIR"/*.py)
if [ ${#files[@]} -eq 0 ]; then
  echo "No fixtures in $DIR. Run 'npm run fixtures' first."
  exit 1
fi

fail=0
for f in "${files[@]}"; do
  printf '%-28s ' "$(basename "$f")"
  if out=$("$PY" -m opentrons.simulate "$f" --custom-labware-path ./labware/definitions 2>&1); then
    printf 'ok   %s commands\n' "$(printf '%s' "$out" | grep -c . || true)"
  else
    printf 'FAILED\n'
    printf '%s\n' "$out" | tail -25
    fail=1
  fi
done

if [ "$fail" -ne 0 ]; then
  echo
  echo "At least one protocol did not simulate."
  exit 1
fi

echo
echo "All ${#files[@]} protocols simulate. That means they will run, not that they are right —"
echo "read them against docs/protocol-invariants.md as well."
