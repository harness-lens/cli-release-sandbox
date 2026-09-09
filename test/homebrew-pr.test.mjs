// SPDX-License-Identifier: MPL-2.0
// Copyright © 2026 Cristian Camargo Filho

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ensureFormulaPr, github, releaseBinding, TAP, verifyMergeGate, verifyRelease } from "../scripts/homebrew-pr.mjs";
import { renderPackages } from "../scripts/generate-distribution-packages.mjs";

const digest = (value) => createHash("sha256").update(value).digest("hex");
const archive = Buffer.from("reviewed archive fixture");
const checksums = [
  `${"a".repeat(64)}  harness-lens-v0.0.3-aarch64-apple-darwin.tar.gz`,
  `${"b".repeat(64)}  harness-lens-v0.0.3-x86_64-apple-darwin.tar.gz`,
  `${"c".repeat(64)}  harness-lens-v0.0.3-x86_64-pc-windows-msvc.zip`,
  `${digest(archive)}  harness-lens-homebrew-tap-v0.0.3.tar.gz`,
].join("\n");
const formula = renderPackages("0.0.3", checksums)["homebrew/Formula/harness-lens.rb"];
const release = releaseBinding({ tag: "v0.0.3", sha: "d".repeat(40), runId: "123", formula });

function fixture() {
  const state = {
    main: "main-sha", branch: null, pr: null, writes: [], calls: [],
    formulas: new Map([["main-sha", null], ["branch-sha", formula], ["merge-sha", formula]]),
    files: [{ filename: "Formula/harness-lens.rb", status: "added" }],
    comparison: { status: "ahead", total_commits: 1, files: [{ filename: "Formula/harness-lens.rb", status: "added" }],
      commits: [{ commit: { message: `release\n${release.marker}` } }] },
    ancestry: "identical",
    run: { id: 77, event: "pull_request", head_sha: "branch-sha", head_branch: release.branch,
      head_repository: { full_name: TAP }, pull_requests: [], status: "completed", conclusion: "success" },
    jobs: ["Formula (arm64)", "Formula (x86_64)"].map((name) => ({ name, status: "completed", conclusion: "success",
      steps: ["Check formula on all supported platforms", "Install and test formula"].map((step) => ({ name: step, conclusion: "success" })) })),
    published: { tag_name: release.tag, immutable: true, draft: false, prerelease: false,
      assets: [{ name: "harness-lens-homebrew-tap-v0.0.3.tar.gz", state: "uploaded", digest: `sha256:${digest(archive)}` }] },
    sourceSha: release.sha,
  };
  const makePr = () => ({ number: 9, state: "open", merged: false, draft: false, changed_files: 1,
    head: { repo: { full_name: TAP }, ref: release.branch, sha: "branch-sha" },
    base: { repo: { full_name: TAP }, ref: "main" }, body: release.marker, merge_commit_sha: "merge-sha" });
  const api = async (path, options = {}) => {
    state.calls.push(path);
    if (options.method) state.writes.push({ path, ...options });
    if (state.intercept) await state.intercept(path, options);
    const local = path.replace(`${TAP}/`, "");
    if (path === `harness-lens/cli/releases/tags/${release.tag}`) return state.published;
    if (path === `harness-lens/cli/commits/${release.tag}`) return { sha: state.sourceSha };
    if (local.startsWith("pulls?")) return state.pr ? [state.pr] : [];
    if (local === "pulls/9") return state.pr;
    if (local.startsWith("pulls/9/files?")) return state.files;
    if (local === "git/ref/heads/main") return { object: { sha: state.main } };
    if (local === `git/ref/heads/${release.branch}`) return state.branch;
    if (local.startsWith("contents/Formula/harness-lens.rb?ref=")) {
      const content = state.formulas.get(decodeURIComponent(local.split("?ref=")[1]));
      assert.notEqual(content, undefined, `Missing fixture formula: ${local}`);
      return content === null ? null : { type: "file", encoding: "base64", content: Buffer.from(content).toString("base64") };
    }
    if (local === `git/commits/${state.main}`) return { tree: { sha: "base-tree-with-unrelated-files" } };
    if (local === "git/blobs") return { sha: "blob-sha" };
    if (local === "git/trees") return { sha: "tree-sha" };
    if (local === "git/commits") return { sha: "branch-sha" };
    if (local === "git/refs") {
      state.branch = { object: { sha: options.body.sha } };
      return state.branch;
    }
    if (local.startsWith("compare/merge-sha...")) return { status: state.ancestry };
    if (local.startsWith("compare/")) return state.comparison;
    if (local === "pulls") {
      state.pr = { ...makePr(), body: options.body.body };
      return state.pr;
    }
    if (local.startsWith("actions/workflows/ci.yml/runs?")) return { workflow_runs: state.runs ?? [state.run] };
    if (local === "actions/runs/77/jobs?filter=latest&per_page=100") return { jobs: state.jobs, total_count: state.jobs.length };
    throw new Error(`Unexpected API call ${local}`);
  };
  function merged() {
    state.pr = { ...makePr(), state: "closed", merged: true };
    state.main = "merge-sha";
  }
  return { state, api, merged, makePr };
}

test("creates only a formula commit on current main and one provenance-bound PR; retry makes no writes", async () => {
  const { state, api } = fixture();
  assert.equal((await ensureFormulaPr(api, release)).number, 9);
  const tree = state.writes.find((item) => item.path.endsWith("/git/trees")).body;
  assert.equal(tree.base_tree, "base-tree-with-unrelated-files");
  assert.deepEqual(tree.tree, [{ path: "Formula/harness-lens.rb", mode: "100644", type: "blob", sha: "blob-sha" }]);
  assert.deepEqual(state.writes.find((item) => item.path.endsWith("/git/commits")).body.parents, ["main-sha"]);
  const ref = state.writes.find((item) => item.path.endsWith("/git/refs"));
  assert.equal(ref.body.ref, `refs/heads/${release.branch}`);
  assert.match(state.pr.body, /releases\/tag\/v0\.0\.3/);
  assert.match(state.pr.body, /actions\/runs\/123/);
  assert.ok(state.pr.body.includes(release.sha));
  const writes = state.writes.length;
  await ensureFormulaPr(api, release);
  assert.equal(state.writes.length, writes);
  assert.ok(state.writes.every((item) => item.method === "POST"));
});

test("recovers branch push followed by failed PR creation", async () => {
  const { state, api } = fixture();
  state.branch = { object: { sha: "branch-sha" } };
  await ensureFormulaPr(api, release);
  assert.deepEqual(state.writes.map((item) => item.path), [`${TAP}/pulls`]);
});

test("recovers ambiguous PR response without a duplicate", async () => {
  const { state, api } = fixture();
  await assert.rejects(ensureFormulaPr(async (...args) => {
    const result = await api(...args);
    if (args[0] === `${TAP}/pulls`) throw new Error("connection lost after creation");
    return result;
  }, release), /connection lost/);
  const writes = state.writes.length;
  await ensureFormulaPr(api, release);
  assert.equal(state.writes.length, writes);
});

test("already merged release is reused even when its branch is deleted", async () => {
  const { state, api, merged } = fixture();
  merged();
  assert.equal((await ensureFormulaPr(api, release)).number, 9);
  assert.equal(state.writes.length, 0);
});

test("upgrades an older URL-derived formula and matching legacy version", async () => {
  for (const legacy of [false, true]) {
    const { state, api } = fixture();
    let current = formula.replaceAll("0.0.3", "0.0.2");
    if (legacy) current = current.replace('  license', '  version "0.0.2"\n  license');
    state.formulas.set(state.main, current);
    assert.equal((await ensureFormulaPr(api, release)).number, 9);
    assert.ok(state.writes.length > 0);
  }
});

for (const [name, modify, expected] of [
  ["newer version", (s) => s.formulas.set(s.main, formula.replaceAll("0.0.3", "0.0.4")), /downgrade/],
  ["mismatched tag/archive version", (s) => s.formulas.set(s.main, formula.replace("download/v0.0.3/", "download/v0.0.2/")), /determine current formula version/],
  ["mixed architecture versions", (s) => s.formulas.set(s.main, formula.replace("download/v0.0.3/harness-lens-v0.0.3-aarch64", "download/v0.0.2/harness-lens-v0.0.2-aarch64")), /determine current formula version/],
  ["duplicate architecture", (s) => s.formulas.set(s.main, formula.replace("x86_64-apple", "aarch64-apple")), /determine current formula version/],
  ["unrecognized version declaration", (s) => s.formulas.set(s.main, formula.replace('  license', "  version '0.0.4'\n  license")), /determine current formula version/],
  ["conflicting legacy version", (s) => s.formulas.set(s.main, formula.replace('  license', '  version "0.0.1"\n  license')), /determine current formula version/],
  ["same version with different checksum", (s) => s.formulas.set(s.main, formula.replace("a".repeat(64), "e".repeat(64))), /replacement/],
  ["unknown formula syntax", (s) => s.formulas.set(s.main, "arbitrary formula"), /determine current formula version/],
  ["unbound identical formula", (s) => s.formulas.set(s.main, formula), /without the bound release PR/],
  ["conflicting branch", (s) => { s.branch = { object: { sha: "branch-sha" } }; s.formulas.set("branch-sha", "other"); }, /conflicting formula/],
  ["unrelated branch file", (s) => { s.branch = { object: { sha: "branch-sha" } }; s.comparison.files.push({ filename: "README.md" }); }, /unrelated commits/],
  ["extra branch commit", (s) => { s.branch = { object: { sha: "branch-sha" } }; s.comparison.total_commits = 2; }, /unrelated commits/],
]) {
  test(`refuses ${name} without writes`, async () => {
    const { state, api } = fixture();
    modify(state);
    await assert.rejects(ensureFormulaPr(api, release), expected);
    assert.equal(state.writes.length, 0);
  });
}

test("moving main aborts before ref creation; concurrent branch creation is never overwritten", async () => {
  for (const conflict of ["main", "branch"]) {
    const { state, api } = fixture();
    state.intercept = (path) => {
      if (conflict === "main" && path.endsWith("/git/commits")) state.main = "new-main";
      if (conflict === "branch" && path.endsWith("/git/refs")) throw new Error("HTTP 422 concurrent branch");
    };
    await assert.rejects(ensureFormulaPr(api, release), conflict === "main" ? /main advanced/ : /422/);
    assert.equal(state.pr, null);
    assert.ok(state.writes.every((item) => item.method === "POST" && item.body.force === undefined));
  }
});

for (const [name, modify, expected] of [
  ["closed unmerged PR", (p) => { p.state = "closed"; }, /closed without merging/],
  ["another source SHA", (p) => { p.body = p.body.replace(release.sha, "e".repeat(40)); }, /binding mismatch/],
  ["another release run", (p) => { p.body = p.body.replace('"123"', '"124"'); }, /binding mismatch/],
  ["another tag", (p) => { p.body = p.body.replace("v0.0.3", "v0.0.2"); }, /binding mismatch/],
  ["fork PR", (p) => { p.head.repo.full_name = "someone/homebrew-tap"; }, /binding mismatch/],
]) {
  test(`refuses ${name}`, async () => {
    const { state, api, makePr } = fixture();
    state.pr = makePr();
    modify(state.pr);
    await assert.rejects(ensureFormulaPr(api, release), expected);
    assert.equal(state.writes.length, 0);
  });
}

test("merge gate accepts exact merged formula and both real macOS jobs, with empty GitHub PR links", async () => {
  const { state, api, merged } = fixture();
  merged();
  assert.equal((await verifyMergeGate(api, api, release)).number, 9);
  assert.equal(state.writes.length, 0);
});

for (const [name, modify, expected] of [
  ["open PR", (s) => { s.pr.merged = false; s.pr.state = "open"; }, /not merged/],
  ["missing PR", (s) => { s.pr = null; }, /PR is missing/],
  ["changed merged bytes", (s) => s.formulas.set("merge-sha", "changed"), /Merged formula differs/],
  ["newer tap main", (s) => { s.main = "new-main"; s.formulas.set(s.main, "newer"); }, /no longer contains/],
  ["merge outside main ancestry", (s) => { s.ancestry = "diverged"; }, /not on current tap main/],
  ["unrelated PR file", (s) => { s.pr.changed_files = 2; }, /unrelated changes/],
  ["failed CI", (s) => { s.run.conclusion = "failure"; }, /has not succeeded/],
  ["pending CI", (s) => { s.run.status = "in_progress"; }, /has not succeeded/],
  ["another CI SHA", (s) => { s.run.head_sha = "old-sha"; }, /has not succeeded/],
  ["another CI branch", (s) => { s.run.head_branch = "other"; }, /has not succeeded/],
  ["push CI", (s) => { s.run.event = "push"; }, /has not succeeded/],
  ["missing Intel job", (s) => { s.jobs.pop(); }, /x86_64/],
  ["failed architecture", (s) => { s.jobs[0].conclusion = "failure"; }, /arm64/],
  ["empty-tap skipped install", (s) => { s.jobs[0].steps[1].conclusion = "skipped"; }, /audit\/install\/test\/version/],
  ["skipped audit", (s) => { s.jobs[1].steps[0].conclusion = "skipped"; }, /x86_64/],
  ["newer failed CI run", (s) => { s.runs = [s.run, { ...s.run, id: 78, conclusion: "failure" }]; }, /has not succeeded/],
]) {
  test(`merge gate blocks ${name}`, async () => {
    const { state, api, merged } = fixture();
    merged();
    modify(state);
    await assert.rejects(verifyMergeGate(api, api, release), expected);
    assert.equal(state.writes.length, 0);
  });
}

test("release validation binds immutable asset digest, version, source and generated formula", async () => {
  const { api } = fixture();
  await verifyRelease(api, release, archive, checksums);
  await assert.rejects(verifyRelease(api, release, Buffer.from("other"), checksums), /checksum mismatch/);
  await assert.rejects(verifyRelease(api, { ...release, formula: formula.replace("a".repeat(64), "e".repeat(64)) }, archive, checksums), /generated release/);
  for (const modify of [
    (s) => { s.published.immutable = false; },
    (s) => { s.published.draft = true; },
    (s) => { s.published.assets[0].digest = `sha256:${"f".repeat(64)}`; },
    (s) => { s.sourceSha = "e".repeat(40); },
  ]) {
    const other = fixture();
    modify(other.state);
    await assert.rejects(verifyRelease(other.api, release, archive, checksums));
  }
});

test("transport scopes credentials, sends JSON, treats missing refs separately and never retries writes", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, ...options });
    return { ok: false, status: 401 };
  };
  await assert.rejects(github("secret-token", fetcher)(`${TAP}/pulls`, { method: "POST", body: { title: "release" } }), /HTTP 401/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].headers.Authorization, "Bearer secret-token");
  assert.equal(calls[0].body, '{"title":"release"}');
  await assert.rejects(github(undefined, fetcher)(`${TAP}/actions/runs`), /HTTP 401/);
  assert.equal(calls[1].headers.Authorization, undefined);
  const missing = github("secret-token", async () => ({ ok: false, status: 404 }));
  assert.equal(await missing("missing", { optional: true }), null);
  await assert.rejects(missing("required"), /HTTP 404/);
});

test("workflow blocks GHCR until gate passes and rechecks after protected environment approval", async () => {
  const workflow = await readFile(new URL("../.github/workflows/native-release.yml", import.meta.url), "utf8");
  const ghcr = workflow.split("\n  publish-ghcr:\n")[1];
  assert.match(ghcr, /needs: \[metadata, publish-release, homebrew-merge-gate\]/);
  assert.match(ghcr, /if: needs\.homebrew-merge-gate\.outputs\.merged == 'true'/);
  assert.match(ghcr, /environment: release/);
  assert.ok(ghcr.indexOf("node scripts/homebrew-pr.mjs gate") < ghcr.indexOf("name: Log in to GHCR"));
  assert.doesNotMatch(workflow, /git push origin HEAD:main/);
  assert.equal((workflow.match(/permission-pull-requests: read/g) ?? []).length, 2);
});

test("disabled publishing and expired artifacts stop the executable before any API request", () => {
  const script = fileURLToPath(new URL("../scripts/homebrew-pr.mjs", import.meta.url));
  const env = { PATH: process.env.PATH, RELEASE_TAG: release.tag, RELEASE_SHA: release.sha,
    GITHUB_RUN_ID: release.runId, GH_TOKEN: "fixture", TAP_TOKEN: "fixture" };
  for (const mode of ["open", "gate"]) {
    const disabled = spawnSync(process.execPath, [script, mode], { env: { ...env, HOMEBREW_TAP_PUBLISH_ENABLED: "false" }, encoding: "utf8" });
    assert.notEqual(disabled.status, 0);
    assert.match(disabled.stderr, /Homebrew publishing is disabled/);
    const expired = spawnSync(process.execPath, [script, mode], { env: { ...env, HOMEBREW_TAP_PUBLISH_ENABLED: "true" }, encoding: "utf8" });
    assert.notEqual(expired.status, 0);
    assert.match(expired.stderr, /ENOENT/);
  }
});

test("release binding rejects noncanonical tags and untrusted identifiers", () => {
  for (const override of [{ tag: "v01.0.3" }, { tag: "v0.0.3/other" }, { sha: "main" }, { runId: "123?other" }]) {
    assert.throws(() => releaseBinding({ tag: release.tag, sha: release.sha, runId: release.runId, formula, ...override }), /Invalid/);
  }
});
