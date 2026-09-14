#!/bin/sh
# Vercel "Ignored Build Step" — decides whether a push is worth building.
#
# Set Project Settings → Git → Ignored Build Step to (one line):
#
#   sh "$(git rev-parse --show-toplevel)/scripts/vercel-ignore-build.sh" apps/control-plane registry
#
# Paths are given RELATIVE TO THE REPOSITORY ROOT, whatever the project's
# Root Directory is.
#
# Vercel's contract is inverted from intuition:
#   exit 0 → SKIP the build
#   exit 1 → BUILD
#
# Three things the obvious one-liner gets wrong, each verified against a real
# Vercel build rather than assumed:
#
#   1. Vercel runs this from the project's ROOT DIRECTORY, not the repo root.
#      Git pathspecs are cwd-relative, so `git diff -- apps/control-plane` run
#      from inside apps/control-plane matches nothing, reports "no changes", and
#      SILENTLY SKIPS EVERY DEPLOYMENT. This script cds to the repo root first.
#   2. Vercel clones at depth 1, so HEAD^ usually does not exist. A bare
#      `git diff HEAD^ HEAD` fails with "fatal: bad revision 'HEAD^'" and exits
#      128 — outside the 0/1 contract entirely.
#   3. Vercel runs the step through `/bin/sh -c` as a SINGLE line, so a
#      multi-line if/then pasted into the settings box is a syntax error.
#      Keeping the logic in a file avoids that.
#
# When in doubt this BUILDS. An unnecessary build costs minutes; a wrongly
# skipped one means the deployment someone expected never happened, with no
# error anywhere to explain it.

set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <path> [path...]   (paths relative to the repo root)" >&2
  exit 1   # build — a misconfigured filter must never silently skip
fi

ROOT=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "Not a git repository — building."
  exit 1
}
cd "$ROOT" || { echo "Cannot enter repo root — building."; exit 1; }

# Fetch the one extra commit the comparison needs. Failure is fine; the guard
# below catches it.
git fetch --deepen=1 --quiet 2>/dev/null || true

if ! git rev-parse --verify --quiet HEAD^ >/dev/null 2>&1; then
  echo "No parent commit available (shallow clone) — building."
  exit 1
fi

# Guard against a typo'd path silently meaning "nothing changed" forever.
for p in "$@"; do
  if [ ! -e "$p" ]; then
    echo "Watched path '$p' does not exist at the repo root — building."
    echo "  (paths are relative to $ROOT)"
    exit 1
  fi
done

if git diff --quiet HEAD^ HEAD -- "$@"; then
  echo "No changes under: $* — skipping build."
  exit 0
fi

echo "Changes under: $* — building."
exit 1
