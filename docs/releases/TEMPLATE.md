> SPDX-License-Identifier: MPL-2.0
> Copyright © 2026 Cristian Camargo Filho

# CLI release vX.Y.Z evidence

Copy this file to `docs/releases/vX.Y.Z.md` in a normal reviewed pull request
after publication. Replace every `REQUIRED` value; never record credentials or
raw source contents. A release is not complete while required evidence is
unknown.

## Identity

| Field | Recorded value |
| --- | --- |
| Version and tag | `REQUIRED` |
| Source SHA | `REQUIRED` |
| Workflow SHA | `REQUIRED` |
| Workflow run and attempt | `REQUIRED` |
| Candidate artifact ID | `REQUIRED` |
| `RELEASE-MANIFEST.json` SHA-256 | `REQUIRED` |
| Environment approval | `REQUIRED` |

## Preconditions

- Release immutability: `REQUIRED`
- Stable-tag ruleset and automation bypass: `REQUIRED`
- `release` environment protection: `REQUIRED`
- npm trusted publisher (`native-release.yml`, `npm`, direct publish allowed,
  bypass-2FA tokens disallowed): `REQUIRED`
- Sandbox rehearsal (`v0.0.5` only: bounded acceptance exception): `REQUIRED`
- Version absence checks: `REQUIRED`

## Verification results

| Check | Result and evidence link |
| --- | --- |
| Standalone `npm ci`, test, check, and pack | `REQUIRED` |
| Four native builds and version smokes | `REQUIRED` |
| Archive and package validation | `REQUIRED` |
| Checksums, SBOMs, and attestations | `REQUIRED` |
| Draft exact asset inventory | `REQUIRED` |
| Published immutable postconditions | `REQUIRED` |

## Publication outcomes

| Destination | Published, skipped, or failed | Evidence link |
| --- | --- | --- |
| GitHub release | `REQUIRED` | `REQUIRED` |
| npm | `REQUIRED` | `REQUIRED` |
| crates.io | `REQUIRED` | `REQUIRED` |
| Homebrew PR | `REQUIRED` | `REQUIRED` |
| GHCR | `REQUIRED` | `REQUIRED` |
| WinGet | `REQUIRED` | `REQUIRED` |
| Scoop | `REQUIRED` | `REQUIRED` |
| Chocolatey | `REQUIRED` | `REQUIRED` |

## Exceptions and recovery

Record every failed or rerun job, ambiguous response, intentionally disabled
destination, maintainer decision, and the exact recovery path used. Write
`None` only when no exception occurred.

`REQUIRED`
