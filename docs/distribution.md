> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# Native distribution

The native distribution pipeline has one release contract. Dispatch the
protected workflow from `main` with the SemVer already declared by
`package.json`, `package-lock.json`, and `rust/Cargo.toml`. The workflow captures
that exact commit, builds these assets once, and creates the matching `vX.Y.Z`
tag only after protected approval:

| Target | Release archive | Consumer |
| --- | --- | --- |
| Apple silicon macOS | `harness-lens-vX.Y.Z-aarch64-apple-darwin.tar.gz` | Homebrew |
| Intel macOS | `harness-lens-vX.Y.Z-x86_64-apple-darwin.tar.gz` | Homebrew |
| Windows x64 | `harness-lens-vX.Y.Z-x86_64-pc-windows-msvc.zip` | WinGet, Scoop, Chocolatey |
| Linux x64 | `harness-lens-vX.Y.Z-x86_64-unknown-linux-gnu.tar.gz` | Direct download |

Each archive has a CycloneDX SBOM. `SHA256SUMS` covers every generated payload;
`RELEASE-MANIFEST.json` binds those files and the checksum file to their byte
sizes, SHA-256 digests, source SHA, workflow SHA, run ID, and attempt. The
manifest is separately attested. GitHub artifact attestations provide
cryptographically signed SLSA build provenance and bind each archive to its
SBOM. These attestations are the current cross-platform release signature; they
are not Apple Developer ID signatures, Apple notarization, or Windows
Authenticode signatures.

Verify an archive after downloading it:

```bash
sha256sum --check SHA256SUMS --ignore-missing
gh attestation verify harness-lens-v0.0.2-x86_64-unknown-linux-gnu.tar.gz \
  --repo harness-lens/cli
```

## Review before publication

> [!CAUTION]
> Never create a stable CLI tag or GitHub release manually. Do not dispatch the
> production workflow until the repository controls and sandbox rehearsal in
> the [CLI release runbook](release-runbook.md) are complete. The sole exception
> is the bounded [`v0.0.5` supervised production acceptance](releases/v0.0.5-preflight.md).

Dispatch `Native release and distribution` once from `main`, supplying only the
unused version. Its read-only preflight rejects a consumed tag, release, or npm
version before any build. It builds, tests, packages, attests, and retains one
complete candidate for 30 days. The `publish-release` job then waits at the
protected `release` environment. While it waits, download and inspect the
`harness-lens-vX.Y.Z-release` artifact from that same run. Rejecting approval
leaves no production tag, release, registry version, formula branch, or
container tag.

Review at least:

- all four binaries report the expected version;
- archive contents are limited to the binary, license, copyright, and README;
- the reviewed npm tarball contains only the intended package files and is the
  exact tarball later submitted to npm;
- `SHA256SUMS`, SBOMs, and attestations verify;
- the generated Homebrew formula selects the correct architecture;
- WinGet and Scoop manifests parse and reference the reviewed Windows checksum;
- the Chocolatey package contains only its install scripts and metadata;
- the container runs as UID/GID 65532 with a read-only workspace and no network.

After approval, the same run downloads the retained candidate without
rebuilding. It rechecks npm and GitHub state, creates or reconciles a
provenance-bound draft, uploads only missing assets, and compares the complete
remote name/size/digest inventory with the manifest. Only an exact draft is
published. It then requires `immutable=true`, the unchanged inventory, and the
tag at the original source SHA. Conflicting or already-published state stops;
assets are never clobbered. npm publication is explicitly ordered after this
postcondition. The remaining jobs propose a Homebrew PR when enabled. GHCR stays
blocked until that exact formula merges and its macOS CI passes.

## Homebrew

The release produces `harness-lens-homebrew-tap-vX.Y.Z.tar.gz`. Its formula
installs the prebuilt macOS archive selected by CPU architecture and verifies
the exact SHA-256 generated earlier in the workflow.

Protect `harness-lens/homebrew-tap` main with required pull requests, required
`Formula (arm64)` and `Formula (x86_64)` checks, and any required reviews. Keep
admin enforcement and deny force pushes. Do not add an App bypass. Install the
Harness Lens App on the tap with Contents write, Pull requests write, and
Metadata read. Configure the CLI repository:

- repository variable `HOMEBREW_TAP_PUBLISH_ENABLED=false` during preparation;
- `release` environment secret `HARNESS_LENS_APP_ID`;
- `release` environment secret `HARNESS_LENS_APP_PRIVATE_KEY`.

The switch is a variable, not a secret. Enable it only after the workflow is
merged and the repository controls and sandbox rehearsal are complete, or for
the explicitly authorized `v0.0.5` acceptance after satisfying its preflight
record.
Disabling Homebrew also blocks GHCR; it does not disable the separately approved
GitHub release job or change npm publication behavior.

`scripts/homebrew-pr.mjs open` reads the original run's assembled artifact. It
verifies the tap archive against `SHA256SUMS`, regenerates the expected formula
from those checksums, and requires identical bytes. It also verifies the
published immutable GitHub release's asset digest and the tag's exact source
SHA. No release values or checksums are written by hand.

The scoped App token creates a Git blob, tree and commit on current tap main,
then atomically creates `release/harness-lens-vX.Y.Z` through GitHub's Git API.
Only `Formula/harness-lens.rb` changes; the base tree preserves other tap files.
The same token opens the PR. Its description and commit record the release tag,
source SHA, original publication run ID, formula SHA-256, and source/release/run
links. The script never pushes to main, force-updates a ref, or approves/merges.
No token is persisted in a checkout or command argument.

Retries reuse the matching PR, including a successfully merged PR whose source
branch was deleted. A branch created before a failed PR request is reused only
when it contains the exact generated formula and one provenance-bound commit.
An ambiguous API response is reconciled on the next job run, rather than blindly
repeating a mutation. Existing PR branches are left intact. If main advances,
strict tap protection may require a maintainer to update the PR branch and rerun
CI; automation does not rebase or overwrite concurrent work. Conflicting bytes,
unknown versions, equal-version replacements, newer tap versions, unrelated
branch commits/files, changed run/source bindings, or multiple PRs fail closed.
A closed, unmerged PR must be resolved by a maintainer; it is not reopened or
replaced automatically. An identical formula without its bound PR also requires
manual investigation.

### Resume GHCR after formula review

1. Dispatch the unused version once from `main`. Review the retained candidate
   while the publisher waits, then approve that same run. GitHub assets and npm
   publish first; the App then creates the formula PR. Record this **publication
   run ID**; it is also the candidate build and manifest run ID.
2. Expect `Require merged Homebrew formula and macOS CI` to fail promptly while
   the PR is open. This is an intentional, observable pause; no polling job or
   token waits for a maintainer. GHCR is skipped.
3. Review the formula's version, URLs, checksums, source SHA, and run link. Wait
   for the exact proposed revision's two macOS jobs, including strict audit,
   install, `brew test`, and version smoke, plus any required review. Merge using
   the protected tap PR flow. If CI fails, fix the underlying issue or reject the
   release; do not bypass checks or hand-edit generated release checksums.
4. In the **same publication run**, select **Re-run failed jobs**, or run:

   ```bash
   gh run rerun PUBLICATION_RUN_ID --failed --repo harness-lens/cli
   ```

   If PR creation failed earlier, this retries that job too. To retry only that
   job and its dependents, use `gh run rerun --job JOB_ID --repo harness-lens/cli`.
   Do not select Re-run all jobs or start a new publication dispatch. The
   preflight rejects the consumed version, and continuation must remain bound to
   the original retained candidate.
5. The gate mints a fresh read-only tap token, downloads the same run's artifact,
   verifies the release again, and requires the matching PR to be merged. Both
   the merge commit and current main must contain exactly the reviewed formula,
   and the merge must be in main's ancestry. It checks the latest pull-request
   CI run for the exact head SHA and release branch; both architecture jobs and
   their audit/install/test/version steps must actually succeed. Empty-tap,
   skipped, failed, pending, other-branch, or old-revision CI does not qualify.
6. Approve the CLI `release` environment for GHCR when requested. GHCR repeats
   the complete gate after approval, before registry login/build/push, including
   when that job alone is retried. A disabled switch or newer tap release blocks
   continuation. Do not blindly rerun a GHCR job that already pushed an image:
   first inspect existing version/source tags and attestations; never overwrite
   published version tags. Recovery of a partial registry push needs maintainer
   review.

Installation tokens expire after one hour; each job requests its own token near
use and the pinned action revokes it on job completion. HTTP authentication,
permission, rate-limit, and concurrency failures stop the job without automatic
mutation retries. Correct the cause and rerun the failed job to mint a new token.
The gate reads public tap Actions metadata without authentication, so the App
needs no Actions/Checks permission; a rate limit or a private tap blocks the gate.

This continuation has a **30-day window**: GitHub supports reruns for 30 days and
the original assembled artifact is retained for 30 days. Expired/deleted
artifacts and unavailable CI evidence fail closed. Preserve the original run,
artifact, and attestations for audit. After expiry, stop for a reviewed recovery
change using the immutable published assets; this workflow has no fallback that
rebuilds bytes, switches runs, skips CI, or rewrites a release/tag.

The pinned tap setup action fetches `GITHUB_SHA`; on a PR that is GitHub's test
merge revision. Its existing `ci.yml` runs audit/install/test/version on native
Apple silicon and Intel runners. A successful run before the first formula
exists verifies workflow setup only, not installation. Production token minting
and formula installation still require the first approved release to exercise
this path; mocked CLI tests do not establish either.

Consumers install it with:

```bash
brew install harness-lens/tap/harness-lens
```

## WinGet, Scoop, and Chocolatey

All Windows definitions consume the same reviewed portable ZIP and checksum.
The release contains:

- `harness-lens-winget-vX.Y.Z.zip`: multi-file manifest for
  `HarnessLens.HarnessLens`;
- `harness-lens-scoop-vX.Y.Z.json`: Scoop manifest with immutable version URL;
- `harness-lens.X.Y.Z.nupkg`: Chocolatey package that downloads and verifies the
  release ZIP.

Registry submission remains an explicit review step because each registry has
its own ownership and moderation boundary:

1. Extract the WinGet package and validate its version directory with `winget
   validate --manifest manifests/h/HarnessLens/HarnessLens/X.Y.Z`, then copy
   the included `manifests/` tree into a branch of `microsoft/winget-pkgs` and
   submit it for review.
2. Validate the Scoop JSON with `scoop install <manifest-path>`, then commit it
   to the controlled bucket or submit it to an appropriate reviewed bucket.
3. Inspect the Chocolatey package with `choco pack`/`choco install --source .`,
   then push it with the package-owner API key. Never place that key in source.

Do not submit a manifest before its release URL resolves and its checksum and
attestation verify.

## GHCR scanner

After the package release and the exact Homebrew PR merge gate succeeds, the
workflow publishes `ghcr.io/harness-lens/cli` for `linux/amd64` and `linux/arm64`. Only
immutable version and source-SHA tags are created; there is deliberately no
mutable `latest` tag. BuildKit publishes an SBOM and maximum provenance, and
GitHub adds a registry-backed artifact attestation.

After the first publication, link the package to `harness-lens/cli`, set package
visibility to public, and confirm anonymous pulls work before documenting the
image as generally available.

Run the scanner with an explicitly constrained container:

```bash
docker run --rm --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges \
  --mount "type=bind,src=$PWD,dst=/workspace,readonly" \
  ghcr.io/harness-lens/cli:0.0.2 /workspace --json
```

The production retention policy is to retain every semantic-version tag,
source-SHA tag, release checksum, SBOM, and attestation indefinitely. Never
overwrite version tags. A registry administrator may remove untagged BuildKit
cache objects after 30 days, but not a tagged release manifest or its attached
provenance.

## Workflow behavior references

- [GitHub App tokens and explicit permissions](https://github.com/actions/create-github-app-token/tree/bcd2ba49218906704ab6c1aa796996da409d3eb1)
- [Git trees and preserving a base tree](https://docs.github.com/en/rest/git/trees)
- [Atomic reference creation](https://docs.github.com/en/rest/git/refs#create-a-reference)
- [Pull-request APIs](https://docs.github.com/en/rest/pulls/pulls)
- [Rerunning workflows and jobs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs)
- [Public workflow-run metadata](https://docs.github.com/en/rest/actions/workflow-runs)
- [Workflow-job and step results](https://docs.github.com/en/rest/actions/workflow-jobs)
- [Pinned Homebrew setup checkout](https://github.com/Homebrew/actions/blob/a657b8b0cd35d0f65cce41fce9b24cf054b49869/setup-homebrew/main.sh)
- [Homebrew tap maintenance](https://docs.brew.sh/How-to-Create-and-Maintain-a-Tap)
