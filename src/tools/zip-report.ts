/**
 * 診断の印刷屋の zip の報告（pcraft_status / pcraft_workspace_status。Codex の B1 レビュー MAJOR 3）:
 * 実際に読んで、読めるか・互換か・印刷屋の版・authoring API の版を返す（パスの選び方だけで「準備ができている」と答えない）。
 * 絶対パスは返さない（ファイル名だけ）。読み込みの誤りは中核の PluginZipError の code（種類）と info（分かっている版）から決まった文にする
 * （生の誤りの文は返さない。「zip として読めない」と「読めるが合わない」を分ける。Codex の B1 再レビュー MAJOR 1）
 */
import path from "node:path";
import type { Surface } from "../binding.ts";
import { zipProblem } from "../compat.ts";
import { PluginZipError, type PluginZipErrorCode } from "../core.ts";
import { zipGuide, zipOf, type ServerContext } from "../context.ts";
import { sanitizeMessage } from "../result.ts";

export interface ZipReport {
  configured: boolean;
  source: string;
  fileName?: string;
  readable?: boolean;
  compatible?: boolean;
  pluginVersion?: string;
  authoringApiVersion?: number;
  /** 読めない・合わないときの種類（中核の PluginZipError の code。想定外の誤りは unexpected） */
  code?: string;
  problem?: string;
}

export interface ZipErrorReport {
  code: PluginZipErrorCode | "unexpected";
  /** zip として読めたか（分からないときは undefined） */
  readable?: boolean;
  /** 互換表の判定に当たる誤り（版が対応外）なら true。ツールの status は incompatible */
  incompatible: boolean;
  pluginVersion?: string;
  authoringApiVersion?: number;
  /** 決まった文（パスや zip の中のコードの文を含まない） */
  text: string;
}

const UNREADABLE = new Set<string>(["not-configured", "missing", "unreadable"]);
const INCOMPATIBLE = new Set<string>(["unsupported-version", "api-unsupported", "api-incomplete"]);

/** 印刷屋の zip の読み込みの誤りを、種類ごとの決まった文に（診断と、作業フォルダーを使うツールの failed / incompatible） */
export function describeZipError(e: unknown, surface: Surface): ZipErrorReport {
  if (!(e instanceof PluginZipError)) {
    return { code: "unexpected", incompatible: false, text: `印刷屋の zip を読み込めない（想定外の誤り: ${e instanceof Error ? e.constructor.name : typeof e}）。print-craft MCP を入れ直す・更新する` };
  }
  const v = e.info.pluginVersion || undefined;
  const api = typeof e.info.apiVersion === "number" ? e.info.apiVersion : undefined;
  const ver = v ? `（印刷屋の版 ${v}）` : "";
  const reconnect = surface === "desktop" ? "Claude Desktop を起動し直す" : "/mcp で print-craft を再接続する";
  const texts: Record<PluginZipErrorCode, string> = {
    "not-configured": `印刷屋の zip の場所が分からない。${zipGuide(surface)}`,
    missing: `印刷屋の zip が無い（設定の場所にファイルが無い）。${zipGuide(surface)}`,
    unreadable: "印刷屋の zip として読めない（壊れているか、印刷屋プラグインの zip でない）。配布元から入手した印刷屋の zip を選ぶ",
    "not-print-craft": `印刷屋プラグインの zip ではない（プラグイン ID が違う）${ver}。配布元から入手した印刷屋の zip を選ぶ`,
    "unsupported-version": `印刷屋の版 ${v ?? "不明"} の zip には対応していない（Ver.6 以降の zip を選ぶ。アプリに入れたものと同じ版）`,
    "no-api": `印刷屋の zip${ver}に authoring API が無い（Ver.6 以降の、配布元から入手した zip を選ぶ）`,
    "engine-unreadable": `印刷屋の zip${ver}の計算式エンジンを読み込めない（壊れているか、組み替えられた zip）。配布元から入手した zip を選ぶ`,
    "api-unreadable": `印刷屋の zip${ver}の authoring API を読み込めない（壊れているか、組み替えられた zip）。配布元から入手した zip を選ぶ`,
    "api-unsupported": `印刷屋の zip${ver}の authoring API の版 ${api ?? "不明"} に、この print-craft MCP は対応していない（print-craft MCP を更新する）`,
    "api-mismatch": `印刷屋の zip の authoring API と manifest の版が違う${ver}（組み替えられた zip）。配布元から入手した zip を選ぶ`,
    "api-incomplete": `印刷屋の zip${ver}の authoring API に、print-craft MCP が使うものが無い（印刷屋と print-craft MCP の版を合わせる）`,
    "zip-changed": `印刷屋の zip が、このサーバーが読み込んだものと違う（別の zip か、読み込んだ後に変わった）。1 つのサーバーで使える zip は 1 つ。zip を変えたら ${reconnect}`
  };
  return {
    code: e.code,
    ...(UNREADABLE.has(e.code) ? { readable: false } : e.code === "zip-changed" ? {} : { readable: true }),
    incompatible: INCOMPATIBLE.has(e.code),
    ...(v ? { pluginVersion: v } : {}),
    ...(api !== undefined ? { authoringApiVersion: api } : {}),
    text: texts[e.code] ?? `印刷屋の zip を読み込めない（${e.code}）`
  };
}

const scrub = (message: string, zip: string | undefined): string => sanitizeMessage(zip ? message.split(zip).join(path.basename(zip)) : message);

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
    const r = describeZipError(e, ctx.surface);
    const report: ZipReport = {
      ...base,
      ...(r.readable !== undefined ? { readable: r.readable } : {}),
      compatible: false,
      ...(r.pluginVersion ? { pluginVersion: r.pluginVersion } : {}),
      ...(r.authoringApiVersion !== undefined ? { authoringApiVersion: r.authoringApiVersion } : {}),
      code: r.code,
      problem: r.text
    };
    return { report, next: r.text };
  }
}
