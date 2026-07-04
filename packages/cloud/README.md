# @conduit/cloud (private)

This directory is the mount point for Conduit's **cloud edition** — the
SaaS-only components (multi-tenant org isolation, billing & metering, public
signup, marketing site). It is a **private git submodule** and is not part of
the public, FSL-licensed repository.

The community build does not include this module and has no import path into it
(enforced by the dependency-boundary lint in CI). See
[docs/CLOUD_SUBMODULE.md](../../docs/CLOUD_SUBMODULE.md) for setup.
