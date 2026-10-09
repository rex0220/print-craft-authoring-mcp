// 互換表（compat.json。実装案 7 章）: ビルドの組み合わせが合わなければビルドを止める。合わない互換表のビルド（試験用の --no-compat-check）では、
// 作業フォルダーを使うツールが incompatible、pcraft_docs / pcraft_status / pcraft_workspace_status は止めない。印刷屋の zip の版の上限を超えたら incompatible
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, SKIP as skip, VERSION, connectClaudeCode, makeWorkspace, saveInput, sc } from "./helpers.mjs";

const COMPAT = JSON.parse(readFileSync(path.join(ROOT, "compat.json"), "utf8"));

function buildWith(compat, extra = []) {
  const dir = realpathSync(mkdtempSync(path.join(os.tmpdir(), "pcraft-mcp-compat-")));
  const file = path.join(dir, "compat.json");
  writeFileSync(file, JSON.stringify(compat));
  const r = spawnSync(process.execPath, [path.join(ROOT, "build-mcp.mjs"), "--out", path.join(dir, "dist"), "--compat", file, ...extra], { encoding: "utf8" });
  return { dir, server: path.join(dir, "dist", "server", "index.cjs"), status: r.status, output: `${r.stdout}${r.stderr}` };
}

test("今の compat.json は今のビルドと合う（mcpVersion、資料の元）", () => {
  assert.equal(COMPAT.schemaVersion, 1);
  assert.equal(COMPAT.runtimeChecks.mcpVersion, VERSION);
  const source = JSON.parse(readFileSync(path.join(ROOT, "references", "template", "SOURCE.json"), "utf8"));
  assert.equal(COMPAT.runtimeChecks.docsRevision, source.short);
});

test("ビルドの組み合わせが互換表と合わなければ、ビルドを止める", () => {
  const b = buildWith({ ...COMPAT, runtimeChecks: { ...COMPAT.runtimeChecks, coreVersion: ">=9.0.0" } });
  try {
    assert.notEqual(b.status, 0);
    assert.match(b.output, /互換表とビルドの組み合わせが合わない.*中核の版/);
  } finally {
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("合わない互換表のビルド: 作業フォルダーを使うツールは incompatible、資料・診断は読める", { skip }, async () => {
  const b = buildWith({ ...COMPAT, runtimeChecks: { ...COMPAT.runtimeChecks, docsRevision: "0000000" } }, ["--no-compat-check"]);
  assert.equal(b.status, 0, b.output);
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], undefined, { server: b.server });
  try {
    const st = sc(await s.call("pcraft_status", {}));
    assert.equal(st.result.ready, false);
    assert.match(st.result.next.join("\n"), /互換表と合わない.*docsRevision/);
    assert.notEqual((await s.call("pcraft_docs", {})).isError, true);
    assert.equal(sc(await s.call("pcraft_workspace_status", { workspaceId: root })).status, "ok");
    for (const [tool, input] of [["pcraft_save_settings", saveInput(root, "settings/a.json")], ["pcraft_buttons", { workspaceId: root, path: "settings/a.json" }], ["pcraft_fields", { workspaceId: root, app: 1 }]]) {
      const r = sc(await s.call(tool, input));
      assert.deepEqual([r.status, r.error.code], ["incompatible", "IncompatibleError"], tool);
    }
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});

test("印刷屋の zip の版が互換表の上限を超えたら incompatible（上限は書いていないが、書けば効く）", { skip }, async () => {
  const b = buildWith({ ...COMPAT, runtimeChecks: { ...COMPAT.runtimeChecks, pluginVersion: { min: 6, max: 6 } } });
  assert.equal(b.status, 0, b.output);
  const root = makeWorkspace();
  const s = await connectClaudeCode([root], undefined, { server: b.server });
  try {
    const r = sc(await s.call("pcraft_save_settings", saveInput(root, "settings/a.json")));
    assert.deepEqual([r.status, r.error.code], ["incompatible", "IncompatibleError"]);
    assert.match(r.error.message, /版 7 は.*Ver\.6 まで/);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(b.dir, { recursive: true, force: true });
  }
});
