/**
 * preview の MCP App の殻の動き（ブラウザー。実装案 16.1）。ホスト（Claude Desktop）と App で握手し、pcraft_preview の結果の
 * _meta["print-craft/preview"] を受けて帳票を描く。表示の形（inline / fullscreen）はホストの文脈の displayMode から始め、
 * ホストが変えたら合わせる（Codex の MCP App のレビュー MINOR 3）。試験のために、描く先と通り道（transport）を受け取る
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
  const showMode = (next: DisplayMode): void => {
    mode = next;
    if (button) button.textContent = mode === "fullscreen" ? "元の大きさ" : "全画面";
    refit();
  };

  const app = new App({ name: "print-craft preview", version: "1" }, {}, { autoResize: true });
  app.ontoolresult = (result) => {
    frames = renderPreview(root, payloadOf(result._meta));
    refit();
  };
  app.ontoolcancelled = () => {
    frames = [];
    renderMessage(root, MESSAGES.cancelled);
  };
  // ホストが表示の形を変えたら（全画面を閉じたなど）ボタンの文を合わせる
  app.onhostcontextchanged = (ctx) => {
    if (ctx.displayMode) showMode(ctx.displayMode);
  };

  renderMessage(root, MESSAGES.waiting);
  win.addEventListener("resize", refit);

  const connected = app
    .connect(opt.transport)
    .then(() => {
      const ctx = app.getHostContext();
      // ホストが全画面に対応していれば、切り替えのボタンを出す。初めの形はホストの文脈から（初めから全画面のホストもある）
      if ((ctx?.availableDisplayModes ?? []).includes("fullscreen")) {
        button = root.ownerDocument.createElement("button");
        button.type = "button";
        button.addEventListener("click", () => {
          app
            .requestDisplayMode({ mode: mode === "fullscreen" ? "inline" : "fullscreen" })
            .then((r) => showMode(r.mode))
            .catch(() => undefined);
        });
        toolbar.append(button);
      }
      showMode(ctx?.displayMode ?? "inline");
    })
    .catch(() => renderMessage(root, MESSAGES.missing));
  return { app, connected };
}
