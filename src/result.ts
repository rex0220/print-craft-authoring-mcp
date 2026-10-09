/**
 * 応答の形（実装案 5.2。kSQL の toToolResult にそろえる）。
 *   成功: { ok: true, status: "ok", findings, result, digest? }
 *   失敗: { ok: false, status, error: { code, message }, findings }、isError: true
 * status は ok / invalid（normalize のエラー、入力の誤り）/ incompatible（互換表に合わない）/ conflict（ファイルがある、digest が違う）/
 * denied（作業フォルダーの外・未登録・本番・ダウンロードのファイル）/ failed（時間切れ・上限・想定外の失敗）
 * content の文字と structuredContent は同じ中身。秘密の値は入れない
 */
export type Status = "ok" | "invalid" | "incompatible" | "conflict" | "denied" | "failed";

export interface Finding {
  level: string;
  rule: string;
  message: string;
  [key: string]: unknown;
}

/** findings の件数の上限（AI に返す量。超えたら打ち切って truncated を出す。5.2） */
export const MAX_FINDINGS = 100;

export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent: Record<string, unknown>;
  isError: boolean;
}

export function toResult(payload: Record<string, unknown>, isError = false): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }], structuredContent: payload, isError };
}

export function capFindings(findings: readonly Finding[]): Finding[] {
  if (findings.length <= MAX_FINDINGS) return [...findings];
  return [...findings.slice(0, MAX_FINDINGS), { level: "info", rule: "truncated", message: `findings を ${MAX_FINDINGS} 件で打ち切った（ほかに ${findings.length - MAX_FINDINGS} 件）` }];
}

export function ok(result: Record<string, unknown>, opt: { findings?: readonly Finding[]; digest?: string } = {}): ToolResult {
  return toResult({ ok: true, status: "ok", findings: capFindings(opt.findings ?? []), result, ...(opt.digest ? { digest: opt.digest } : {}) });
}

export function failure(status: Exclude<Status, "ok">, code: string, message: string, findings: readonly Finding[] = []): ToolResult {
  return toResult({ ok: false, status, error: { code, message }, findings: capFindings(findings) }, true);
}

/** 想定外の誤りを failed に（誤りの種類はクラスの名前。文は中核の決まった文。秘密の値を含まない） */
export function unexpected(e: unknown): ToolResult {
  const err = e instanceof Error ? e : new Error(String(e));
  const code = err.name && err.name !== "Error" ? err.name : err.constructor?.name ?? "Error";
  return failure("failed", code, err.message);
}
