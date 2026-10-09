// pcraft_workspace_status（作業フォルダーの診断。実装案 5.1 ③、13.3）: 照合は通す（未登録は denied）。environments.json の有無、環境の role、
// role の無い環境、読めない environments.json。読み取りだけ（ファイルを作らない）
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SKIP as skip, connectClaudeCode, connectDesktop, makeWorkspace, sc } from "./helpers.mjs";

test("environments.json が無い作業フォルダー（今の 1 環境の使い方）: 準備ができている", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    const r = sc(await s.call("pcraft_workspace_status", { workspaceId: root }));
    assert.equal(r.status, "ok");
    assert.equal(r.result.workspace, root);
    assert.deepEqual(r.result.environmentsJson, { exists: false });
    assert.equal(r.result.ready, true, JSON.stringify(r.result.next));
    assert.deepEqual(readdirSync(root), ["fields"], "診断は何も作らない");
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("環境の role を返し、role の無い環境は next に出す。読めない environments.json は problem（利用者が直す）", { skip }, async () => {
  const root = makeWorkspace();
  const s = await connectClaudeCode([root]);
  try {
    writeFileSync(path.join(root, "environments.json"), JSON.stringify({ default: "dev", environments: { dev: { baseUrl: "https://dev-x.cybozu.com" }, prod: { baseUrl: "https://x.cybozu.com", role: "production" } }, apps: [{ name: "見積書", dev: 101, prod: 3740 }] }));
    const r = sc(await s.call("pcraft_workspace_status", { workspaceId: root }));
    assert.equal(r.status, "ok");
    assert.deepEqual(r.result.environmentsJson.environments.list, [
      { name: "dev", role: "unclassified", host: "dev-x.cybozu.com" },
      { name: "prod", role: "production", host: "x.cybozu.com" }
    ]);
    assert.equal(r.result.ready, false);
    assert.match(r.result.next.join("\n"), /環境 dev に role が無い/);
    writeFileSync(path.join(root, "environments.json"), "{ broken");
    const bad = sc(await s.call("pcraft_workspace_status", { workspaceId: root }));
    assert.equal(bad.status, "ok", "診断そのものは成功（読めないことを伝える）");
    assert.match(bad.result.environmentsJson.problem, /JSON として読めない/);
    assert.match(bad.result.next.join("\n"), /利用者が直す。AI は書かない/);
  } finally {
    await s.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("未登録の workspaceId は denied（照合は通す）。Desktop では workspaceId を省略できる", { skip }, async () => {
  const root = makeWorkspace();
  const other = makeWorkspace("pcraft-mcp-other-");
  const s = await connectClaudeCode([root]);
  try {
    const r = await s.call("pcraft_workspace_status", { workspaceId: other });
    assert.deepEqual([sc(r).status, sc(r).error.code], ["denied", "WorkspaceError"]);
  } finally {
    await s.close();
  }
  const d = await connectDesktop(root);
  try {
    const r = sc(await d.call("pcraft_workspace_status", {}));
    assert.deepEqual([r.status, r.result.workspace], ["ok", root]);
  } finally {
    await d.close();
    rmSync(root, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});
