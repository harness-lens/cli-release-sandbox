> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# Empty immutable CLI releases on 2026-09-07

## Summary

CLI release versions `v0.0.3` and `v0.0.4` were consumed through release
operations that did not follow the native workflow's publication contract.
Release `v0.0.4` was published as an immutable release with zero assets. Its
native assets were built successfully afterward but cannot be attached to the
published release.

No deterministic CLI analysis behavior changed. The impact is distribution:
`v0.0.4` has release notes and source archives but no supported native download
assets, and the version cannot be repaired or reused.

## Evidence and timeline

All timestamps are UTC on 2026-09-07.

| Time | Event | Evidence and result |
| --- | --- | --- |
| 01:46 | VS Code release setting inspected | `enabled=false`, `enforced_by_owner=false`; its mutable releases could accept later assets. |
| 07:29 | CLI release setting inspected | `enabled=false`, `enforced_by_owner=false`. |
| 07:41 | CLI immutability enabled | Repository API returned `enabled=true`, `enforced_by_owner=false`; this was a repository setting, not organization enforcement. |
| 21:19 | Release tag `0.0.3` published | npm rejected the noncanonical tag because the workflow requires `v<package-version>`. |
| 21:23 | Release tag `v0.0.3` published at `bd9d082cd466bea1c40b8c560c8539c8289a6e8e` | Native and npm version checks rejected it because source still declared `0.0.2`; no native assets were built. |
| 21:35 | CLI PR #26 merged as `f569915e3332496e12fe76c402b8750e7166ddc8` | Source was prepared as `0.0.3` after that immutable version name had been consumed. |
| 21:56 | CLI PR #27 merged as `132745b73238e8adafa37b8ef3d0042c0b88063d` | Source and lockfiles were prepared as `0.0.4`; required CI and CodeQL passed. |
| 22:00:22 | `v0.0.4` release published | GitHub recorded `immutable=true` and an empty asset list. Publishing created the tag at the merged commit. |
| 22:00:24 | Native workflow run `34165128712` started from the tag push | Tag-push mode deliberately sets `publish=false`, so this was a dry run. |
| 22:00:24 | npm workflow run `34165128334` started from the release event | Version validation passed; `npm ci` failed because the lockfile referenced a local Core tarball unavailable in a standalone checkout. |
| 22:02:48 | Native release bundle assembled | `harness-lens-v0.0.4-release` was retained as an Actions artifact with four native targets and generated distribution packages. |
| 22:02:52 | Native workflow completed | The protected GitHub release, Homebrew, and GHCR publication jobs were skipped because `publish=false`. |

Primary public records:

- release: <https://github.com/harness-lens/cli/releases/tag/v0.0.4>
- native run: <https://github.com/harness-lens/cli/actions/runs/34165128712>
- npm run: <https://github.com/harness-lens/cli/actions/runs/34165128334>
- release preparation: <https://github.com/harness-lens/cli/pull/27>

## Causal chain

1. CLI release immutability was intentionally enabled as a native distribution
   safety control.
2. The native workflow expected an existing tag to produce a dry-run candidate,
   followed by a workflow dispatch with `publish=true` that created a draft,
   uploaded assets, and published it.
3. The GitHub release was instead published outside that protected publication
   job. Public metadata establishes the actor and event but cannot distinguish
   whether the web UI, GitHub CLI, or direct API was used.
4. Publishing the release created the tag and immediately froze the empty asset
   set. GitHub cannot infer repository-specific expected assets and correctly
   treats publication as the declaration that a release is complete.
5. The resulting tag-push run built a candidate but deliberately did not
   publish it. By completion, the release had already been immutable for more
   than two minutes.

Release immutability behaved as designed. The failure was the mismatch between
the operational entry point and the workflow state machine, combined with
insufficient controls against the wrong entry point.

## Contributing conditions

- The GitHub Releases UI remained capable of initiating a stable release even
  though the supported path was a protected workflow.
- Tag-push dry-run behavior is counterintuitive to operators accustomed to
  workflows that attach assets after a release event.
- The VS Code repository used the opposite lifecycle: immutability was disabled
  and its workflow attached assets after publication. Prior success there made
  the same sequence appear reusable for the CLI.
- The dry run and publication dispatch rebuilt artifacts in separate runs
  instead of promoting the exact reviewed bytes.
- No machine-readable expected-asset manifest guarded the transition from draft
  to published.
- The protected environment guarded only the workflow job; it did not guard a
  release created outside the workflow.
- Standard CI and npm publication used different dependency setup paths, so CI
  did not detect the standalone `npm ci` failure.

## Recovery decision

Do not delete, rewrite, reuse, or attempt to add assets to `v0.0.4`. Preserve
the release and successful dry-run artifact as incident evidence. Prepare a new
version only after the corrective release workflow, tests, repository controls,
and sandbox rehearsal satisfy the [release runbook](../release-runbook.md). The
sole exception is the bounded
[`v0.0.5` supervised production acceptance](../releases/v0.0.5-preflight.md).

## Corrective actions

- [x] Replace the tag-push plus rebuilding publication model with one run that
  builds once, pauses for review, and promotes the exact retained bytes.
- [x] Make protected workflow dispatch the sole supported production entry.
- [x] Protect stable tags and restrict bypass to the release automation identity.
- [x] Grant `contents: write` only to the protected publisher job.
- [x] Convert independent release-event publication into explicitly ordered
  reusable jobs under the release orchestrator.
- [x] Generate and verify `RELEASE-MANIFEST.json` before publication.
- [x] Add idempotent draft recovery and fail-closed conflict handling.
- [x] Make clean standalone `npm ci` part of required CI.
- [x] Add workflow structure and release-state tests.
- [ ] Complete an immutable sandbox rehearsal before another production version.
  The maintainer authorized the narrowly bounded
  [`v0.0.5` supervised production acceptance](../releases/v0.0.5-preflight.md)
  without marking this corrective action complete. No later version inherits the
  exception.
- [x] Preserve the incident timeline and required operating procedure in the
  owning repository.

No corrective item is complete merely because it is documented; implementation
and verification evidence must close each remaining checkbox.
