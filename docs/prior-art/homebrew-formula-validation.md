> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# Homebrew formula architecture selection and validation

Adopt Homebrew's formula DSL and native auditing tools for the custom binary
tap. Architecture conditionals select the URL and checksum together; the
formula remains macOS-only. `on_arm`/`on_intel` platform blocks are intended for
supported components such as dependencies and cannot contain top-level archive
URL/checksum declarations. Real Homebrew parsing/style/audit on both native
architectures is required; Ruby syntax validity alone is insufficient.

Reject bypassing `FormulaAudit/ComponentsOrder`, dropping strict tap checks, or
rewriting an immutable release to accommodate invalid generated syntax.
Assume the supported targets remain macOS ARM64 and x86_64 and that checksums
come from the same verified release inventory. Synthetic PR fixture hashes
prove selection only; installation is verified separately in the protected tap.

Sources:

- https://docs.brew.sh/Formula-Cookbook#handling-different-system-configurations
- https://docs.brew.sh/Formula-Cookbook#audit-the-formula
- https://github.com/harness-lens/homebrew-tap/actions/runs/34381671003/job/102567773200
