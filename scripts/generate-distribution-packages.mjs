// SPDX-License-Identifier: MPL-2.0
// Copyright © 2026 Cristian Camargo Filho

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const OWNER = "harness-lens";
const REPOSITORY = "cli";
const PACKAGE_ID = "HarnessLens.HarnessLens";

const targets = {
  macosArm64: "aarch64-apple-darwin",
  macosX64: "x86_64-apple-darwin",
  windowsX64: "x86_64-pc-windows-msvc",
};

function assertVersion(version) {
  if (!/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
    throw new Error(`invalid semantic version: ${version}`);
  }
}

function archiveName(version, target) {
  const extension = target.includes("windows") ? "zip" : "tar.gz";
  return `harness-lens-v${version}-${target}.${extension}`;
}

function releaseUrl(version, target) {
  return `https://github.com/${OWNER}/${REPOSITORY}/releases/download/v${version}/${archiveName(version, target)}`;
}

export function parseChecksums(contents) {
  const checksums = new Map();
  for (const line of contents.split(/\r?\n/u)) {
    if (line.trim() === "") continue;
    const match = /^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(line.trim());
    if (!match) throw new Error(`invalid SHA256SUMS line: ${line}`);
    const name = basename(match[2]);
    if (checksums.has(name)) throw new Error(`duplicate checksum for ${name}`);
    checksums.set(name, match[1].toLowerCase());
  }
  return checksums;
}

function checksumFor(checksums, version, target) {
  const name = archiveName(version, target);
  const checksum = checksums.get(name);
  if (!checksum) throw new Error(`missing checksum for ${name}`);
  return checksum;
}

export function renderPackages(version, checksumContents) {
  assertVersion(version);
  const checksums = parseChecksums(checksumContents);
  const macosArm64Sha = checksumFor(checksums, version, targets.macosArm64);
  const macosX64Sha = checksumFor(checksums, version, targets.macosX64);
  const windowsX64Sha = checksumFor(checksums, version, targets.windowsX64);
  const windowsUrl = releaseUrl(version, targets.windowsX64);
  const wingetDirectory = `winget/manifests/h/HarnessLens/HarnessLens/${version}`;

  return {
    "homebrew/Formula/harness-lens.rb": `# SPDX-License-Identifier: MPL-2.0
# Copyright © 2026 Cristian Camargo Filho

class HarnessLens < Formula
  desc "Evidence-backed local analysis of coding-agent harnesses"
  homepage "https://github.com/harness-lens/cli"
  license "MPL-2.0"

  if Hardware::CPU.arm?
    url "${releaseUrl(version, targets.macosArm64)}"
    sha256 "${macosArm64Sha}"
  else
    url "${releaseUrl(version, targets.macosX64)}"
    sha256 "${macosX64Sha}"
  end

  depends_on :macos

  def install
    bin.install "harness-lens"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/harness-lens --version")
  end
end
`,
    [`${wingetDirectory}/${PACKAGE_ID}.yaml`]: `# SPDX-License-Identifier: MPL-2.0
# Copyright © 2026 Cristian Camargo Filho
# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.12.0.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
DefaultLocale: en-US
ManifestType: version
ManifestVersion: 1.12.0
`,
    [`${wingetDirectory}/${PACKAGE_ID}.locale.en-US.yaml`]: `# SPDX-License-Identifier: MPL-2.0
# Copyright © 2026 Cristian Camargo Filho
# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.12.0.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
PackageLocale: en-US
Publisher: Harness Lens
PublisherUrl: https://github.com/harness-lens
PublisherSupportUrl: https://github.com/harness-lens/cli/issues
PackageName: Harness Lens
PackageUrl: https://github.com/harness-lens/cli
License: MPL-2.0
LicenseUrl: https://github.com/harness-lens/cli/blob/v${version}/LICENSE
ShortDescription: Evidence-backed local analysis of coding-agent harnesses
Tags:
  - agent
  - cli
  - harness
  - scanner
ManifestType: defaultLocale
ManifestVersion: 1.12.0
`,
    [`${wingetDirectory}/${PACKAGE_ID}.installer.yaml`]: `# SPDX-License-Identifier: MPL-2.0
# Copyright © 2026 Cristian Camargo Filho
# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.12.0.schema.json

PackageIdentifier: ${PACKAGE_ID}
PackageVersion: ${version}
InstallerType: zip
NestedInstallerType: portable
NestedInstallerFiles:
  - RelativeFilePath: harness-lens.exe
    PortableCommandAlias: harness-lens
Installers:
  - Architecture: x64
    InstallerUrl: ${windowsUrl}
    InstallerSha256: "${windowsX64Sha.toUpperCase()}"
ManifestType: installer
ManifestVersion: 1.12.0
`,
    "scoop/harness-lens.json": `${JSON.stringify(
      {
        version,
        description: "Evidence-backed local analysis of coding-agent harnesses",
        homepage: "https://github.com/harness-lens/cli",
        license: "MPL-2.0",
        architecture: {
          "64bit": {
            url: windowsUrl,
            hash: windowsX64Sha,
          },
        },
        bin: "harness-lens.exe",
        checkver: {
          github: "https://github.com/harness-lens/cli",
        },
        autoupdate: {
          architecture: {
            "64bit": {
              url: "https://github.com/harness-lens/cli/releases/download/v$version/harness-lens-v$version-x86_64-pc-windows-msvc.zip",
            },
          },
        },
      },
      null,
      2,
    )}\n`,
    "chocolatey/harness-lens.nuspec": `<?xml version="1.0" encoding="utf-8"?>
<!-- SPDX-License-Identifier: MPL-2.0 -->
<!-- Copyright © 2026 Cristian Camargo Filho -->
<package xmlns="http://schemas.microsoft.com/packaging/2015/06/nuspec.xsd">
  <metadata>
    <id>harness-lens</id>
    <version>${version}</version>
    <title>Harness Lens</title>
    <authors>Cristian Camargo Filho</authors>
    <owners>Harness Lens</owners>
    <licenseUrl>https://github.com/harness-lens/cli/blob/v${version}/LICENSE</licenseUrl>
    <projectUrl>https://github.com/harness-lens/cli</projectUrl>
    <requireLicenseAcceptance>false</requireLicenseAcceptance>
    <description>Evidence-backed local analysis of coding-agent harnesses.</description>
    <summary>Local-first coding-agent harness scanner.</summary>
    <releaseNotes>https://github.com/harness-lens/cli/releases/tag/v${version}</releaseNotes>
    <copyright>Copyright © 2026 Cristian Camargo Filho</copyright>
    <tags>agent cli harness scanner</tags>
  </metadata>
  <files>
    <file src="tools\\**" target="tools" />
  </files>
</package>
`,
    "chocolatey/tools/chocolateyinstall.ps1": `# SPDX-License-Identifier: MPL-2.0
# Copyright (c) 2026 Cristian Camargo Filho

$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  url64bit       = '${windowsUrl}'
  checksum64     = '${windowsX64Sha}'
  checksumType64 = 'sha256'
  unzipLocation  = "$(Split-Path -Parent $MyInvocation.MyCommand.Definition)"
}
Install-ChocolateyZipPackage @packageArgs
`,
    "chocolatey/tools/VERIFICATION.txt": `VERIFICATION

The Windows archive is built from the v${version} source tag by the repository's
protected native-release workflow.

Archive: ${windowsUrl}
SHA-256: ${windowsX64Sha}

Verify the GitHub artifact attestation with:
  gh attestation verify harness-lens-v${version}-${targets.windowsX64}.zip --repo harness-lens/cli
`,
    "chocolatey/tools/LICENSE.txt": `Harness Lens is licensed under the Mozilla Public License 2.0.
The authoritative license text is available at:
https://github.com/harness-lens/cli/blob/v${version}/LICENSE
`,
  };
}

export async function writePackages(version, checksumPath, outputDirectory) {
  const checksumContents = await readFile(checksumPath, "utf8");
  const files = renderPackages(version, checksumContents);
  for (const [relativePath, contents] of Object.entries(files)) {
    const outputPath = resolve(outputDirectory, relativePath);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, contents, "utf8");
  }
  return Object.keys(files).sort();
}

async function main() {
  const [version, checksumPath, outputDirectory = "distribution"] = process.argv.slice(2);
  if (!version || !checksumPath) {
    throw new Error(
      "usage: node scripts/generate-distribution-packages.mjs VERSION SHA256SUMS [OUTPUT_DIRECTORY]",
    );
  }
  const files = await writePackages(version, checksumPath, outputDirectory);
  for (const file of files) console.log(file);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
