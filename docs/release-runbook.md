> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# CLI release runbook

This runbook is the required operating procedure for a Harness Lens CLI
release. It exists to make release publication deterministic, reviewable, and
recoverable before the irreversible immutable-publication boundary.

## Current status

The corrective workflow and tests implementing the repository-side one-run
transaction are merged. The tag rules, protected environments, npm trusted
publisher, and other repository controls must still be verified and recorded
before each production run. Do not create another stable tag or GitHub release
until an immutable release-sandbox rehearsal has also passed. The sole exception
is the supervised `v0.0.5` production acceptance authorized and bounded by the
[`v0.0.5` preflight record](releases/v0.0.5-preflight.md).

Tags `v0.0.3` and `v0.0.4` are consumed and must never be recreated or reused.
Release `v0.0.4` is immutable and contains no assets. See the
[incident record](incidents/2026-09-07-empty-immutable-releases.md).

## Non-negotiable invariants

- Use the protected release workflow as the only production entry point. Never
  create or publish a CLI release from the GitHub Releases UI.
- Start from an exact, merged `main` commit whose required checks succeeded.
- Build each artifact once. The bytes reviewed before approval are the bytes
  uploaded after approval; publication must not rebuild them.
- Do not create the production tag or release until the complete candidate is
  assembled, tested, checksummed, attested, and retained as a workflow artifact.
- Create a draft, attach and verify every expected asset, and publish only after
  the draft matches the generated release manifest exactly.
- Treat publication as irreversible. Never move or reuse a released tag, replace
  a published asset, overwrite a registry version, or automate deletion as
  recovery.
- Stop on absent evidence, conflicting state, an unknown asset, a mismatched
  digest, or an unavailable external gate.
- Keep GitHub release assets, npm/crate publication, Homebrew, and GHCR results
  observable as separate outcomes. One destination must not conceal another's
  failure.

## Required repository controls

Before a production run, verify and record:

- release immutability is enabled for `harness-lens/cli`;
- the `release` environment has required reviewers, prevents self-review when a
  second maintainer is available, disallows administrator bypass, and permits
  only the intended branch;
- a tag ruleset protects stable `v*` tags from human creation, update, and
  deletion, with only the release automation identity allowed to bypass it;
- every workflow defaults to `contents: read`; the protected publisher keeps its
  `GITHUB_TOKEN` read-only and mints a repository-scoped release App token with
  `contents: write` only after environment approval;
- registry and GitHub App credentials exist only in their protected
  environments and have the minimum permissions required;
- release workflow and verification-script changes require review and passing
  CI; and
- the npm publication path succeeds from a standalone checkout with `npm ci`.

For npm trusted publishing, require organization `harness-lens`, repository
`cli`, workflow filename `native-release.yml`, environment `npm`, and explicit
permission for `npm publish`. npm validates the calling workflow when a
reusable `workflow_call` performs publication; do not configure `publish.yml` as
the trusted filename. Record the npm settings screen because npm does not test
the OIDC relationship when it is saved.

Direct `npm publish` permission is an intentional project decision. The npm job
runs only after protected approval and after GitHub reports the complete,
reviewed release as immutable. It publishes that run's exact retained tarball
through short-lived OIDC credentials; traditional bypass-2FA tokens remain
disallowed. npm's stronger staged-only option is not compatible with the
current transaction: leaving `Allow npm publish` unchecked would reject the
workflow's direct publish command after the GitHub release already exists.

Do not switch the npm setting to staged-only as an isolated configuration
change. Such a migration requires a reviewed redesign using `npm stage publish`,
npm CLI 11.15.0 or later, an explicit maintainer review and 2FA approval step,
post-approval registry reconciliation, and downstream jobs that remain blocked
until the staged version is publicly observable. See npm's
[trusted-publisher](https://docs.npmjs.com/trusted-publishers/) and
[staged-publishing](https://docs.npmjs.com/staged-publishing/) documentation.
Never record npm session data, tokens, private keys, recovery codes, or 2FA
values in release evidence.

Capture a read-only GitHub settings audit before the sandbox rehearsal and the
production run:

```bash
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/harness-lens/cli/immutable-releases
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/harness-lens/cli/actions/permissions/workflow
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/harness-lens/cli/environments/release
gh api -H "X-GitHub-Api-Version: 2026-03-10" \
  repos/harness-lens/cli/rulesets
```

The evidence is acceptable only when immutability is enabled, default workflow
permission is read, the `release` environment exposes the intended reviewers,
self-review and administrator bypass policy, only `main` may deploy, and the
active tag ruleset targets `refs/tags/v*` with creation/update/deletion blocked
for humans and a narrowly scoped automation bypass. Fetch the matching ruleset
by ID to record its full rules and bypass actors. Do not record tokens or private
keys.

Record the settings without recording secret values.

## Pull request CI verification

Pushing this change and opening its pull request must run only the ordinary
`pull_request` workflows. Do not dispatch `Native release and distribution` to
test a pull request; that workflow is the production publication entry point.

Before merge, record the pull request number and expected head SHA, then run:

```bash
gh pr view PR_NUMBER --repo harness-lens/cli \
  --json headRefOid,mergeStateStatus,reviewDecision,statusCheckRollup
gh pr checks PR_NUMBER --repo harness-lens/cli --watch
```

The recorded `headRefOid` must equal the reviewed branch SHA. Require successful
results for pinned workflow lint, all TypeScript matrix jobs (Node 20, 22, and
24), Rust, the scanner container, the language placeholders, and CodeQL. Inspect
any failure before rerunning it; do not merge based on a stale successful run
from an older SHA. The Actions page must not show a release workflow run caused
by the pull request.

After merge, fetch `main`, record the resulting remote SHA, and verify the
release files on `main` rather than assuming that the pull request button
preserved them:

```bash
git fetch origin main
git log -1 --oneline origin/main
git diff --exit-code REVIEWED_HEAD origin/main -- \
  .github/workflows/ci.yml \
  .github/workflows/native-release.yml \
  .github/workflows/publish.yml \
  scripts/release-transaction.mjs \
  scripts/publish-npm.mjs
```

The diff must be empty. This verifies the repository content only; it does not
verify environment reviewers, tag rules, release immutability, registry
configuration, or the behavior of the irreversible publication boundary. Audit
those settings separately and complete the sandbox rehearsal below before any
production dispatch other than the bounded `v0.0.5` acceptance.

## One-run release sequence

### 1. Prepare source

1. Select the next unused SemVer version by checking Git tags, GitHub releases
   and drafts, npm, crates.io, and GHCR.
2. Update every npm and Rust version field and lockfile through a reviewed CLI
   pull request.
3. Run the documented repository checks in a clean standalone checkout.
4. Merge only after required CI and CodeQL checks pass. Record the immutable
   merge SHA; do not create the release tag manually.

### 2. Dispatch the candidate

Dispatch the protected release workflow once from `main` with the version. The
workflow captures the event's exact commit SHA rather than accepting a
free-form SHA input. Its preflight must fail before building unless:

- the SHA is the accepted commit on `main`;
- all source and lockfile versions equal the request;
- the stable tag and every release state are absent;
- the npm version is absent.

The recorded operator audit must separately establish release immutability,
required-check success, environment protection, tag rules, and absence from
crates.io, GHCR, or any other enabled destination. GitHub's immutable-release
settings endpoint requires repository Administration permission, which the
deliberately least-privileged `GITHUB_TOKEN` does not receive. Do not inject an
administration credential merely to repeat this settings check inside the job.
The publisher instead requires GitHub's resulting release object to report
`immutable=true` before any downstream publication can begin. These
administration and cross-registry facts not being readable by the automated
preflight is not permission to skip the recorded operator audit. See GitHub's
[repository API permission requirements](https://docs.github.com/en/rest/repos/repos#check-if-immutable-releases-are-enabled-for-a-repository).

### 3. Build and verify before mutation

The same workflow run must:

1. Build and smoke-test Apple silicon macOS, Intel macOS, Windows x64, and Linux
   x64 binaries on their native runners.
2. Verify each binary reports the requested version.
3. Audit archive members and reject absolute paths, traversal, links, or
   unexpected files.
4. Generate and validate CycloneDX SBOMs, package-manager definitions, and
   SHA-256 checksums.
5. Verify Homebrew architecture selection and Windows package checksums.
6. Assemble exactly one candidate directory.
7. Generate `RELEASE-MANIFEST.json` with version, tag, source SHA, workflow SHA,
   run ID and attempt, plus every asset's name, byte size, and SHA-256.
8. Attest and upload the complete candidate as one retained workflow artifact.

No tag, draft, registry version, formula branch, or container tag may exist at
this point.

### 4. Review the exact candidate

The publisher job waits at the protected `release` environment. The reviewer
downloads the candidate from that same run and verifies:

- `SHA256SUMS` and `RELEASE-MANIFEST.json`;
- the exact asset allowlist and archive contents;
- all native version smokes and package validators;
- SBOM and provenance attestations;
- generated Homebrew, WinGet, Scoop, and Chocolatey metadata; and
- the source SHA, workflow SHA, run ID, and run attempt.

Reject the deployment if any evidence is missing. Approval authorizes only the
candidate already stored by this run.

### 5. Create, populate, and publish the draft

After approval, the publisher must use the retained candidate without rebuilding:

1. Recheck the least-privilege GitHub and npm preflight conditions to detect
   races; rely on the immediately preceding recorded administration audit for
   the immutable-release setting.
2. Create the stable tag and draft release for the exact source SHA using the
   protected automation identity.
3. Upload the candidate assets.
4. Query GitHub for the draft tag target and complete asset inventory.
5. Compare GitHub asset names, counts, byte sizes, and reported SHA-256 digests
   with `RELEASE-MANIFEST.json`.
6. Refuse publication unless the draft is an exact match with no extra assets.
7. Publish the draft, creating the immutable release and release attestation.
8. Query GitHub again and require `draft=false`, `immutable=true`, the exact tag
   SHA, and the unchanged asset inventory.

Only step 7 is the irreversible publication boundary.

### 6. Continue downstream publication

After the immutable GitHub release passes its postconditions:

1. Submit the exact reviewed npm tarball, then reconcile its public version,
   integrity, and provenance.
2. Create or reuse only the provenance-bound Homebrew formula PR generated by
   the publication run.
3. Review and merge that PR after both macOS jobs pass.
4. Rerun only the documented failed jobs from the same publication run.
5. Publish GHCR only after the formula merge gate passes again.
6. Record intentionally disabled registries as skipped, not successful.

Follow the detailed [distribution guide](distribution.md) for Homebrew and GHCR
continuation constraints.

## Recovery matrix

| Observed state | Permitted action |
| --- | --- |
| No tag or release | Create the expected draft after approval. |
| Matching draft with no assets | Resume from the same run's retained candidate. |
| Matching draft with partial assets | Verify existing digests; upload only missing assets. |
| Matching complete draft | Reverify the full manifest, then publish. |
| Conflicting tag SHA or draft metadata | Stop for maintainer investigation. |
| Existing asset with a different digest | Stop; never use `--clobber`. |
| Existing published release | Stop; never rebuild or try to modify it. |
| Published release reports `immutable=false` | Stop all downstream publication and begin incident review; never replace its assets or tag. |
| Existing registry version | Stop; registries and stable versions are immutable. |
| Expired or missing workflow artifact | Stop; prepare a reviewed new version. |
| Ambiguous API response | Read current state and reconcile; do not repeat a mutation blindly. |

## Tests required before the next release

The owning workflow change must pass:

- unit tests for version, tag, manifest, allowlist, digest, and state-transition
  validation;
- tests for partial drafts, retries, conflicts, duplicate or unexpected assets,
  and already-published state;
- a structural workflow test proving there is one production entry point and
  one write-enabled publisher behind the `release` environment;
- clean standalone npm installation, tests, and package dry run;
- all native builds, smokes, archive audits, package validators, checksums,
  SBOM validation, and attestations in dry-run mode; and
- one end-to-end rehearsal in a dedicated sandbox repository configured with
  release immutability, the same environment protections, and tag rules.

The sandbox rehearsal must prove that draft recovery works, exact assets are
accepted, publication makes the release immutable, subsequent asset mutation is
rejected, and an unauthorized stable-tag creation is rejected. A production
version is not a workflow test fixture.

The `v0.0.5` exception does not satisfy this rehearsal requirement. It expires
when `v0.0.5` is consumed and cannot be cited for any later version. Complete the
dedicated sandbox rehearsal before preparing the next production version.

## Evidence retained for every release

- `RELEASE-MANIFEST.json` and `SHA256SUMS` as immutable release assets;
- source SHA, workflow SHA, run ID, attempt, and environment approval record;
- native test, package validation, SBOM, checksum, and attestation results;
- GitHub release, Homebrew PR, registry, and GHCR links and outcomes; and
- a versioned `docs/releases/vX.Y.Z.md` record added through normal review after
  publication using [`docs/releases/TEMPLATE.md`](releases/TEMPLATE.md), followed
  by the architecture-hub composition update.

Update the hub submodule pin and `docs/repository-split.md` only after the owning
CLI release and required downstream checks finish.
