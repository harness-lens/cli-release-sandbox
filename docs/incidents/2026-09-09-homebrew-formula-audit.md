> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# Homebrew v0.0.5 formula audit failure

The immutable CLI v0.0.5 release and npm publication succeeded. Its generated
Homebrew formula in [tap PR #3](https://github.com/harness-lens/homebrew-tap/pull/3)
failed `FormulaAudit/ComponentsOrder`: `on_arm` and `on_intel` blocks may not
contain the formula's `url` and `sha256` components. `ruby -c` only checked Ruby
syntax before publication and could not detect the Homebrew DSL violation.

The downstream `homebrew-pr.mjs gate` correctly stopped because the PR was not
merged. Required macOS checks and formula provenance must remain enforced.
[CLI issue #32](https://github.com/harness-lens/cli/issues/32) tracks recovery.

## Correction and verification

The generator uses `Hardware::CPU.arm?` to choose one matching archive URL/hash
pair. Strict audit also rejects the redundant explicit version. Homebrew now
infers it from the URL; downgrade protection requires both architecture URLs to
agree on the same canonical tag/archive version before making any writes. Both macOS architectures run Homebrew parsing, style and strict audit on
PRs and on the exact candidate formula before release assembly/publication.
The PR regression also inspects Homebrew's resolved URL/hash on each native
architecture. Fixture checksums are synthetic and are never installed or
published. The protected tap PR still performs real installation and tests
against the published candidate.

## Immutable release boundary

Do not overwrite v0.0.5 assets, its tag, the original PR's formula or provenance
marker, or the already-published npm version. Rerunning its failed job cannot
repair the formula: the original run checks out the original source and verifies
the exact retained formula bytes.

The normal recovery is a reviewed replacement release from the corrected CLI
source, using the next unused version after registry/tag checks. Its candidate
must pass both Homebrew audits before publication, followed by the new tap PR's
macOS install/test checks and protected merge. Continue GHCR in that replacement
release's original run. Keep the v0.0.5 incident and its failed run as evidence;
supersede its tap PR only after the accepted replacement is available.

Any alternative recovery that derives a new formula from v0.0.5 requires a
separately reviewed provenance contract; disabling style checks or loosening the
existing gate is not a recovery procedure.
