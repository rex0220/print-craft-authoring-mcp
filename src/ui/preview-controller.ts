/**
 * preview の MCP App の殻の動き（ブラウザー。実装案 16.1）。ホスト（Claude Desktop）と App で握手し、pcraft_preview の結果の
 * _meta["print-craft/preview"] を受けて帳票を描く。表示の形（inline / fullscreen）はホストの文脈の displayMode から始め、
 * ホストが変えたら合わせる（Codex の MCP App のレビュー MINOR 3）。対応する表示の形（inline / fullscreen / pip）は握手で宣言し、
 * ホストが対応している形の切り替えのボタン（小窓、全画面）だけを出し、対応が変われば出し入れする（Codex の最終の確認 MINOR 2）。
 * 帳票は幅に合わせて縮め、帳票の幅の列にして真ん中に置く。全画面では下に余白（浮いている返信の欄に帳票の下が隠れない）
 * （2026-10-10 Takashi の Desktop の全画面の確かめ）。試験のために、描く先と通り道（transport）を受け取る
 * （既定の通り道はホストの window.parent との postMessage）
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { MESSAGES, fitAll, payloadOf, renderMessage, renderPreview } from "./preview-view.ts";

type Transport = Parameters<App["connect"]>[0];
type DisplayMode = "inline" | "fullscreen" | "pip";

/** 切り替えのボタン（ホストが対応している形だけ出す。並びは小窓、全画面） */
const TOGGLES: ReadonlyArray<{ mode: Exclude<DisplayMode, "inline">; label: string }> = [
  { mode: "pip", label: "小窓" },
  { mode: "fullscreen", label: "全画面" }
];

export interface PreviewAppOptions {
  /** 帳票を描く先 */
  root: HTMLElement;
  /** 全画面の切り替えのボタンを置く先 */
  toolbar: HTMLElement;
  /** 幅が変わったら縮め直す */
  win: Window;
  /** 試験の通り道（省略はホストとの postMessage） */
  transport?: Transport;
}

export function startPreviewApp(opt: PreviewAppOptions): { app: App; connected: Promise<void> } {
  const { root, toolbar, win } = opt;
  const doc = root.ownerDocument;
  let frames: HTMLElement[] = [];
  let mode: DisplayMode = "inline";
  const buttons = new Map<DisplayMode, HTMLButtonElement>();
  // 表示の幅に合わせて縮め、帳票の列の幅にして真ん中に置く（CSS の #root の margin。全画面で左に寄らない）
  const refit = (): void => {
    const widest = fitAll(frames, Math.max(200, doc.documentElement.clientWidth - 16));
    root.style.maxWidth = widest ? `${widest}px` : "";
  };
  // ボタンの文と、今の表示の形の印（CSS の body[data-mode]。全画面では下に余白）
  const label = (): void => {
    for (const t of TOGGLES) {
      const b = buttons.get(t.mode);
      if (b) b.textContent = mode === t.mode ? "元の大きさ" : t.label;
    }
    doc.body.dataset.mode = mode;
  };
  const showMode = (next: DisplayMode): void => {
    mode = next;
    label();
    refit();
  };
  // ホストが対応している形の切り替えのボタンだけを出し、対応しなくなったら外す
  const syncButtons = (modes: readonly string[]): void => {
    for (const t of TOGGLES) {
      const can = modes.includes(t.mode);
      const b = buttons.get(t.mode);
      if (can && !b) {
        const nb = doc.createElement("button");
        nb.type = "button";
        nb.addEventListener("click", () => {
          app
            .requestDisplayMode({ mode: mode === t.mode ? "inline" : t.mode })
            .then((r) => showMode(r.mode))
            .catch(() => undefined);
        });
        buttons.set(t.mode, nb);
      } else if (!can && b) {
        b.remove();
        buttons.delete(t.mode);
      }
    }
    toolbar.replaceChildren(...TOGGLES.flatMap((t) => buttons.get(t.mode) ?? []));
    label();
  };

  // 対応する表示の形を握手で宣言する
  const app = new App({ name: "print-craft preview", version: "1" }, { availableDisplayModes: ["inline", "fullscreen", "pip"] }, { autoResize: true });
  app.ontoolresult = (result) => {
    frames = renderPreview(root, payloadOf(result._meta));
    refit();
  };
  app.ontoolcancelled = () => {
    frames = [];
    renderMessage(root, MESSAGES.cancelled);
  };
  // ホストが表示の形（全画面を閉じたなど）や、対応する表示の形を変えたら合わせる
  app.onhostcontextchanged = (ctx) => {
    if (ctx.availableDisplayModes) syncButtons(ctx.availableDisplayModes);
    if (ctx.displayMode) showMode(ctx.displayMode);
  };

  renderMessage(root, MESSAGES.waiting);
  win.addEventListener("resize", refit);

  const connected = app
    .connect(opt.transport)
    .then(() => {
      const ctx = app.getHostContext();
      // 初めの形はホストの文脈から（初めから全画面のホストもある）
      syncButtons(ctx?.availableDisplayModes ?? []);
      showMode(ctx?.displayMode ?? "inline");
    })
    .catch(() => renderMessage(root, MESSAGES.missing));
  return { app, connected };
}
