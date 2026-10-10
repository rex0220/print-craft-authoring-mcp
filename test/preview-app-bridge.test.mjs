// preview の MCP App の殻とホストの通しの試験（Codex の MCP App のレビュー MINOR 3）: ext-apps の AppBridge（ホスト側）と殻の App を
// 同じプロセスの InMemoryTransport でつなぎ、握手、結果の _meta の受け取りと描画、autoResize の大きさの通知、全画面の要求と応答、
// ホストの文脈の表示の形（初めから全画面、ホストが変えたとき）、取り消しを確かめる。殻は happy-dom の文書に描く
// （ext-apps の App は window・document・requestAnimationFrame・ResizeObserver を大域から使うので、この試験のプロセスの大域に置く）。
// Codex の最終の確認 MINOR 2: 握手で宣言する表示の形、帳票を描いた後の大きさの通知、ホストが全画面に対応しなくなったときのボタン。
// happy-dom は大きさを測らず ResizeObserver も呼ばないので、文書の高さ（帳票があれば 1300、無ければ 40）と ResizeObserver を試験で作る
import { test } from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { InMemoryTransport } from "@modelcontextprotocol/client";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";
import { startPreviewApp } from "../src/ui/preview-controller.ts";
import { MESSAGES } from "../src/ui/preview-view.ts";
import { PREVIEW_META_KEY } from "../src/preview-payload.ts";

const win = new Window({ width: 1024, height: 768 });
/** 試験で呼べる ResizeObserver（App が文書の大きさを見張る。呼ぶと App が測り直して、変わっていればホストに知らせる） */
const resizeCallbacks = [];
class TestResizeObserver {
  constructor(cb) {
    resizeCallbacks.push(cb);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
const contentHeight = () => (win.document.querySelector("#root iframe") ? 1300 : 40);
win.document.documentElement.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 1024, height: contentHeight(), right: 1024, bottom: contentHeight(), toJSON() {} });
Object.assign(globalThis, { window: win, document: win.document, requestAnimationFrame: (cb) => setTimeout(() => cb(Date.now()), 0), ResizeObserver: TestResizeObserver });
test.after(() => win.close());

const INNER = "<!doctype html><p>帳票</p>";
const PAYLOAD = { version: 1, buttons: [{ menu: "見積書", fileName: "見積書.pdf", paper: "A4 縦 96 dpi", pages: 1, width: 834, height: 1203, errors: [], inner: INNER }] };
const BOTH = ["inline", "fullscreen"];

/** 条件が満たされるまで待つ（通知は非同期で届く） */
async function waitFor(cond, what) {
  for (let i = 0; i < 200; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`待ちきれなかった: ${what}`);
}

/** ホスト（AppBridge）と殻をつなぐ。表示の形の要求はホストがそのまま受け入れ、ホストの文脈も変える（実際のホストと同じ） */
async function connect(hostContext) {
  resizeCallbacks.length = 0; // 前の試験の App（閉じた）は呼ばない
  const doc = win.document;
  doc.body.innerHTML = '<div id="toolbar"></div><div id="root"></div>';
  const root = doc.getElementById("root");
  const toolbar = doc.getElementById("toolbar");
  const [hostSide, appSide] = InMemoryTransport.createLinkedPair();
  const bridge = new AppBridge(null, { name: "test-host", version: "1" }, {}, { hostContext });
  const sizes = [];
  const modes = [];
  bridge.onsizechange = (p) => sizes.push(p);
  let context = hostContext;
  const setContext = (patch) => {
    context = { ...context, ...patch };
    bridge.setHostContext(context);
  };
  const setMode = (mode) => setContext({ displayMode: mode });
  bridge.onrequestdisplaymode = async ({ mode }) => {
    modes.push(mode);
    setMode(mode);
    return { mode };
  };
  const initialized = new Promise((resolve) => (bridge.oninitialized = resolve));
  await bridge.connect(hostSide);
  const { app, connected } = startPreviewApp({ root, toolbar, win, transport: appSide });
  await connected;
  await initialized;
  // 閉じる前に、描き直しで起きた大きさの通知（requestAnimationFrame）を送り終える
  const close = async () => {
    await new Promise((r) => setTimeout(r, 30));
    await app.close();
    await bridge.close();
  };
  const resize = () => resizeCallbacks.forEach((cb) => cb([]));
  return { bridge, root, toolbar, sizes, modes, setMode, setContext, resize, close };
}

test("握手 → 結果の _meta の帳票を sandbox の iframe に描く、autoResize で大きさを知らせる、全画面の要求と応答でボタンの文が変わる", async () => {
  const h = await connect({ displayMode: "inline", availableDisplayModes: BOTH });
  try {
    assert.equal(h.root.textContent, MESSAGES.waiting, "結果の前は待っている文");
    assert.deepEqual(h.bridge.getAppCapabilities()?.availableDisplayModes, ["inline", "fullscreen"], "対応する表示の形を握手で宣言する");
    await waitFor(() => h.sizes.length > 0, "大きさの通知");
    assert.deepEqual(h.sizes.at(-1), { width: 1024, height: 40 });
    const before = h.sizes.length;
    await h.bridge.sendToolResult({ content: [{ type: "text", text: "{}" }], structuredContent: { status: "ok" }, _meta: { [PREVIEW_META_KEY]: PAYLOAD } });
    await waitFor(() => h.root.querySelector("iframe"), "帳票の iframe");
    h.resize();
    await waitFor(() => h.sizes.length > before, "帳票を描いた後の大きさの通知");
    assert.deepEqual(h.sizes.at(-1), { width: 1024, height: 1300 }, "帳票の高さを知らせる");
    const iframe = h.root.querySelector("iframe");
    assert.equal(iframe.getAttribute("sandbox"), "");
    assert.equal(iframe.getAttribute("srcdoc"), INNER);
    assert.equal(h.root.querySelector("h2").textContent, "見積書");
    const button = h.toolbar.querySelector("button");
    assert.equal(button.textContent, "全画面");
    button.click();
    await waitFor(() => button.textContent === "元の大きさ", "全画面になった文");
    button.click();
    await waitFor(() => button.textContent === "全画面", "元に戻った文");
    assert.deepEqual(h.modes, ["fullscreen", "inline"]);
  } finally {
    await h.close();
  }
});

test("ホストが初めから全画面なら、ボタンは「元の大きさ」で押すと inline を求める。ホストが表示の形を変えたら文を合わせる", async () => {
  const h = await connect({ displayMode: "fullscreen", availableDisplayModes: BOTH });
  try {
    const button = h.toolbar.querySelector("button");
    assert.equal(button.textContent, "元の大きさ");
    button.click();
    await waitFor(() => button.textContent === "全画面", "inline になった文");
    assert.deepEqual(h.modes, ["inline"]);
    h.setMode("fullscreen");
    await waitFor(() => button.textContent === "元の大きさ", "ホストが全画面にした");
    h.setMode("inline");
    await waitFor(() => button.textContent === "全画面", "ホストが全画面を閉じた");
    assert.deepEqual(h.modes, ["inline"], "ホストが変えたときは要求を出さない");
  } finally {
    await h.close();
  }
});

test("全画面に対応しないホストではボタンを出さない（対応が変われば出し入れする）。_meta が無い結果は決まった文、取り消しも決まった文", async () => {
  const h = await connect({ displayMode: "inline", availableDisplayModes: ["inline"] });
  try {
    assert.equal(h.toolbar.querySelector("button"), null);
    // ホストが全画面に対応するようになったらボタンを出し、対応しなくなったら外す
    h.setContext({ availableDisplayModes: BOTH });
    await waitFor(() => h.toolbar.querySelector("button")?.textContent === "全画面", "ボタンが出る");
    h.setContext({ availableDisplayModes: ["inline"] });
    await waitFor(() => h.toolbar.querySelector("button") === null, "ボタンが外れる");
    await h.bridge.sendToolResult({ content: [{ type: "text", text: "{}" }] });
    await waitFor(() => h.root.textContent === MESSAGES.missing, "データが無いときの文");
    await h.bridge.sendToolCancelled({});
    await waitFor(() => h.root.textContent === MESSAGES.cancelled, "取り消しの文");
    assert.equal(h.root.querySelector("iframe"), null);
  } finally {
    await h.close();
  }
});
