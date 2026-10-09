/**
 * 診断の印刷屋の zip の報告（pcraft_status / pcraft_workspace_status。Codex の B1 レビュー MAJOR 3）:
 * 実際に読んで、読めるか・互換か・印刷屋の版・authoring API の版を返す（パスの選び方だけで「準備ができている」と答えない）。
 * 絶対パスは返さない（ファイル名だけ。誤りの文の中のパスもファイル名に置き換える）
 */
import path from "node:path";
import { zipProblem } from "../compat.ts";
import { zipGuide, zipOf, type ServerContext } from "../context.ts";

export interface ZipReport {
  configured: boolean;
  source: string;
  fileName?: string;
  readable?: boolean;
  compatible?: boolean;
  pluginVersion?: string;
  authoringApiVersion?: number;
  problem?: string;
}

const scrub = (message: string, zip: string | undefined): string => (zip ? message.split(zip).join(path.basename(zip)) : message);

/** 印刷屋の zip を読んで報告する。next に足す文も返す（問題が無ければ undefined） */
export async function zipReport(ctx: ServerContext, root: string | undefined): Promise<{ report: ZipReport; next?: string }> {
  const z = zipOf(ctx, root);
  if (z.problem) return { report: { configured: true, source: z.source, problem: scrub(z.problem, z.zip) }, next: `印刷屋の zip の設定が読めない: ${scrub(z.problem, z.zip)}` };
  if (!z.zip) {
    const where = ctx.surface === "claude-code" && !root ? "（作業フォルダーの .env にあれば使う）" : "";
    return { report: { configured: false, source: z.source }, next: `印刷屋の zip が未設定${where}。${zipGuide(ctx.surface)}` };
  }
  const base: ZipReport = { configured: true, source: z.source, fileName: path.basename(z.zip) };
  try {
    const engine = await ctx.engine(z.zip);
    const api = (engine.api as { apiVersion?: unknown } | undefined)?.apiVersion;
    const problem = zipProblem(engine);
    const report: ZipReport = { ...base, readable: true, compatible: !problem, pluginVersion: engine.source.pluginVersion, ...(typeof api === "number" ? { authoringApiVersion: api } : {}), ...(problem ? { problem } : {}) };
    return { report, ...(problem ? { next: `印刷屋の zip が合わない: ${problem}` } : {}) };
  } catch (e) {
    const problem = scrub(e instanceof Error ? e.message : String(e), z.zip);
    return { report: { ...base, readable: false, compatible: false, problem }, next: `印刷屋の zip が読めない: ${problem}（アプリに入れたものと同じ、配布元から入手した zip を選ぶ）` };
  }
}
