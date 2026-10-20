/**
 * pcraft_try（お試しアプリで式と帳票を試す。0.3.0。print-craft の docs/authoring-try-plan.md 4.2〜4.5、T3）: 中核の tryInChild（評価の子プロセス・Worker thread）。
 * お試しアプリ（架空の値の標本）の項目とレコードで、式（10 件まで）か印刷屋の 1 ボタンの帳票を試す。利用者のアプリ・レコード・kintone は使わない。
 *   - 値は架空なので、式の評価の値とエラーの文、ページの文字を返す（今の pcraft_preview の「レコードの値は MCP App だけが見る」とは別の境界。threat-model の M3）
 *   - 帳票は作業フォルダーの out/try/<app>-<番号|rows|list>.html に書く（一時ファイル → rename。毎回上書き。描けなかった対象の古いファイルは消す）
 *   - Desktop は帳票を会話の中のプレビュー（MCP App）にも出す（_meta。掃除と verifyPreviewHtml を通した inner だけ）
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WRITE_ROOTS, tryInChild, type TryInput } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { failure, ok, type Finding } from "../result.ts";
import { isToolResult, logDiscardedOutput, prepare, workspaceIdSchema } from "./common.ts";
import { fromError, rel, removeChecked, writeAtomicChecked } from "./files.ts";
import { PREVIEW_TOOL_META, previewMeta } from "./preview-app.ts";

const NOTE_CLAUDE_CODE = "out/try/ の帳票は架空の値（お試しアプリ）。利用者に Chrome で開いてもらってよい（AI はブラウザーを起動しない）。項目コードはお試しアプリのもので、利用者の設定に書かない";
const NOTE_DESKTOP = "帳票は会話の中のプレビュー（MCP App）にも表示される。値は架空（お試しアプリ）。項目コードはお試しアプリのもので、利用者の設定に書かない";

const formulaSchema = z
  .object({
    formula: z.string().min(1).max(16_384).describe("計算式（帳票の ${…} や計算式と同じ書き方）"),
    table: z.string().min(1).max(100).optional().describe("テーブルのコード（その行ごとに評価する。20 行まで）。formula-sample は テーブル1 / テーブル2、quote は 見積明細、gantt は task_list")
  })
  .strict();

const buttonSchema = z
  .object({
    html: z.string().max(65_536).describe("HTML 欄（3 行目。ページは class=\"rex0220-pcraft-page\" の要素。計算式だけでページを作るなら空の文字列）"),
    css: z.string().max(32_768).optional().describe("CSS 欄（3 行目）"),
    bodyFormula: z.string().max(16_384).optional().describe("3 行目の計算式（$html を受けて HTML を返す）"),
    fileNameFormula: z.string().max(16_384).optional().describe("ファイル名の計算式（2 行目 $fname）"),
    displayCondition: z.string().max(16_384).optional().describe("ボタン表示条件の計算式（1 行目 $out。一覧帳票では評価しない）"),
    pageSize: z.string().max(20).optional().describe("用紙（A4 など。省略は A4）"),
    orientation: z.enum(["p", "l"]).optional().describe("向き（p = 縦、l = 横）"),
    dpi: z.string().max(10).optional().describe("DPI（省略は 96）"),
    list: z.boolean().optional().describe("一覧帳票（対象のレコードを全部 $records に入れて 1 つの帳票。RECS_*）")
  })
  .strict();

export function registerTry(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_try",
    {
      title: "お試しアプリで式と帳票を試す",
      description:
        "お試しアプリ（架空の値の標本: formula-sample = 全項目タイプ × 2 とテーブル 2 つ、quote = 見積書、list = 一覧帳票、gantt = 工程表と関連レコード一覧）で、印刷屋の計算式か 1 ボタンの帳票を試す。" +
        "利用者のアプリ・レコード・kintone は使わない。式の値・エラーの文・ページの文字を返す（値は架空）。帳票は作業フォルダーの out/try/ に書く。" +
        "使うのは、利用者が動きの確認を求めたとき、資料に無い値や端の動き（空・0・改行・改ページ）を断言するとき、資料と自分の理解が食い違うとき、設定を作る前に帳票の形を試すとき、QA（問題と答え）を作るとき（答えを確かめる）。" +
        "関数の解説・使用例は資料（pcraft_docs）で答え、一般的な問いには使わない。1 回の呼び出しは formulas 10 件まで、または button 1 つ（両方は不可）。探索のために続けて呼ばない。" +
        "対象は既定でレコード 1〜3（典型・端・空）、records で絞る、rows はテーブルの行数（quote 1,000・gantt 1,001 まで。1,001 は印刷屋と同じく作らない）、count は一覧帳票の件数（list。100 まで）。" +
        "項目コードはお試しアプリのもので、利用者の設定に書かない。利用者のアプリでの確かめは今までどおり保存して pcraft_preview",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          app: z.enum(["formula-sample", "quote", "list", "gantt"]).optional().describe("お試しアプリ（省略は formula-sample）"),
          records: z.array(z.number().int().min(1).max(3)).min(1).max(3).optional().describe("固定のレコードの番号（1 = 典型、2 = 端、3 = 空。省略は全部）"),
          rows: z.number().int().min(0).max(1001).optional().describe("レコード 1 のテーブルの行数（quote・gantt。records・count と併せない）"),
          count: z.number().int().min(1).max(100).optional().describe("一覧帳票のレコードの件数（list。records・rows と併せない）"),
          formulas: z.array(formulaSchema).min(1).max(10).optional().describe("試す式（button と併せない）"),
          button: buttonSchema.optional().describe("試す 1 ボタン（formulas と併せない）")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      ...(ctx.surface === "desktop" ? { _meta: PREVIEW_TOOL_META } : {})
    },
    (input) =>
      ctx.serial(async () => {
        try {
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const { workspaceId: _ws, ...rest } = input;
          const r = await tryInChild(w.evaluator, rest as TryInput);
          logDiscardedOutput(ctx, r.diag);
          const result = r.result;
          const findings = (result.button?.findings ?? []) as unknown as Finding[];
          if (findings.some((f) => f.level === "error")) return failure("invalid", "NormalizeError", "お試しの 1 ボタンの設定にエラーがあるので描かない（findings）", findings);
          const outDir = path.join(w.root, "out", "try");
          const written: string[] = [];
          const removed: string[] = [];
          for (const f of r.files) {
            const target = path.join(outDir, `${result.app}-${f.key}.html`);
            if (f.html !== undefined) written.push(rel(w.root, writeAtomicChecked(w.root, target, f.html, WRITE_ROOTS.out, "preview", w.mode)));
            else if (removeChecked(w.root, target, WRITE_ROOTS.out, "preview", w.mode)) removed.push(rel(w.root, target));
          }
          let meta: Record<string, unknown> | undefined;
          if (ctx.surface === "desktop" && input.button && result.button) {
            const b = input.button;
            const rendered = r.files.flatMap((f) => {
              const res = result.button!.results.find((x) => x.key === f.key);
              return f.html !== undefined && f.inner !== undefined && res
                ? [{ menu: `お試し（${res.target}）`, fileName: res.fileName.value, pageSize: b.pageSize ?? "A4", orientation: b.orientation ?? "p", dpi: b.dpi ?? "96", pages: res.pages, html: f.html, errors: res.errors, inner: f.inner }]
                : [];
            });
            meta = previewMeta(rendered);
          }
          return ok({ ...result, written, removed, note: ctx.surface === "desktop" ? NOTE_DESKTOP : NOTE_CLAUDE_CODE }, { findings, ...(meta ? { meta } : {}) });
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
