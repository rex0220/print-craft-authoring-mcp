// pcraft_docs（手順と資料。実装案 5.5）: 目次（版の行、資料の元のコミット、作業の順・決まり、章の一覧）、章、大きい資料は見出しの一覧と query、
// 知らない章は名前の一覧を付けて誤り。作業フォルダーを使わない（未登録・未設定でも読める）。文章だけ
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, VERSION, connect, connectClaudeCode } from "./helpers.mjs";

const SOURCE = JSON.parse(readFileSync(path.join(ROOT, "references", "template", "SOURCE.json"), "utf8"));
const KEYS = ["navi", "howto-new", "howto-edit", "try", "results", "constraints", "usable", "deploy", "connections", "recipes", "patterns", "patterns-verified", "report-functions", "spec", "field-types", "function-list", "function-detail", "function-articles", "css-defaults", "sample-quote", "sample-list"];
const textOf = (r) => r.content.map((c) => c.text).join("\n");

test("目次: 1 行目に版、資料の元のコミット、作業の順と決まり（推し量らない）、章の一覧。作業フォルダーが未登録・zip が未設定でも読める。文章だけ", async () => {
  const s = await connect(["--surface", "claude-code", "--roots", ""], {});
  try {
    const { tools } = await s.client.listTools();
    const docs = tools.find((t) => t.name === "pcraft_docs");
    assert.equal(tools[0].name, "pcraft_docs", "最初に呼ぶツールを先頭に");
    assert.match(docs.description, /最初に呼ぶ/);
    assert.match(docs.description, /見積書・請求書/);
    assert.equal(docs.annotations.readOnlyHint, true);
    const r = await s.call("pcraft_docs", {});
    assert.notEqual(r.isError, true);
    assert.equal(r.structuredContent, undefined, "文章だけ");
    const t = textOf(r);
    assert.match(t.split("\n")[0], new RegExp(`^print-craft MCP ${VERSION.replace(/\./g, "\\.")}（中核`));
    assert.match(t, new RegExp(`資料の元: rex0220/print-craft-authoring ${SOURCE.short}`));
    assert.match(t, /推し量らない/);
    for (const k of KEYS) assert.match(t, new RegExp(`^- ${k} — `, "m"), k);
  } finally {
    await s.close();
  }
});

test("章: 手順は丸ごと、大きい資料は見出しの一覧（query で読む）。query は関数名がその節の最初の行にあるものを先に。知らない章は名前の一覧を付けて誤り", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const howto = textOf(await s.call("pcraft_docs", { section: "howto-new" }));
    assert.match(howto, /pcraft_save_settings/);
    assert.match(howto, /項目コード/);
    const recipes = textOf(await s.call("pcraft_docs", { section: "recipes" }));
    assert.match(recipes, /## 0\. 既定の形/);
    const big = textOf(await s.call("pcraft_docs", { section: "function-detail" }));
    assert.ok(big.length < 32 * 1024, `大きい資料は丸ごと返さない（${big.length}）`);
    assert.match(big, /query/);
    assert.match(big, /## 数値関連の関数/);
    const abs = textOf(await s.call("pcraft_docs", { section: "function-detail", query: "ABS" }));
    assert.match(abs.split("\n").slice(0, 4).join("\n"), /### ABS/, "関数名の節を先に");
    const any = textOf(await s.call("pcraft_docs", { query: "TABLE_HTML" }));
    assert.match(any, /\[report-functions/);
    assert.ok(any.length <= 26 * 1024);
    // 空白で区切った言葉は全部を含む節（順は問わない。0.3.0）
    for (const query of ["${ 改行", "改行 ${"]) {
      const multi = textOf(await s.call("pcraft_docs", { query }));
      assert.match(multi, /の中には\*\*改行と `\}` を書けない/, query);
    }
    const none = textOf(await s.call("pcraft_docs", { query: "NO_SUCH_FUNCTION_XYZ" }));
    assert.match(none, /合う節は無い/);
    const unknown = await s.call("pcraft_docs", { section: "howto" });
    assert.equal(unknown.isError, true);
    assert.equal(unknown.structuredContent.status, "invalid");
    assert.match(unknown.structuredContent.error.message, /howto-new、howto-edit/);
  } finally {
    await s.close();
  }
});

test("query の上限（0.2.1。formula MCP 0.2.3 と同じ）: 節は 40 まで（12 では M_* の 22 関数が打ち切られた）、文字数は 24 KiB まで", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const head = (t) => t.split("\n")[0];
    const countOf = (t) => Number(head(t).match(/合う節 (\d+) 件/)[1]);
    const blocks = (t) => t.slice(t.indexOf(":\n\n") + 3).split("\n\n---\n\n");
    const m = textOf(await s.call("pcraft_docs", { section: "function-list", query: "M_" }));
    assert.ok(countOf(m) > 12 && countOf(m) <= 40, head(m));
    assert.doesNotMatch(head(m), /打ち切った/);
    assert.equal(blocks(m).length, countOf(m), "合う節をすべて返す");
    const many = textOf(await s.call("pcraft_docs", { section: "function-list", query: "_" }));
    assert.match(head(many), /打ち切った/);
    assert.ok(countOf(many) > 40, head(many));
    assert.equal(blocks(many).length, 40, "節の数の上限");
    const big = textOf(await s.call("pcraft_docs", { query: "TABLE_" }));
    assert.match(head(big), /打ち切った/);
    const bs = blocks(big);
    assert.ok(bs.length < 40, `文字数で打ち切る（${bs.length} 節）`);
    assert.ok(bs.reduce((n, b) => n + b.length, 0) <= 24 * 1024);
  } finally {
    await s.close();
  }
});

// 締めの文（0.2.1。formula MCP 0.3.2・0.3.4 と同じ決まり）: 取り込み方は設定画面の言葉のまま。言葉は fixture（印刷屋の設定画面の取り込み方の名前の写し）と比べる
const IMPORT_MODES = JSON.parse(readFileSync(path.join(ROOT, "test", "fixtures", "import-modes.json"), "utf8"));
test("締めの文: サーバーの指示と目次に同じ決まり（設定画面の言葉のまま・言い換えない・分からなければ両方の場合）。deploy の章も同じ言葉（0.2.1）", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const instructions = String(s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions);
    const index = textOf(await s.call("pcraft_docs", {}));
    const ruleOf = (t) => t.split("\n").find((l) => l.startsWith("- 設定を作った・変えた作業の最後に必ず反映方法を伝える"));
    const a = ruleOf(instructions);
    const b = ruleOf(index);
    assert.ok(a && b, "指示と目次の両方にある");
    assert.equal(b.replace("（deploy）", ""), a, "指示と目次で同じ文");
    assert.ok(a.includes(`設定画面の言葉（${IMPORT_MODES.ja.join(" / ")}）`), a);
    assert.match(a, /言い換えない/);
    // 3 つの場合（0.3.0。0.2.1 の Desktop の確かめで「全置換」の場合が抜けた。print-craft の docs/authoring-try-plan.md 4.4）
    assert.match(a, /印刷屋の設定が無いアプリは全置換、ボタンを足すなら追加、既存のボタンを差し替えるなら一部置換/);
    assert.match(a, /両方の場合を書く/);
    assert.match(a, /説明だけの答えには付けない/);
    const deploy = textOf(await s.call("pcraft_docs", { section: "deploy" }));
    for (const w of IMPORT_MODES.ja) assert.ok(deploy.includes(`「${w}」`), w);
    assert.match(deploy, /言い換えない/);
    assert.match(deploy, /両方の場合を書く/);
  } finally {
    await s.close();
  }
});

// 使い方ナビ（0.3.0）: 指示と目次とツールの説明に、使い方・できること・頼み方を聞かれたら navi で答える決まり。章に帳票の種類と、今の帳票の変え方
test("使い方ナビ: 指示・目次・pcraft_docs の説明に navi の決まり。章に帳票の種類、頼み方の例、今の帳票を変える流れ（一部置換）", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const instructions = String(s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions);
    const index = textOf(await s.call("pcraft_docs", {}));
    const { tools } = await s.client.listTools();
    const description = tools.find((t) => t.name === "pcraft_docs").description;
    for (const t of [instructions, index, description]) assert.match(t, /使い方・できること（帳票の種類）・頼み方・今の帳票の変え方を聞かれたら/);
    const navi = textOf(await s.call("pcraft_docs", { section: "navi" }));
    for (const w of ["見積書・注文書・請求書・納品書", "一覧表（一覧帳票）", "工程表", "## 3. 頼み方（新しい帳票）", "## 4. 今の帳票を変える", "一部置換", "qiita.com/rex0220/items"]) assert.ok(navi.includes(w), w);
  } finally {
    await s.close();
  }
});

// 返答の言語（0.3.0。0.3.0-dev.5 の Desktop の確かめで答えの先頭に英語の文が出た。Desktop にはテンプレートの CLAUDE.md が届かない）
test("返答の言語の決まりが、サーバーの指示と目次の両方にある", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const instructions = String(s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions);
    const index = textOf(await s.call("pcraft_docs", {}));
    for (const t of [instructions, index]) assert.match(t, /途中の経過も含めて利用者の言語で書く（日本語の依頼には日本語。英語の文を挟まない）/);
  } finally {
    await s.close();
  }
});

// pcraft_try の使う場面（0.3.0。print-craft の docs/authoring-try-plan.md 4.3）: 指示・目次・ツールの説明・try の章で同じ決まり
test("pcraft_try の使う場面の決まりが、サーバーの指示・目次・ツールの説明・try の章で同じ", async () => {
  const s = await connectClaudeCode([], {});
  try {
    const instructions = String(s.client.getInstructions?.() ?? s.client.getDiscoverResult?.()?.instructions);
    const index = textOf(await s.call("pcraft_docs", {}));
    const { tools } = await s.client.listTools();
    const description = tools.find((t) => t.name === "pcraft_try").description;
    const chapter = textOf(await s.call("pcraft_docs", { section: "try" }));
    for (const [name, t] of Object.entries({ instructions, index, description, chapter })) {
      assert.ok(t.includes("利用者が動きの確認を求めたとき、資料に無い値や端の動き（空・0・改行・改ページ）を断言するとき、資料と自分の理解が食い違うとき、設定を作る前に帳票の形を試すとき"), name);
      assert.match(t, /`?formulas`? 10 件まで、または `?button`? 1 つ/, name);
      assert.match(t, /続けて呼ばない/, name);
      assert.match(t, /お試しアプリの項目コードを利用者の設定に書かない|項目コードはお試しアプリのもので、利用者の設定に書かない/, name);
      assert.match(t, /資料/, name);
    }
  } finally {
    await s.close();
  }
});

const MESSAGES = path.resolve(ROOT, "..", "print-craft", "src", "config", "messages.ts");
test("fixture の取り込み方の名前が、印刷屋の設定画面（messages.ts の importMode*）と同じ", { skip: existsSync(MESSAGES) ? false : `print-craft が無い: ${MESSAGES}` }, () => {
  const src = readFileSync(MESSAGES, "utf8");
  const ja = ["importModeAll", "importModeReplace", "importModeAdd"].map((k) => src.match(new RegExp(`${k}: \\{ ja: "([^"]+)"`))?.[1]);
  assert.deepEqual(ja, IMPORT_MODES.ja);
});
