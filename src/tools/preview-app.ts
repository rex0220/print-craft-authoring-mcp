/**
 * preview の MCP App（Desktop だけ。実装案 16 章。2026-10-10 Takashi「MCP Apps で作る（B1 の中で）」）:
 *   - 表示の殻の資源 ui://print-craft/preview.html（mimeType text/html;profile=mcp-app。HTML とビルドで束ねたインラインの script だけ）
 *   - pcraft_preview のツールの _meta（ui.resourceUri と古い形の ui/resourceUri）
 *   - pcraft_preview の結果の _meta（帳票の文書。MCP Apps の仕様で _meta はモデルの文脈を意図しない。content と structuredContent には入れない）
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { MCP_APP_MIME_TYPE, PREVIEW_MAX_BYTES, PREVIEW_META_KEY, PREVIEW_UI_URI, type PreviewButton, type PreviewPayload } from "../preview-payload.ts";

declare const __PCRAFT_PREVIEW_APP_JS__: string;

/**
 * 資源の UI の決まり: CSP は外部を許さない（読み込み・通信（connect）・URL の入れ子の iframe は無し。帳票は srcdoc の iframe で読み込みをしない。
 * Web フォントは preview では読まない＝中核 tools 2.0.1。2026-10-10 Takashi「Web フォントの読み込みは、印刷屋プラグインで処理」）。枠と背景はホストに付けてもらう
 */
const UI_META = {
  ui: {
    csp: { resourceDomains: [], connectDomains: [], frameDomains: [] },
    prefersBorder: true
  }
};

/** pcraft_preview（Desktop）のツールの _meta */
export const PREVIEW_TOOL_META = { ui: { resourceUri: PREVIEW_UI_URI }, "ui/resourceUri": PREVIEW_UI_URI };

const STYLE = `
body { margin: 0; font-family: system-ui, sans-serif; color: #222; background: #fff; }
#toolbar { display: flex; justify-content: flex-end; gap: 8px; padding: 4px 4px 0; }
#toolbar:empty { display: none; }
#root { padding: 4px; }
.note { margin: 4px 0 8px; font-size: 12px; color: #666; }
.button + .button { margin-top: 16px; }
h2.menu { margin: 4px 0; font-size: 16px; }
p.meta { margin: 2px 0 6px; font-size: 12px; color: #555; word-break: break-all; }
ul.errors { margin: 4px 0 8px; padding: 6px 10px 6px 24px; background: #fde7e9; border: 1px solid #b00020; color: #b00020; font-size: 12px; }
.sheet { overflow: hidden; background: #e9ecef; }
.sheet iframe { display: block; border: 0; background: #f7f7f7; }
.message { margin: 12px 4px; font-size: 13px; color: #555; }
button { font: inherit; font-size: 12px; padding: 2px 10px; }
`;

/** 表示の殻の HTML（束ねた script をインラインで。</script> で抜けないように） */
export function previewAppHtml(): string {
  const js = (typeof __PCRAFT_PREVIEW_APP_JS__ === "string" ? __PCRAFT_PREVIEW_APP_JS__ : "").replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="color-scheme" content="light">
<title>印刷屋の帳票の試し出力</title>
<style>${STYLE}</style>
</head><body>
<div id="toolbar"></div>
<div id="root"></div>
<script>${js}</script>
</body></html>
`;
}

/** 表示の殻の資源を登録する（Desktop だけ） */
export function registerPreviewApp(server: McpServer): void {
  server.registerResource(
    "印刷屋の帳票の試し出力",
    PREVIEW_UI_URI,
    { title: "印刷屋の帳票の試し出力", description: "pcraft_preview で作った帳票を会話の中に表示する（近似。画像はダミー）", mimeType: MCP_APP_MIME_TYPE, _meta: UI_META },
    async () => ({ contents: [{ uri: PREVIEW_UI_URI, mimeType: MCP_APP_MIME_TYPE, text: previewAppHtml(), _meta: UI_META }] })
  );
}

/** 中核の runPreview のボタンごとの結果のうち、表示に使うもの */
export interface RenderedForApp {
  menu: string;
  fileName: string;
  pageSize: string;
  orientation: string;
  dpi: string;
  pages: number;
  errors: string[];
  inner: string;
  html: string;
}

/** 中核の外側の文書の iframe の幅と高さ。読めなければ A4 縦 96 dpi の大きさ */
function sizeOf(outer: string): { width: number; height: number } {
  const m = /<iframe sandbox="" [^>]*?width="(\d+)" height="(\d+)"/.exec(outer);
  return m ? { width: Number(m[1]), height: Number(m[2]) } : { width: 834, height: 1203 };
}

/** pcraft_preview の結果の _meta（_meta 全体の JSON が上限を超えたら、帳票を入れずに omitted） */
export function previewMeta(results: readonly RenderedForApp[]): Record<string, PreviewPayload> {
  const buttons: PreviewButton[] = results.map((r) => ({
    menu: r.menu,
    fileName: r.fileName,
    paper: `${r.pageSize} ${r.orientation === "l" ? "横" : "縦"} ${r.dpi} dpi`,
    pages: r.pages,
    ...sizeOf(r.html),
    errors: r.errors,
    inner: r.inner
  }));
  const meta: Record<string, PreviewPayload> = { [PREVIEW_META_KEY]: { version: 1, buttons } };
  return Buffer.byteLength(JSON.stringify(meta), "utf8") > PREVIEW_MAX_BYTES ? { [PREVIEW_META_KEY]: { version: 1, buttons: [], omitted: "too-large" } } : meta;
}
