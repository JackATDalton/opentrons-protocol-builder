# Public edition and syncing

Public repository: https://github.com/JackATDalton/opentrons-protocol-builder

Hosted app: https://jackatdalton.github.io/opentrons-protocol-builder/

The private lab repository is the source of shared code. The public edition
has independent history: never merge or push private branches or tags into it.
Historical lab commits contain webhooks. The exporter copies an allowlist of
current source, removes webhook URLs, clears notification defaults, rewrites
public links, and enables deployment on pushes to public `main`. It also omits
one-off sample scripts and local parser checks. A credential/path scan runs
before export, in public CI and before deployment.

## Publish an update

From a clean, committed private lab checkout:

```bash
git pull --ff-only
npm ci
npm run check
npm run fixtures
# Set OPENTRONS_PYTHON if needed, then:
npm run simulate

# First sync on a new machine:
git clone https://github.com/JackATDalton/opentrons-protocol-builder.git /tmp/opentrons-public
# Later syncs: git -C /tmp/opentrons-public pull --ff-only
python3 scripts/export-public.py /tmp/opentrons-public

git -C /tmp/opentrons-public diff --stat
git -C /tmp/opentrons-public diff
cd /tmp/opentrons-public
npm ci
npm run check
npm run build
python3 scripts/check-public.py
git add .
git commit -m "Sync validated lab changes"
git push origin main
```

The exporter requires a clean public checkout with the expected personal
origin. It updates previously exported files, removes managed files deleted
upstream, and records the private source revision in `.public-export.json`.
It does not publish or push anything itself. Review the full diff: pattern
scanning cannot identify every confidential sample name or experimental result.
Only the public source snapshot is deployed; the private lab repo stays private.

Public contributions should arrive as pull requests. Port shared changes into
the private lab source, validate there, then export again. Keep public-only
configuration in the exporter rather than hand editing generated files, so
future syncs reproduce it. If public changes haven't been ported back, compare
the repositories before exporting; export deliberately replaces managed files.

## Slack notifications

The public app starts with no webhook. A user can enter their own incoming
webhook URL and optional Slack member ID. The URL stays in component memory
until reload; it is not stored in local storage or sent to an app server.
It is embedded in downloaded Python so the robot can post stage notifications.
Those downloaded protocols contain the user's credential and should be shared
accordingly. Blank webhook means no Slack network requests.

GitHub Pages is configured for Actions deployments. Pushes to public `main`
run checks, build the static app with the repository base path, and deploy it.
