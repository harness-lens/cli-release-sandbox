// SPDX-License-Identifier: MPL-2.0
// Copyright © 2026 Cristian Camargo Filho

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseChecksums, renderPackages } from "./generate-distribution-packages.mjs";

export const TAP = "harness-lens/homebrew-tap";
const CLI = "harness-lens/cli";
const FORMULA = "Formula/harness-lens.rb";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};

// No mutation retries: after an ambiguous network failure, rerun the job to
// reconcile remote state. Never repeat a POST blindly or log token/body values.
export function github(token, fetcher = fetch) {
  return async (path, { method = "GET", body, optional = false } = {}) => {
    const response = await fetcher(`https://api.github.com/repos/${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2026-03-10",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (optional && response.status === 404) return null;
    requireThat(response.ok,
      `GitHub ${method} ${path}: HTTP ${response.status}. Rerun after resolving credentials, rate limits, or concurrent updates.`);
    return response.json();
  };
}

export function releaseBinding({ tag, sha, runId, formula }) {
  requireThat(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), "Invalid release tag");
  requireThat(/^[a-f0-9]{40}$/.test(sha), "Invalid source SHA");
  requireThat(/^[1-9]\d*$/.test(runId), "Invalid release run ID");
  const binding = { tag, sha, runId, formulaSha256: sha256(formula) };
  return {
    ...binding,
    formula,
    branch: `release/harness-lens-${tag}`,
    marker: `<!-- harness-lens-release:${JSON.stringify(binding)} -->`,
  };
}

export async function verifyRelease(api, release, archive, checksums) {
  const name = `harness-lens-homebrew-tap-${release.tag}.tar.gz`;
  requireThat(parseChecksums(checksums).get(name) === sha256(archive), "Tap archive checksum mismatch");
  const expected = renderPackages(release.tag.slice(1), checksums)[`homebrew/${FORMULA}`];
  requireThat(expected === release.formula, "Formula differs from the generated release URLs/checksums");
  const published = await api(`${CLI}/releases/tags/${release.tag}`);
  requireThat(published.tag_name === release.tag && !published.draft && !published.prerelease && published.immutable === true,
    "A published immutable stable release is required");
  const assets = published.assets.filter((asset) => asset.name === name);
  requireThat(assets.length === 1 && assets[0].state === "uploaded" && assets[0].digest === `sha256:${sha256(archive)}`,
    "Published tap asset differs from this workflow's reviewed artifact");
  const commit = await api(`${CLI}/commits/${release.tag}`);
  requireThat(commit.sha === release.sha, "Release tag no longer matches the source SHA");
}

async function formulaAt(api, ref) {
  const file = await api(`${TAP}/contents/${FORMULA}?ref=${encodeURIComponent(ref)}`, { optional: true });
  if (!file) return null;
  requireThat(file.type === "file" && file.encoding === "base64", "Unexpected formula object");
  return Buffer.from(file.content, "base64").toString("utf8");
}

function rejectDowngrade(current, release) {
  if (current === null || current === release.formula) return;
  // Homebrew rejects an explicit version when it can infer it from the URL.
  // Require both known architectures to identify one canonical release, with
  // matching tag/archive versions, before comparing or replacing a formula.
  const sources = [...current.matchAll(/^    url "https:\/\/github\.com\/harness-lens\/cli\/releases\/download\/v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\/harness-lens-v\1-(aarch64|x86_64)-apple-darwin\.tar\.gz"$/gm)];
  const explicit = [...current.matchAll(/^  version "([^"]+)"$/gm)];
  requireThat(sources.length === 2 && [...current.matchAll(/^\s+url /gm)].length === 2 &&
    new Set(sources.map((source) => source[2])).size === 2 && sources[0][1] === sources[1][1] &&
    explicit.length <= 1 && [...current.matchAll(/^\s+version\b/gm)].length === explicit.length &&
    explicit.every((match) => match[1] === sources[0][1]),
  "Cannot determine current formula version; manual review required");
  const old = sources[0][1].split(".").map(BigInt);
  const next = release.tag.slice(1).split(".").map(BigInt);
  const different = old.findIndex((part, index) => part !== next[index]);
  requireThat(different >= 0 && old[different] < next[different], "Conflicting or newer formula; refusing replacement or downgrade");
}

async function intendedPr(api, release) {
  const prs = await api(`${TAP}/pulls?state=all&head=harness-lens:${release.branch}&base=main&per_page=100`);
  requireThat(prs.length <= 1, "Multiple release PRs found; manual review required");
  if (!prs.length) return null;
  const pr = await api(`${TAP}/pulls/${prs[0].number}`);
  requireThat(pr.head.repo?.full_name === TAP && pr.base.repo?.full_name === TAP &&
    pr.head.ref === release.branch && pr.base.ref === "main" && pr.body?.includes(release.marker),
  "PR release/source/run binding mismatch; rerun the original publication run");
  requireThat(pr.state === "open" || pr.merged === true, "Release PR was closed without merging; maintainer must resolve rejection");
  requireThat(!pr.draft, "Release PR is still a draft");
  const files = await api(`${TAP}/pulls/${pr.number}/files?per_page=100`);
  requireThat(files.length === 1 && pr.changed_files === 1 && files[0].filename === FORMULA &&
    ["added", "modified"].includes(files[0].status), "Release PR includes unrelated changes");
  requireThat(await formulaAt(api, pr.head.sha) === release.formula, "PR formula differs from the reviewed release");
  return pr;
}

async function validateBranch(api, release, head, main) {
  requireThat(await formulaAt(api, head) === release.formula, "Release branch contains a conflicting formula");
  const comparison = await api(`${TAP}/compare/${main}...${head}`);
  requireThat(comparison.files?.length === 1 && comparison.files[0].filename === FORMULA &&
    ["added", "modified"].includes(comparison.files[0].status) && comparison.commits?.length === 1 &&
    comparison.total_commits === 1 && comparison.commits[0].commit.message.includes(release.marker),
  "Release branch contains unrelated commits or lacks provenance; refusing to overwrite it");
}

async function verifyMergedFormula(api, release, pr) {
  requireThat(pr.merged === true && pr.merge_commit_sha, `Formula PR #${pr.number} is not merged. Wait for macOS checks/review, merge, then rerun failed jobs.`);
  requireThat(await formulaAt(api, pr.merge_commit_sha) === release.formula, "Merged formula differs from reviewed release");
  const main = await api(`${TAP}/git/ref/heads/main`);
  requireThat(await formulaAt(api, main.object.sha) === release.formula, "Tap main no longer contains this release; refusing stale GHCR publication");
  const ancestry = await api(`${TAP}/compare/${pr.merge_commit_sha}...${main.object.sha}`);
  requireThat(["ahead", "identical"].includes(ancestry.status), "Formula merge is not on current tap main");
}

export async function ensureFormulaPr(api, release) {
  const pr = await intendedPr(api, release);
  const main = await api(`${TAP}/git/ref/heads/main`);
  const current = await formulaAt(api, main.object.sha);
  rejectDowngrade(current, release);
  if (pr) {
    if (pr.merged) await verifyMergedFormula(api, release, pr);
    // Existing PRs/branches are never rewritten, rebased, or force-pushed.
    return pr;
  }
  requireThat(current !== release.formula, "Formula already current without the bound release PR; manual review required");
  let branch = await api(`${TAP}/git/ref/heads/${release.branch}`, { optional: true });
  if (!branch) {
    const base = await api(`${TAP}/git/commits/${main.object.sha}`);
    const blob = await api(`${TAP}/git/blobs`, { method: "POST", body: { content: release.formula, encoding: "utf-8" } });
    const tree = await api(`${TAP}/git/trees`, { method: "POST", body: {
      base_tree: base.tree.sha,
      tree: [{ path: FORMULA, mode: "100644", type: "blob", sha: blob.sha }],
    } });
    const commit = await api(`${TAP}/git/commits`, { method: "POST", body: {
      message: `harness-lens ${release.tag}\n\n${release.marker}`,
      tree: tree.sha,
      parents: [main.object.sha],
    } });
    const fresh = await api(`${TAP}/git/ref/heads/main`);
    requireThat(fresh.object.sha === main.object.sha, "Tap main advanced while preparing the branch; rerun this job");
    // Atomic create only. An existing/concurrent ref returns 422, never an overwrite.
    branch = await api(`${TAP}/git/refs`, { method: "POST", body: { ref: `refs/heads/${release.branch}`, sha: commit.sha } });
  }
  await validateBranch(api, release, branch.object.sha, main.object.sha);
  const created = await api(`${TAP}/pulls`, { method: "POST", body: {
    title: `harness-lens ${release.tag}`,
    head: release.branch,
    base: "main",
    body: `Update the generated formula from the reviewed native release.\n\n` +
      `- Release: https://github.com/${CLI}/releases/tag/${release.tag}\n` +
      `- Source: https://github.com/${CLI}/commit/${release.sha}\n` +
      `- Publication run: https://github.com/${CLI}/actions/runs/${release.runId}\n` +
      `- Formula SHA-256: \`${release.formulaSha256}\`\n\n` +
      `Merge only after both macOS checks and required review pass. Then rerun failed jobs in the publication run to continue GHCR.\n\n${release.marker}`,
  } });
  return created;
}

export async function verifyMergeGate(api, publicApi, release) {
  const pr = await intendedPr(api, release);
  requireThat(pr, "Matching formula PR is missing; rerun the formula PR job first");
  await verifyMergedFormula(api, release, pr);
  // Public metadata needs no additional App Actions/Checks permissions. Never
  // fall back to a successful empty-tap run, push run, or another PR revision.
  const runs = await publicApi(`${TAP}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`);
  const candidates = runs.workflow_runs.filter((run) => run.event === "pull_request" &&
    run.head_sha === pr.head.sha && run.head_repository?.full_name === TAP &&
    run.head_branch === release.branch);
  candidates.sort((a, b) => b.id - a.id);
  const run = candidates[0];
  requireThat(run?.status === "completed" && run.conclusion === "success", "Latest CI for the formula PR revision has not succeeded");
  const result = await publicApi(`${TAP}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
  requireThat(result.total_count === result.jobs.length, "Too many CI jobs to verify safely");
  for (const name of ["Formula (arm64)", "Formula (x86_64)"]) {
    const jobs = result.jobs.filter((job) => job.name === name);
    requireThat(jobs.length === 1 && jobs[0].status === "completed" && jobs[0].conclusion === "success" &&
      ["Check formula on all supported platforms", "Install and test formula"].every((step) =>
        jobs[0].steps.some((item) => item.name === step && item.conclusion === "success")),
    `${name} did not run successful audit/install/test/version checks`);
  }
  return pr;
}

async function main() {
  requireThat(["open", "gate"].includes(process.argv[2]), "Usage: node scripts/homebrew-pr.mjs open|gate");
  requireThat(process.env.HOMEBREW_TAP_PUBLISH_ENABLED === "true", "Homebrew publishing is disabled; GHCR must remain blocked");
  requireThat(process.env.TAP_TOKEN && process.env.GH_TOKEN, "Fresh tap installation and CLI tokens are required");
  const tag = process.env.RELEASE_TAG;
  requireThat(/^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag), "Invalid release tag");
  const archivePath = `release/harness-lens-homebrew-tap-${tag}.tar.gz`;
  const archive = await readFile(archivePath);
  const formula = execFileSync("tar", ["-xOf", archivePath, `./${FORMULA}`], { encoding: "utf8" });
  const release = releaseBinding({ tag, sha: process.env.RELEASE_SHA, runId: process.env.GITHUB_RUN_ID, formula });
  await verifyRelease(github(process.env.GH_TOKEN), release, archive, await readFile("release/SHA256SUMS", "utf8"));
  const api = github(process.env.TAP_TOKEN);
  const pr = process.argv[2] === "open" ? await ensureFormulaPr(api, release) : await verifyMergeGate(api, github(), release);
  const url = `https://github.com/${TAP}/pull/${pr.number}`;
  console.log(`Verified formula PR: ${url}`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `Formula PR: ${url}\n\nSource: ${release.sha}; release: ${tag}; run: ${release.runId}.\n`);
  if (process.argv[2] === "gate" && process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, "merged=true\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
