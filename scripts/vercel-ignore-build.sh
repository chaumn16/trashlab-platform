#!/bin/sh
# Vercel "Ignored Build Step" — decides whether a push is worth building.
#
#   Ignored Build Step:  sh scripts/vercel-ignore-build.sh apps/control-plane registry
#
# Vercel's contract is inverted from intuition:
#   exit 0 → SKIP the build
#   exit 1 → BUILD
#
# Two things the obvious one-liner gets wrong:
#
#   1. Vercel clones at depth 1, so HEAD^ usually does not exist. A bare
#      `git diff --quiet HEAD^ HEAD` fails with "fatal: bad revision 'HEAD^'"
#      and exits 128 — outside the 0/1 contract entirely.
#   2. Vercel runs this through `/bin/sh -c` as a SINGLE line, so a multi-line
#      if/then pasted into the settings box becomes a syntax error. Keeping the
#      logic in this file avoids that problem entirely.
#
# When in doubt this BUILDS. An unnecessary build costs a few minutes; a
# wrongly skipped one means the deployment someone expected never happened.

set -eu

if [ "$#" -eq 0 ]; then
  echo "usage: $0 <path> [path...]" >&2
  exit 1   # build — a misconfigured filter must not silently skip
fi

# Fetch the one extra commit the comparison needs. Failure is fine; the guard
# below catches it.
git fetch --deepen=1 --quiet 2>/dev/null || true

if ! git rev-parse --verify --quiet HEAD^ >/dev/null 2>&1; then
  echo "No parent commit available (shallow clone) — building."
  exit 1
fi

if git diff --quiet HEAD^ HEAD -- "$@"; then
  echo "No changes under: $* — skipping build."
  exit 0
fi

echo "Changes under: $* — building."
exit 1
