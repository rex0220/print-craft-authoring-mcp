/**
 * preview の MCP App の表示（ブラウザー。実装案 16.1）。DOM だけを使う純粋な描き方（App とのやり取りは preview-app.ts）。
 *   - ボタンごとに、見出し（文字は textContent。HTML として入れない）と、帳票の文書を入れた <iframe sandbox="" srcdoc>（スクリプトも遷移も動かさない）
 *   - 幅に合わせて縮める（帳票の幅は用紙の幅）
 *   - データが無い・壊れている・大きすぎて省いたときは決まった文
 */
import { PREVIEW_META_KEY, type PreviewButton, type PreviewPayload } from "../preview-payload.ts";

/** 帳票が表示されないときの決まった文 */
export const MESSAGES = {
  waiting: "帳票のプレビューを待っています…",
  missing: "プレビューのデータが届きませんでした。作業フォルダーの out/ の HTML を Chrome で開いてください。",
  tooLarge: "帳票が大きすぎるので、ここには表示しません。作業フォルダーの out/ の HTML を Chrome で開いてください。",
  cancelled: "試し出力は取り消されました。",
  /** pcraft_try の式だけの試し（0.3.1。それまでは missing の文が出ていた） */
  formulas: "この試しは式だけなので、帳票はありません（式の値は会話の中の答えにあります）。",
  noButtons: "帳票はありません（作らなかったわけは会話の中の答えにあります）。"
} as const;

const isString = (v: unknown): v is string => typeof v === "string";
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** 結果の _meta から、決まった形のデータだけを取り出す（形が違えば null） */
export function payloadOf(meta: unknown): PreviewPayload | null {
  if (!meta || typeof meta !== "object") return null;
  const p = (meta as Record<string, unknown>)[PREVIEW_META_KEY];
  if (!p || typeof p !== "object") return null;
  const o = p as Record<string, unknown>;
  if (o.version !== 1 || !Array.isArray(o.buttons)) return null;
  const buttons: PreviewButton[] = [];
  for (const b of o.buttons) {
    if (!b || typeof b !== "object") return null;
    const x = b as Record<string, unknown>;
    if (!isString(x.menu) || !isString(x.fileName) || !isString(x.paper) || !isNumber(x.pages) || !isNumber(x.width) || !isNumber(x.height) || !isString(x.inner)) return null;
    const errors = Array.isArray(x.errors) ? x.errors.filter(isString) : [];
    buttons.push({ menu: x.menu, fileName: x.fileName, paper: x.paper, pages: x.pages, width: x.width, height: x.height, errors, inner: x.inner });
  }
  return { version: 1, buttons, ...(o.omitted === "too-large" ? { omitted: "too-large" as const } : {}), ...(o.kind === "formulas" ? { kind: "formulas" as const } : {}) };
}

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = doc.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

/** 決まった文を出す */
export function renderMessage(root: HTMLElement, text: string): void {
  root.replaceChildren(el(root.ownerDocument, "p", "message", text));
}

/** 帳票を描く。返り値は、幅に合わせて縮めるときに使う枠（fitAll に渡す） */
export function renderPreview(root: HTMLElement, payload: PreviewPayload | null): HTMLElement[] {
  const doc = root.ownerDocument;
  if (!payload) {
    renderMessage(root, MESSAGES.missing);
    return [];
  }
  if (payload.omitted === "too-large") {
    renderMessage(root, MESSAGES.tooLarge);
    return [];
  }
  if (!payload.buttons.length) {
    renderMessage(root, payload.kind === "formulas" ? MESSAGES.formulas : MESSAGES.noButtons);
    return [];
  }
  const frames: HTMLElement[] = [];
  const children: HTMLElement[] = [];
  for (const b of payload.buttons) {
    const section = el(doc, "section", "button");
    section.append(el(doc, "h2", "menu", b.menu));
    section.append(el(doc, "p", "meta", `ファイル名: ${b.fileName} / 用紙: ${b.paper} / ページ: ${b.pages}`));
    if (b.errors.length) {
      const ul = el(doc, "ul", "errors");
      for (const e of b.errors) ul.append(el(doc, "li", undefined, e));
      section.append(ul);
    }
    const box = el(doc, "div", "sheet");
    box.dataset.width = String(b.width);
    box.dataset.height = String(b.height);
    const iframe = el(doc, "iframe");
    // スクリプトも遷移も動かさない（帳票の文書は中核が掃除し、自分の CSP も持つ）
    iframe.setAttribute("sandbox", "");
    iframe.setAttribute("title", b.menu);
    iframe.setAttribute("width", String(b.width));
    iframe.setAttribute("height", String(b.height));
    iframe.setAttribute("srcdoc", b.inner);
    box.append(iframe);
    section.append(box);
    children.push(section);
    frames.push(box);
  }
  root.replaceChildren(el(doc, "p", "note", "これは近似のプレビューです（添付ファイルの画像と QR はダミー、Web フォントは読まない）。PDF の見た目は印刷屋プラグインで確かめてください。"), ...children);
  return frames;
}

/** 枠の中の帳票を、使える幅に合わせて縮める（大きくはしない）。一番広い枠の幅（px）を返す（帳票の列の幅に使う。枠が無ければ 0） */
export function fitAll(frames: HTMLElement[], available: number): number {
  let widest = 0;
  for (const box of frames) {
    const width = Number(box.dataset.width) || 1;
    const height = Number(box.dataset.height) || 1;
    const scale = Math.min(1, Math.max(0.1, available / width));
    const iframe = box.firstElementChild as HTMLElement | null;
    if (iframe) {
      iframe.style.transform = `scale(${scale})`;
      iframe.style.transformOrigin = "0 0";
    }
    box.style.width = `${Math.ceil(width * scale)}px`;
    box.style.height = `${Math.ceil(height * scale)}px`;
    widest = Math.max(widest, Math.ceil(width * scale));
  }
  return widest;
}
