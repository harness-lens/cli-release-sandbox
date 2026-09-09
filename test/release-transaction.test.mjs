// SPDX-License-Identifier: MPL-2.0
// Copyright © 2026 Cristian Camargo Filho

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  MANIFEST_NAME,
  REPOSITORY,
  generateManifest,
  loadCandidate,
  preflightNewRelease,
  prepareDraft,
  publishDraft,
  requireUnusedNpmVersion,
  releaseIdentity,
  verifyRemoteAssets,
} from "../scripts/release-transaction.mjs";

const hash = (value) => createHash("sha256").update(value).digest("hex");
const identity = releaseIdentity({
  repository: REPOSITORY,
  version: "0.0.5",
  sourceSha: "a".repeat(40),
  workflowSha: "b".repeat(40),
  runId: "123",
  runAttempt: "1",
});

async function candidateFixture() {
  const directory = await mkdtemp(join(tmpdir(), "harness-lens-release-"));
  await writeFile(join(directory, "harness-lens-v0.0.5-linux.tar.gz"), "linux bytes");
  await writeFile(join(directory, "SHA256SUMS"), `${hash("linux bytes")}  harness-lens-v0.0.5-linux.tar.gz\n`);
  await generateManifest(directory, identity);
  return loadCandidate(directory);
}

function remoteFixture(candidate) {
  const state = {
    main: identity.sourceSha,
    publishImmutable: true,
    tag: null,
    release: null,
    writes: [],
    uploads: [],
  };
  const api = async (path, options = {}) => {
    if (options.method) state.writes.push({ path, ...options });
    const local = path.replace(`${REPOSITORY}/`, "");
    if (local === "git/ref/heads/main") return { object: { type: "commit", sha: state.main } };
    if (local.startsWith("compare/")) return { status: state.comparison ?? "ahead" };
    if (local === `git/ref/tags/${identity.tag}`) return state.tag;
    if (local.startsWith("git/tags/")) return state.annotatedTag;
    if (local === "releases?per_page=100") return state.release ? [state.release] : [];
    if (local === "releases" && options.method === "POST") {
      state.release = {
        id: 7,
        tag_name: options.body.tag_name,
        name: options.body.name,
        body: options.body.body,
        draft: true,
        prerelease: false,
        immutable: false,
        assets: [],
      };
      return state.release;
    }
    if (local === "releases/7" && options.method === "PATCH") {
      state.release = { ...state.release, draft: false, immutable: state.publishImmutable };
      state.tag = { object: { type: "commit", sha: identity.sourceSha } };
      return state.release;
    }
    if (local === "releases/7") return state.release;
    throw new Error(`Unexpected API call: ${path}`);
  };
  const upload = async (releaseId, asset) => {
    assert.equal(releaseId, 7);
    state.uploads.push(asset.name);
    state.release.assets.push({
      name: asset.name,
      size: asset.size,
      digest: `sha256:${asset.sha256}`,
      state: "uploaded",
    });
  };
  const bindDraft = async (assets = []) => {
    await prepareDraft(api, upload, candidate);
    state.release.assets = assets;
    state.uploads.length = 0;
    state.writes.length = 0;
  };
  return { state, api, upload, bindDraft };
}

test("manifest deterministically binds every candidate file and its workflow provenance", async () => {
  const candidate = await candidateFixture();
  assert.deepEqual(candidate.manifest.assets.map((asset) => asset.name), [
    "harness-lens-v0.0.5-linux.tar.gz",
    "SHA256SUMS",
  ].sort());
  assert.deepEqual(releaseIdentity(candidate.manifest), identity);
  assert.equal(candidate.assets.some((asset) => asset.name === MANIFEST_NAME), true);
  const stored = JSON.parse(await readFile(join(candidate.directory, MANIFEST_NAME), "utf8"));
  assert.equal(stored.sourceSha, identity.sourceSha);
  assert.equal(stored.workflowSha, identity.workflowSha);
  assert.equal(stored.runId, identity.runId);
});

test("candidate verification rejects changed, missing, or unexpected bytes", async () => {
  for (const change of [
    async (candidate) => writeFile(join(candidate.directory, "SHA256SUMS"), "changed"),
    async (candidate) => writeFile(join(candidate.directory, "unexpected.zip"), "unexpected"),
  ]) {
    const candidate = await candidateFixture();
    await change(candidate);
    await assert.rejects(loadCandidate(candidate.directory), /do not match/u);
  }
});

test("candidate verification requires SHA256SUMS to cover every payload exactly", async () => {
  for (const contents of [
    `${"a".repeat(64)}  harness-lens-v0.0.5-linux.tar.gz\n`,
    `${hash("linux bytes")}  ../harness-lens-v0.0.5-linux.tar.gz\n`,
    `${hash("linux bytes")}  harness-lens-v0.0.5-linux.tar.gz\n${hash("extra")}  extra.zip\n`,
  ]) {
    const candidate = await candidateFixture();
    await writeFile(join(candidate.directory, "SHA256SUMS"), contents);
    await generateManifest(candidate.directory, identity);
    await assert.rejects(loadCandidate(candidate.directory), /SHA256SUMS/u);
  }
});

test("new-release preflight is read-only and rejects every conflicting release identity", async () => {
  const candidate = await candidateFixture();
  const { state, api } = remoteFixture(candidate);
  await preflightNewRelease(api, identity);
  assert.equal(state.writes.length, 0);
  state.comparison = "diverged";
  state.main = "c".repeat(40);
  await assert.rejects(preflightNewRelease(api, identity), /ancestor/u);
  state.main = identity.sourceSha;
  state.tag = { object: { type: "commit", sha: identity.sourceSha } };
  await assert.rejects(preflightNewRelease(api, identity), /tag .* already exists/u);
  state.tag = null;
  state.release = { tag_name: identity.tag };
  await assert.rejects(preflightNewRelease(api, identity), /Release .* already exists/u);
});

test("publisher creates one bound draft, uploads only missing assets, and retry is idempotent", async () => {
  const candidate = await candidateFixture();
  const { state, api, upload } = remoteFixture(candidate);
  const draft = await prepareDraft(api, upload, candidate);
  assert.equal(draft.draft, true);
  assert.match(draft.body, new RegExp(identity.sourceSha));
  assert.deepEqual(state.uploads.sort(), candidate.assets.map((asset) => asset.name).sort());
  assert.deepEqual(state.writes.map((write) => [write.method, write.path]), [["POST", `${REPOSITORY}/releases`]]);

  state.uploads.length = 0;
  state.writes.length = 0;
  await prepareDraft(api, upload, candidate);
  assert.deepEqual(state.uploads, []);
  assert.deepEqual(state.writes, []);
});

test("publisher resumes a matching partial draft without replacing uploaded bytes", async () => {
  const candidate = await candidateFixture();
  const { state, api, upload } = remoteFixture(candidate);
  await prepareDraft(api, upload, candidate);
  const retained = state.release.assets[0];
  state.release.assets = [retained];
  state.uploads.length = 0;
  state.writes.length = 0;
  await prepareDraft(api, upload, candidate);
  assert.equal(state.uploads.includes(retained.name), false);
  assert.equal(state.uploads.length, candidate.assets.length - 1);
  assert.equal(state.writes.length, 0);
});

test("ambiguous create, upload, and publish responses reconcile without duplicate mutations", async () => {
  const candidate = await candidateFixture();

  const created = remoteFixture(candidate);
  await assert.rejects(prepareDraft(async (...args) => {
    const result = await created.api(...args);
    if (args[0] === `${REPOSITORY}/releases`) throw new Error("connection lost after draft creation");
    return result;
  }, created.upload, candidate), /connection lost/u);
  await prepareDraft(created.api, created.upload, candidate);
  assert.equal(created.state.writes.filter((write) => write.path === `${REPOSITORY}/releases`).length, 1);

  const uploaded = remoteFixture(candidate);
  let interrupted = false;
  await assert.rejects(prepareDraft(uploaded.api, async (...args) => {
    await uploaded.upload(...args);
    if (!interrupted) {
      interrupted = true;
      throw new Error("connection lost after asset upload");
    }
  }, candidate), /connection lost/u);
  const retained = uploaded.state.release.assets[0].name;
  uploaded.state.uploads.length = 0;
  await prepareDraft(uploaded.api, uploaded.upload, candidate);
  assert.equal(uploaded.state.uploads.includes(retained), false);

  const published = remoteFixture(candidate);
  await prepareDraft(published.api, published.upload, candidate);
  await assert.rejects(publishDraft(async (...args) => {
    const result = await published.api(...args);
    if (args[1]?.method === "PATCH") throw new Error("connection lost after publication");
    return result;
  }, candidate), /connection lost/u);
  published.state.writes.length = 0;
  assert.equal((await publishDraft(published.api, candidate)).immutable, true);
  assert.deepEqual(published.state.writes, []);
});

test("publisher fails closed for unknown, duplicate, changed, or published draft assets", async () => {
  const candidate = await candidateFixture();
  for (const change of [
    (state) => state.release.assets.push({ name: "unknown.zip", state: "uploaded", size: 1, digest: `sha256:${"c".repeat(64)}` }),
    (state) => state.release.assets.push({ ...state.release.assets[0] }),
    (state) => { state.release.assets[0].digest = `sha256:${"d".repeat(64)}`; },
    (state) => { state.release.draft = false; state.release.immutable = true; },
  ]) {
    const fixture = remoteFixture(candidate);
    await fixture.bindDraft([...candidate.assets.map((asset) => ({
      name: asset.name, size: asset.size, digest: `sha256:${asset.sha256}`, state: "uploaded",
    }))]);
    change(fixture.state);
    await assert.rejects(prepareDraft(fixture.api, fixture.upload, candidate), /Unexpected|Duplicate|conflicts|not a mutable draft/u);
    assert.equal(fixture.state.uploads.length, 0);
    assert.equal(fixture.state.writes.length, 0);
  }
});

test("publisher rejects conflicting provenance and tag targets before asset mutation", async () => {
  const candidate = await candidateFixture();
  for (const change of [
    (state) => { state.release.body = "different run"; },
    (state) => { state.release.name = "Different title"; },
    (state) => { state.tag = { object: { type: "commit", sha: "f".repeat(40) } }; },
  ]) {
    const fixture = remoteFixture(candidate);
    await fixture.bindDraft([]);
    change(fixture.state);
    await assert.rejects(prepareDraft(fixture.api, fixture.upload, candidate), /binding|title|different source/u);
    assert.equal(fixture.state.uploads.length, 0);
    assert.equal(fixture.state.writes.length, 0);
  }
});

test("publication crosses the immutable boundary only after an exact complete draft", async () => {
  const candidate = await candidateFixture();
  const { state, api, upload } = remoteFixture(candidate);
  await prepareDraft(api, upload, candidate);
  state.writes.length = 0;
  const published = await publishDraft(api, candidate);
  assert.equal(published.immutable, true);
  assert.equal(published.draft, false);
  assert.deepEqual(state.writes.map((write) => [write.method, write.path]), [["PATCH", `${REPOSITORY}/releases/7`]]);

  state.writes.length = 0;
  await publishDraft(api, candidate);
  assert.deepEqual(state.writes, []);

  const mutable = remoteFixture(candidate);
  mutable.state.publishImmutable = false;
  await prepareDraft(mutable.api, mutable.upload, candidate);
  await assert.rejects(publishDraft(mutable.api, candidate), /did not become immutable/u);
});

test("runtime transaction uses no administration-only immutable-release settings endpoint", async () => {
  const source = await readFile(new URL("../scripts/release-transaction.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /immutable-releases/u);
  assert.match(source, /release\.immutable === true/u);
});

test("remote inventory verification requires exact names, sizes, states, and digests", () => {
  const expected = [{ name: "asset.zip", size: 10, sha256: "e".repeat(64) }];
  const exact = [{ name: "asset.zip", size: 10, state: "uploaded", digest: `sha256:${"e".repeat(64)}` }];
  assert.deepEqual(verifyRemoteAssets(exact, expected), []);
  assert.throws(() => verifyRemoteAssets([], expected), /missing/u);
  for (const remote of [
    [{ ...exact[0], size: 11 }],
    [{ ...exact[0], state: "new" }],
    [{ ...exact[0], digest: `sha256:${"f".repeat(64)}` }],
  ]) assert.throws(() => verifyRemoteAssets(remote, expected), /conflicts/u);
});

test("release identity rejects noncanonical or untrusted workflow input", () => {
  for (const override of [
    { repository: "not-a-repository" },
    { version: "01.0.0" },
    { tag: "0.0.5" },
    { sourceSha: "main" },
    { workflowSha: "workflow.yml" },
    { runId: "0" },
    { runAttempt: "1?retry" },
  ]) assert.throws(() => releaseIdentity({ ...identity, ...override }), /Invalid|must/u);
});

test("npm preflight distinguishes an unused version from conflicts and outages", async () => {
  await requireUnusedNpmVersion(identity.version, async () => ({ status: 404, ok: false }));
  await assert.rejects(
    requireUnusedNpmVersion(identity.version, async () => ({ status: 200, ok: true })),
    /already published/u,
  );
  await assert.rejects(
    requireUnusedNpmVersion(identity.version, async () => ({ status: 503, ok: false })),
    /preflight failed/u,
  );
});

test("workflow has one production trigger and one protected release App writer", async () => {
  const workflow = await readFile(new URL("../.github/workflows/native-release.yml", import.meta.url), "utf8");
  const npmWorkflow = await readFile(new URL("../.github/workflows/publish.yml", import.meta.url), "utf8");
  assert.match(workflow, /on:\n  workflow_dispatch:/u);
  assert.doesNotMatch(workflow, /\n  push:/u);
  assert.match(npmWorkflow, /on:\n  workflow_call:/u);
  assert.doesNotMatch(npmWorkflow, /\n  release:/u);
  assert.equal((workflow.match(/^      contents: write$/gm) ?? []).length, 0);
  const publisher = workflow.split("\n  publish-release:\n")[1].split("\n  publish-npm:\n")[0];
  assert.match(publisher, /environment: release/u);
  assert.match(publisher, /Mint repository-scoped release token/u);
  assert.match(publisher, /actions\/create-github-app-token@[a-f0-9]{40}/u);
  assert.match(publisher, /app-id: \$\{\{ secrets\.HARNESS_LENS_APP_ID \}\}/u);
  assert.match(publisher, /private-key: \$\{\{ secrets\.HARNESS_LENS_APP_PRIVATE_KEY \}\}/u);
  assert.match(publisher, /permission-contents: write/u);
  assert.equal((publisher.match(/GH_TOKEN: \$\{\{ steps\.release-app-token\.outputs\.token \}\}/g) ?? []).length, 2);
  assert.doesNotMatch(publisher, /GH_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(publisher, /release-transaction\.mjs prepare/u);
  assert.match(publisher, /release-transaction\.mjs publish/u);
  assert.equal((publisher.match(/RELEASE_RUN_ATTEMPT: \$\{\{ needs\.assemble-release\.outputs\.candidate_attempt \}\}/g) ?? []).length, 3);
  assert.ok(publisher.indexOf("prepare") < publisher.indexOf("publish"));
  assert.match(workflow, /publish-npm:[\s\S]*needs: \[metadata, assemble-release, publish-release\][\s\S]*uses: \.\/\.github\/workflows\/publish\.yml/u);
  assert.match(workflow, /publish-npm:[\s\S]*if: github\.repository == 'harness-lens\/cli'[\s\S]*uses: \.\/\.github\/workflows\/publish\.yml/u);
  for (const job of ["publish-homebrew-tap", "homebrew-merge-gate", "publish-ghcr"]) {
    const section = workflow.split(`\n  ${job}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]+:\n/u)[0] ?? "";
    assert.match(section, /environment: release/u);
  }
});
