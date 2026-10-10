/**
 * preview の MCP App の殻の入口（ブラウザー。実装案 16.1）。動きは preview-controller.ts。
 * ビルドで 1 つのインラインの script に束ねる（外の script を読まない）
 */
import { startPreviewApp } from "./preview-controller.ts";

startPreviewApp({ root: document.getElementById("root") as HTMLElement, toolbar: document.getElementById("toolbar") as HTMLElement, win: window });
