/**
 * ツールで共通の部品: 入力の workspaceId（出し分けで必須かが変わる）、作業フォルダーを決めて印刷屋のエンジンを用意する流れ、
 * 中核の SaveResult の応答への写し方
 */
import { z } from "zod";
import { WorkspaceError, type Surface } from "../binding.ts";
import { buildProblem, zipProblem } from "../compat.ts";
import { PluginZipError, loadPolicy, type Engine, type Policy, type SaveResult } from "../core.ts";
import { zipGuide, zipOf, type ServerContext } from "../context.ts";
import { failure, ok, type Finding, type ToolResult } from "../result.ts";
import { describeZipError } from "./zip-report.ts";

/** workspaceId: Claude Code では必須（プラグインのフックが入れる）、Desktop では省略できる（設定の作業フォルダーを使う）。実装案 4.1 */
export function workspaceIdSchema(surface: Surface) {
  return surface === "claude-code"
    ? z.string().min(1).max(4096).describe("作業フォルダー（print-craft のプラグインのフックが入れる。AI は何を渡してもよい）")
    : z.string().min(1).max(4096).optional().describe("作業フォルダー（省略してよい。設定の作業フォルダーを使う）");
}

/** 作業フォルダーを使うツールの文脈（作業フォルダーの実際のパス、エンジン、policy） */
export interface WorkContextForTool {
  root: string;
  engine: Engine;
  policy: Policy;
}

/**
 * 作業フォルダーを決め、印刷屋のエンジンと policy を用意する。だめなら応答（denied / failed）を返す。
 * 作業フォルダーの照合（4.1）→ 印刷屋の zip（設定項目か .env）→ エンジン → policy（作業フォルダーの policy/authoring-policy.json）。
 * 接続先（iframe の判定）は設定ファイルの場所で決まるので、各ツールで files.ts の trustedBaseUrl
 */
export async function prepare(ctx: ServerContext, workspaceId: string | undefined): Promise<WorkContextForTool | ToolResult> {
  let root: string;
  try {
    root = ctx.binding.resolve(workspaceId);
  } catch (e) {
    if (e instanceof WorkspaceError) return failure("denied", "WorkspaceError", e.message);
    throw e;
  }
  const incompatible = incompatibleResult();
  if (incompatible) return incompatible;
  const zip = zipOf(ctx, root);
  if (zip.problem) return failure("failed", "PluginZipError", `印刷屋の zip の設定が読めない: ${zip.problem}`);
  if (!zip.zip) return failure("failed", "PluginZipError", `印刷屋の zip が未設定。${zipGuide(ctx.surface)}`);
  let engine: Engine;
  try {
    engine = await ctx.engine(zip.zip);
  } catch (e) {
    if (!(e instanceof PluginZipError)) throw e;
    // 誤りの種類ごとの決まった文（zip のパスや zip の中のコードの文を返さない）。版が対応外は incompatible、それ以外（無い・読めない・変わった）は failed
    const r = describeZipError(e, ctx.surface);
    return r.incompatible ? failure("incompatible", "IncompatibleError", r.text) : failure("failed", "PluginZipError", r.text);
  }
  const zp = zipProblem(engine);
  if (zp) return failure("incompatible", "IncompatibleError", zp);
  const policy = loadPolicy({ cwd: root });
  return { root, engine, policy };
}

/** 互換表とビルドの組み合わせが合わなければ incompatible（作業フォルダーを使うツールだけが使う。7 章） */
export function incompatibleResult(): ToolResult | undefined {
  const p = buildProblem();
  return p ? failure("incompatible", "IncompatibleError", `${p}（print-craft MCP を入れ直す・更新する）`) : undefined;
}

export const isToolResult = (v: unknown): v is ToolResult => typeof v === "object" && v !== null && "content" in v && "isError" in v;

/** 中核が code を返さなかったときの誤りの種類 */
const DEFAULT_CODE: Record<Exclude<SaveResult["status"], "ok">, string> = {
  invalid: "InputError",
  conflict: "ConflictError",
  denied: "PermissionError",
  failed: "Error"
};

/** 中核の SaveResult を応答に（確定の後に片付けられなかったときは ok に cleanup と note を添える） */
export function fromSaveResult(r: SaveResult): ToolResult {
  const findings = r.findings as unknown as Finding[];
  if (r.status === "ok") return ok({ path: r.path, ...(r.cleanup ? { cleanup: r.cleanup, note: r.message } : {}) }, { findings, digest: r.digest });
  return failure(r.status, r.code ?? DEFAULT_CODE[r.status], r.message ?? r.status, findings);
}
