> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# Publishing

> [!CAUTION]
> Do not create or publish a CLI release from the GitHub Releases UI. Follow the
> [CLI release runbook](release-runbook.md). Merge the workflow controls and
> complete the repository configuration and sandbox rehearsal before another
> stable version is attempted. The sole exception is the bounded
> [`v0.0.5` supervised production acceptance](releases/v0.0.5-preflight.md).

`@harness-lens/core@0.0.1` must remain available from npm. Configure npm trusted
publishing for organization `harness-lens`, repository `cli`, workflow filename
`native-release.yml`, environment `npm`, and allow `npm publish`. Although the
publish job is implemented in the reusable `publish.yml`, npm validates the
calling workflow for `workflow_call`, so configuring `publish.yml` would reject
the OIDC claim. Both caller and reusable workflow grant `id-token: write`.
Never commit npm tokens or publish a CLI version interactively.

The direct-publish permission is deliberate. Publication occurs only after the
protected review of the retained candidate and the immutable GitHub release
postconditions, and OIDC avoids a long-lived npm publishing token. Keep
traditional bypass-2FA tokens disallowed. Do not leave `Allow npm publish`
unchecked with the current workflow: that enables staged-only publication while
the implementation invokes `npm publish`. Moving to staged publishing is a
separate workflow and runbook change, not a settings-only hardening step; follow
the decision and migration requirements in the release runbook.

Follow [`distribution.md`](distribution.md): dispatch once from `main`, review
the exact retained candidate at the protected `release` environment, and only
then approve publication. The native workflow publishes GitHub first, verifies
immutability and exact assets, then invokes npm from the same source SHA. It
derives Homebrew, WinGet, Scoop, and Chocolatey packages from the reviewed
binary checksums and opens a protected Homebrew formula PR. GHCR stays blocked
until that PR merges with both macOS checks successful; a maintainer then reruns
failed jobs in the same publication run. The gate is rechecked after GHCR
environment approval.
Follow the [resume procedure](distribution.md#resume-ghcr-after-formula-review),
including the 30-day retry window and partial-publication boundaries. Keep
`HOMEBREW_TAP_PUBLISH_ENABLED=false` while preparing this change.

As verified on 2026-09-07, `v0.0.3` and `v0.0.4` are consumed and must not be
recreated or reused. Release `v0.0.4` is immutable with no assets; its successful
native dry-run bundle cannot be added after publication. The npm release job
also failed because `npm ci` could not resolve the lockfile's local Core tarball
from a standalone checkout. See the
[incident record](incidents/2026-09-07-empty-immutable-releases.md).

Do not prepare or publish another stable version until the workflow change is
merged and every external prerequisite in the runbook is recorded and exercised
in an immutable release sandbox, except for the explicitly authorized `v0.0.5`
acceptance. Recheck remote tags, releases, drafts, package
registries, and container tags before reserving the next version. Never rewrite
an existing tag or use a production version as a workflow test fixture.
