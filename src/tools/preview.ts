/**
 * pcraft_preview（帳票の試し出力。実装案 5.1）: 中核の runPreview で帳票の HTML を作り、作業フォルダーの out/ に書く。
 * 返すのは出したファイル・ページ数・式のエラーだけ（HTML はレコードの値を含むので返さない）。設定にエラーがあれば書かない（invalid）。
 *   - 出す先: 開発の環境のアプリのフォルダーの設定なら、そのフォルダーの out/。それ以外（本番・未分類・アプリのフォルダーの外）は作業フォルダーの out/（4.2 の P9）
 *   - レコード: records/ のファイル。アプリのフォルダーの設定なら番号だけ（3 → 同じフォルダーの records/3.json）
 *   - 利用者に Chrome で開いてもらう（AI はブラウザーを起動しない）
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { InputError, WRITE_ROOTS, normalizeSettings, readFieldsFile, readJsonLimited, resolveRead, runPreview, type PreviewInput, type PreviewResult } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { failure, ok, type Finding } from "../result.ts";
import { isToolResult, prepare, workspaceIdSchema } from "./common.ts";
import { fieldsFileFor, folderOf, fromError, previewDirFor, readSettingsFile, rel, trustedBaseUrl, writeChecked } from "./files.ts";

/** ボタンごとの式のエラーの件数の上限（AI に返す量） */
const MAX_ERRORS_PER_BUTTON = 20;

/**
 * 中核の preview。tools 1.3.0 の runPreview は検査でエラーがあっても描き、不正な値（用紙の大きさなど）で印刷屋のコードが例外を出す
 * （次の版で直した。print-craft-authoring の b1-core）。例外のときは検査だけをやり直し、エラーがあれば findings を返す
 */
async function previewOrFindings(input: PreviewInput): Promise<PreviewResult> {
  try {
    return await runPreview(input);
  } catch (e) {
    const n = await normalizeSettings({ settingsText: input.settingsText, settingsFile: input.settingsFile, fields: input.fields, engine: input.engine, policy: input.policy, baseUrl: input.baseUrl });
    if (n.findings.hasErrors) return { findings: n.findings, results: [], skipped: [], summary: n.summary };
    throw e;
  }
}

function recordFileFor(root: string, settingsFile: string, record: string): string {
  const folder = folderOf(root, settingsFile);
  if (folder && /^\d+$/.test(record)) {
    const f = path.join(folder.dir, "records", `${record}.json`);
    if (!existsSync(f)) throw new InputError(`レコードのファイルが無い: ${rel(root, f)}（pcraft_record で取る）`);
    return resolveRead(f, root);
  }
  const f = resolveRead(record, root);
  if (!existsSync(f)) throw new InputError(`レコードのファイルが無い: ${rel(root, f)}（pcraft_record で取る）`);
  return f;
}

export function registerPreview(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_preview",
    {
      title: "印刷屋の帳票を試し出力",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の設定 JSON とレコード 1 件から帳票の HTML を作り、作業フォルダーの out/ に書く。出したファイル・ページ数・式のエラーを返す（HTML は返さない）。" +
        "利用者に Chrome で開いてもらい、印刷屋のプレビューと比べてもらう（近似。画像はダミー）。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("設定 JSON のファイル（作業フォルダーからの相対パス）"),
          record: z.string().min(1).max(512).describe("レコードのファイル（作業フォルダーからの相対パス。pcraft_record の出力）。アプリのフォルダーの設定ならレコード番号だけでよい"),
          fields: z.string().min(1).max(512).optional().describe("項目定義のファイル（作業フォルダーからの相対パス）。アプリのフォルダー kintone/… の中の設定なら省略できる"),
          button: z.string().min(1).max(200).optional().describe("出すボタンの名前（menu）。省略するとすべて")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    (input) =>
      ctx.serial(async () => {
        try {
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const f = readSettingsFile(w.root, input.path);
          const fields = await readFieldsFile(fieldsFileFor(w.root, f.file, input.fields));
          const recordFile = recordFileFor(w.root, f.file, input.record);
          const result = await previewOrFindings({
            settingsText: f.text,
            settingsFile: f.relPath,
            fields,
            recordFile: readJsonLimited(recordFile),
            engine: w.engine,
            policy: w.policy,
            button: input.button,
            baseUrl: trustedBaseUrl(ctx, w.root, f.file)
          });
          const findings = result.findings.items as unknown as Finding[];
          if (result.findings.hasErrors) return failure("invalid", "NormalizeError", `設定にエラーがあるので帳票を書かない（pcraft_normalize で確かめる）: ${result.summary}`, findings);
          const outDir = previewDirFor(w.root, f.file);
          const written: Array<{ menu: string; file: string; fileName: string; pages: number; errors: string[]; errorCount: number }> = [];
          for (const r of result.results) {
            const file = writeChecked(w.root, path.join(outDir, r.file), r.html, WRITE_ROOTS.out, "preview");
            written.push({ menu: r.menu, file: rel(w.root, file), fileName: r.fileName, pages: r.pages, errors: r.errors.slice(0, MAX_ERRORS_PER_BUTTON), errorCount: r.errors.length });
          }
          return ok(
            {
              path: f.relPath,
              summary: result.summary,
              results: written,
              skipped: result.skipped,
              note: "out/ のファイルはレコードの値を含む（コミットしない）。利用者に Chrome で開いてもらう（AI はブラウザーを起動しない）"
            },
            { findings }
          );
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
