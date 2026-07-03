# Cloud submodule

The cloud edition lives in a private repository mounted at `packages/cloud`.

## Maintainer: attach the private repo (one time)

```bash
git submodule add git@github.com:jimseiwert/conduit-cloud.git packages/cloud
git commit -m "chore: wire packages/cloud private submodule"
```

This writes a `.gitmodules` entry and a gitlink. The public repo stores only
the reference, not the contents.

## Building the cloud edition

```bash
git submodule update --init packages/cloud
EDITION=cloud bun run build
```

## Community build (default)

Do nothing. With the submodule uninitialized, `packages/cloud` is empty and the
community build ignores it. `EDITION` is unset, so it resolves to `community`.

## Boundary rule

Core packages must never import from `packages/cloud`. CI enforces this via
`dependency-cruiser` (see `.dependency-cruiser.cjs`). `cloud` may import from
core packages.
