/**
 * pcraft_preview（帳票の試し出力。実装案 5.1）: 中核の runPreview で帳票の HTML を作り、作業フォルダーの out/ に書く。
 * 返すのは出したファイル・ページ数・式の誤りの場所と件数だけ。HTML、ファイル名（$fname をレコードで評価したもの）、式の誤りの文は
 * レコードの値を含みうるので返さない（Codex の B1 レビュー BLOCKER 2）。設定にエラーがあれば描かず、書かない（invalid）。
 *   - 出す先: アプリのフォルダー（kintone/<profile>/<番号>-…/）の設定なら、そのフォルダーの out/。それ以外は作業フォルダーの out/
 *   - レコード: records/ のファイル。アプリのフォルダーの設定なら番号だけ（3 → 同じフォルダーの records/3.json）
 *   - 利用者に Chrome で開いてもらう（AI はブラウザーを起動しない）
 *   - Claude Desktop では、帳票を会話の中のプレビュー（MCP App。tools/preview-app.ts）に表示する（2026-10-10 Takashi「MCP Apps で作る」。実装案 16 章）。
 *     帳票の文書は結果の _meta に置き、モデルの文脈に入れない。AI は out/ のファイルを読んだり会話に出したりしない
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { EvalError, InputError, WRITE_ROOTS, normalizeInChild, previewInChild, readFieldsFile, readJsonLimited, renderErrorHint, resolveRead, type PreviewInChildResult, type WorkspaceMode } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { failure, ok, type Finding } from "../result.ts";
import { isToolResult, logDiscardedOutput, prepare, workspaceIdSchema } from "./common.ts";
import { assertReadable, checkRelPaths, fieldsFileFor, folderOf, fromError, originFields, previewDirFor, readSettingsFile, rel, trustedOrigin, withJsonError, writeChecked } from "./files.ts";
import { profileSchema } from "./kintone.ts";
import { PREVIEW_TOOL_META, previewMeta } from "./preview-app.ts";

/** ボタンごとの式のエラーの件数の上限（AI に返す量） */
const MAX_ERRORS_PER_BUTTON = 20;

/** 中核が帳票を出さなかったときの文（tools 2.0.1 の preview の掃除の確かめ） */
const WITHHELD = "帳票を表示しない（掃除した帳票の HTML をブラウザーが読むと形が変わる。レコードの値や HTML 設定に、注釈・CDATA・SVG などの書き方が無いか確かめる）";

/**
 * 式の誤りの文は値を含みうる（例: 日付として読めない値）。場所（HTML 設定の何行目、${…} の評価か計算式か）だけにする。
 * 誤りの中身は pcraft_normalize（レコードを使わない検査）か、利用者が out/ の HTML で見る。
 * Ver.8 までの zip の M_* / R_* は、中核の renderErrorHint が決まった文（関数名と「Ver.9 から使える」）を返したときだけ添える（0.3.0。print-craft の docs/authoring-try-plan.md 4.4）
 */
export function safeRenderError(e: string, pluginVersion = ""): string {
  const m = /^HTML 設定 (\d+) 行目( \$\{|の計算式: )/.exec(e);
  if (m) {
    const hint = renderErrorHint(e, pluginVersion);
    return `HTML 設定 ${m[1]} 行目の${m[2].startsWith(" ${") ? " ${…} の評価" : "計算式の評価"}に失敗（誤りの文は値を含みうるので返さない）${hint ? `。${hint}` : ""}`;
  }
  if (e.startsWith("ページ要素（class=\"rex0220-pcraft-page\"）が無い")) return e;
  // 中核の preview の掃除の確かめ（tools 2.0.1）が通らず、帳票を出さなかった（理由は中核の決まった文だが、ここでも決まった文にする）
  if (e.startsWith("帳票を表示しない: ")) return WITHHELD;
  return "式の評価に失敗（誤りの文は値を含みうるので返さない）";
}

/** 描画の想定外の誤り（例外の文はレコードの値を含みうるので、返さず、記録にも残さない） */
/** 出したファイルの扱い（出し分けごと） */
const NOTE_CLAUDE_CODE = "out/ のファイルはレコードの値を含む（コミットしない）。利用者に Chrome で開いてもらう（AI はブラウザーを起動しない）";
const NOTE_DESKTOP =
  "帳票は会話の中のプレビュー（MCP App）に表示される（表示の許可を求められたら、利用者に許可してもらう）。表示されなければ、利用者に out/ の HTML を Chrome で開いてもらう。" +
  "out/ の HTML を読んだり、ほかのツールで会話に出したりしない（レコードの値が会話に入る）。印刷屋のプレビュー（PDF）とも見比べてもらう（近似。画像はダミー、Web フォントは読まない）。out/ のファイルはレコードの値を含む（コミットしない）";

const RENDER_FAILED = "帳票を描けなかった（誤りの文はレコードの値を含みうるので返さない）。pcraft_normalize で設定を確かめ、レコードのファイルを pcraft_record で取り直す。直らなければ利用者に印刷屋のプレビューで確かめてもらう";

function recordFileFor(root: string, settingsFile: string, record: string, mode: WorkspaceMode): string {
  const folder = folderOf(root, settingsFile);
  const f = folder && /^\d+$/.test(record) ? resolveRead(path.join(folder.dir, "records", `${record}.json`), root) : resolveRead(record, root);
  if (!existsSync(f)) throw new InputError(`レコードのファイルが無い: ${rel(root, f)}（pcraft_record で取る）`);
  assertReadable(root, f, mode);
  return f;
}

export function registerPreview(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_preview",
    {
      title: "印刷屋の帳票を試し出力",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の設定 JSON とレコード 1 件から帳票の HTML を作り、作業フォルダーの out/ に書く。出したファイル・ページ数・式のエラーを返す（HTML は返さない）。" +
        "利用者に Chrome で開いてもらい、印刷屋のプレビューと比べてもらう（近似。画像はダミー、Web フォントは読まない）。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("設定 JSON のファイル（作業フォルダーからの相対パス）"),
          record: z.string().min(1).max(512).describe("レコードのファイル（作業フォルダーからの相対パス。pcraft_record の出力）。アプリのフォルダーの設定ならレコード番号だけでよい"),
          fields: z.string().min(1).max(512).optional().describe("項目定義のファイル（作業フォルダーからの相対パス）。アプリのフォルダー kintone/… の中の設定なら省略できる"),
          button: z.string().min(1).max(200).optional().describe("出すボタンの名前（menu）。省略するとすべて"),
          profile: profileSchema.describe("kintone の接続のファイルの profile（preview の iframe と外部 URL の判定に使う接続先。アプリのフォルダー kintone/<profile>/… の中のファイルは省略する。省略すると defaultProfile、無ければ dev。決まらなければ接続先なし）"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      // Desktop は結果を MCP App で会話の中に表示する（Claude Code は表示しないので付けない）
      ...(ctx.surface === "desktop" ? { _meta: PREVIEW_TOOL_META } : {})
    },
    (input) =>
      ctx.serial(async () => {
        try {
          checkRelPaths({ path: input.path, fields: input.fields, ...(/^\d+$/.test(input.record) ? {} : { record: input.record }) });
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const f = readSettingsFile(w.root, input.path, w.mode);
          const fieldsFile = fieldsFileFor(w.root, f.file, input.fields, w.mode);
          const fields = await withJsonError(w.root, fieldsFile, "項目定義のファイル", () => readFieldsFile(fieldsFile));
          const recordFile = recordFileFor(w.root, f.file, input.record, w.mode);
          const origin = trustedOrigin(w.mode, w.root, f.file, input.profile);
          const baseUrl = origin.baseUrl;
          // 描く前に必ず検査する（tools 1.3.0 の runPreview は検査でエラーがあっても描く。描かせない。Codex の B1 レビュー MAJOR 2）。0.3.0 から検査も描画も評価の子プロセスで
          const checked = await normalizeInChild(w.evaluator, { settingsText: f.text, settingsFile: f.relPath, fields, policy: w.policy, baseUrl });
          logDiscardedOutput(ctx, checked.diag);
          if (checked.findings.hasErrors) return failure("invalid", "NormalizeError", `設定にエラーがあるので帳票を描かない（pcraft_normalize で確かめる）: ${checked.summary}`, checked.findings.items as unknown as Finding[]);
          const recordJson = await withJsonError(w.root, recordFile, "レコードのファイル", () => readJsonLimited(recordFile));
          let result: PreviewInChildResult;
          try {
            result = await previewInChild(w.evaluator, { settingsText: f.text, settingsFile: f.relPath, fields, recordFile: recordJson, policy: w.policy, button: input.button, baseUrl });
          } catch (e) {
            // レコードの形の誤り（中核の決まった文。子プロセスの kind input）は invalid。時間・メモリの上限は決まった文（fromError）。
            // それ以外（子プロセスの kind other）は描画の想定外の誤りで、文を返さない（例: 明細の行の形が違うと、例外の文に値が入る。中核も元の文を送らない）
            if (!(e instanceof EvalError) || e.kind !== "other") return fromError(e);
            // 名前は子プロセスの中で instanceof で決めた組み込みの名前（TypeError など）
            ctx.log(`pcraft_preview: 帳票を描けなかった（${e.innerName}。文はレコードの値を含みうるので出さない）`);
            return failure("failed", "RenderError", RENDER_FAILED);
          }
          logDiscardedOutput(ctx, result.diag);
          const findings = result.findings.items as unknown as Finding[];
          if (result.findings.hasErrors) return failure("invalid", "NormalizeError", `設定にエラーがあるので帳票を書かない（pcraft_normalize で確かめる）: ${result.summary}`, findings);
          const outDir = previewDirFor(w.root, f.file);
          const written: Array<{ menu: string; file: string; pages: number; errors: string[]; errorCount: number }> = [];
          for (const r of result.results) {
            const file = writeChecked(w.root, path.join(outDir, r.file), r.html, WRITE_ROOTS.out, "preview", w.mode);
            written.push({ menu: r.menu, file: rel(w.root, file), pages: r.pages, errors: r.errors.slice(0, MAX_ERRORS_PER_BUTTON).map((e) => safeRenderError(e, result.pluginVersion)), errorCount: r.errors.length });
          }
          return ok(
            {
              path: f.relPath,
              summary: result.summary,
              results: written,
              skipped: result.skipped,
              ...originFields(origin),
              note: ctx.surface === "desktop" ? NOTE_DESKTOP : NOTE_CLAUDE_CODE
            },
            // 帳票の文書は Desktop の結果の _meta にだけ（MCP App の表示に使う。モデルの文脈に入れない）
            { findings, ...(ctx.surface === "desktop" ? { meta: previewMeta(result.results) } : {}) }
          );
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
