/**
 * preview の MCP App の殻の動き（ブラウザー。実装案 16.1）。ホスト（Claude Desktop）と App で握手し、pcraft_preview の結果の
 * _meta["print-craft/preview"] を受けて帳票を描く。表示の形（inline / fullscreen）はホストの文脈の displayMode から始め、
 * ホストが変えたら合わせる（Codex の MCP App のレビュー MINOR 3）。対応する表示の形は握手で宣言し、ホストが全画面に対応しているかが
 * 変わったら切り替えのボタンを出し入れする（Codex の最終の確認 MINOR 2）。試験のために、描く先と通り道（transport）を受け取る
 * （既定の通り道はホストの window.parent との postMessage）
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { MESSAGES, fitAll, payloadOf, renderMessage, renderPreview } from "./preview-view.ts";

type Transport = Parameters<App["connect"]>[0];
type DisplayMode = "inline" | "fullscreen" | "pip";

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
  let frames: HTMLElement[] = [];
  let mode: DisplayMode = "inline";
  let button: HTMLButtonElement | null = null;
  const refit = (): void => fitAll(frames, Math.max(200, root.clientWidth - 8));
  const label = (): void => {
    if (button) button.textContent = mode === "fullscreen" ? "元の大きさ" : "全画面";
  };
  const showMode = (next: DisplayMode): void => {
    mode = next;
    label();
    refit();
  };
  // ホストが全画面に対応していれば切り替えのボタンを出し、対応しなくなったら外す
  const syncButton = (modes: readonly string[]): void => {
    const can = modes.includes("fullscreen");
    if (can && !button) {
      button = root.ownerDocument.createElement("button");
      button.type = "button";
      button.addEventListener("click", () => {
        app
          .requestDisplayMode({ mode: mode === "fullscreen" ? "inline" : "fullscreen" })
          .then((r) => showMode(r.mode))
          .catch(() => undefined);
      });
      toolbar.append(button);
      label();
    } else if (!can && button) {
      button.remove();
      button = null;
    }
  };

  // 対応する表示の形を握手で宣言する
  const app = new App({ name: "print-craft preview", version: "1" }, { availableDisplayModes: ["inline", "fullscreen"] }, { autoResize: true });
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
    if (ctx.availableDisplayModes) syncButton(ctx.availableDisplayModes);
    if (ctx.displayMode) showMode(ctx.displayMode);
  };

  renderMessage(root, MESSAGES.waiting);
  win.addEventListener("resize", refit);

  const connected = app
    .connect(opt.transport)
    .then(() => {
      const ctx = app.getHostContext();
      // 初めの形はホストの文脈から（初めから全画面のホストもある）
      syncButton(ctx?.availableDisplayModes ?? []);
      showMode(ctx?.displayMode ?? "inline");
    })
    .catch(() => renderMessage(root, MESSAGES.missing));
  return { app, connected };
}
