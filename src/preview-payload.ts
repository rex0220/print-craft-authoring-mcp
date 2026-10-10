/**
 * preview の MCP App（Desktop。実装案 16 章）でサーバーと表示の殻（src/ui/）が共有する名前と形。
 * 帳票の文書は pcraft_preview の結果の _meta[PREVIEW_META_KEY] に置く（MCP Apps の仕様で _meta はモデルの文脈を意図しない。content と structuredContent には入れない）
 */

/** 表示の殻の資源（ツールの _meta.ui.resourceUri） */
export const PREVIEW_UI_URI = "ui://print-craft/preview.html";
/** MCP Apps の資源の mimeType（仕様で固定） */
export const MCP_APP_MIME_TYPE = "text/html;profile=mcp-app";
/** 結果の _meta のキー */
export const PREVIEW_META_KEY = "print-craft/preview";
/** 結果の _meta 全体の上限（JSON の UTF-8 のバイト数。帳票の文書・ボタン名・ファイル名・誤りの文も数える。超えたら帳票を入れない。Codex の MCP App のレビュー MINOR 2） */
export const PREVIEW_MAX_BYTES = 4 * 1024 * 1024;

export interface PreviewButton {
  /** ボタンの名前（menu） */
  menu: string;
  /** PDF のファイル名（$fname をレコードで評価したもの。値を含みうる） */
  fileName: string;
  /** 用紙（例「A4 縦 96 dpi」） */
  paper: string;
  pages: number;
  /** 帳票の文書の表示の幅と高さ（px） */
  width: number;
  height: number;
  /** 式の誤りの文（値を含みうる。UI にだけ出す） */
  errors: string[];
  /** 帳票の文書（中核の runPreview の inner。script・on*・iframe などを除き、CSP 付き） */
  inner: string;
}

export interface PreviewPayload {
  version: 1;
  buttons: PreviewButton[];
  /** 大きすぎて帳票の文書を省いた */
  omitted?: "too-large";
}
