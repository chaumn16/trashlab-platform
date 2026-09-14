# Built core releases

`npm run pack -w @trashlab/core` writes `trashlab-core-<version>.tgz` here.

This directory is a **build output staging area**, not the distribution channel.
The tarballs are gitignored. The canonical copy of a release is the GitHub
Release asset on this repo; the copy that actually runs is the one vendored into
each tenant repo at `vendor/`.

Core is never published to any registry — see docs/DEPLOY-PLATFORM.md.
