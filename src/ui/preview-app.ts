/**
 * preview の MCP App の殻（ブラウザー。実装案 16.1）。ホスト（Claude Desktop）と App で握手し、pcraft_preview の結果の
 * _meta["print-craft/preview"] を受けて帳票を描く。ビルドで 1 つのインラインの script に束ねる（外の script を読まない）
 */
import { App } from "@modelcontextprotocol/ext-apps";
import { MESSAGES, fitAll, payloadOf, renderMessage, renderPreview } from "./preview-view.ts";

const root = document.getElementById("root") as HTMLElement;
const toolbar = document.getElementById("toolbar") as HTMLElement;
let frames: HTMLElement[] = [];

const refit = (): void => fitAll(frames, Math.max(200, root.clientWidth - 8));

const app = new App({ name: "print-craft preview", version: "1" }, {}, { autoResize: true });

app.ontoolresult = (result) => {
  frames = renderPreview(root, payloadOf(result._meta));
  refit();
};
app.ontoolcancelled = () => {
  frames = [];
  renderMessage(root, MESSAGES.cancelled);
};

renderMessage(root, MESSAGES.waiting);
window.addEventListener("resize", refit);

app
  .connect()
  .then(() => {
    // ホストが全画面に対応していれば、切り替えのボタンを出す
    const modes = app.getHostContext()?.availableDisplayModes ?? [];
    if (!modes.includes("fullscreen")) return;
    let mode: "inline" | "fullscreen" = "inline";
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "全画面";
    button.addEventListener("click", () => {
      const next = mode === "inline" ? "fullscreen" : "inline";
      app
        .requestDisplayMode({ mode: next })
        .then((r) => {
          mode = r.mode === "fullscreen" ? "fullscreen" : "inline";
          button.textContent = mode === "fullscreen" ? "元の大きさ" : "全画面";
          refit();
        })
        .catch(() => undefined);
    });
    toolbar.append(button);
  })
  .catch(() => renderMessage(root, MESSAGES.missing));
