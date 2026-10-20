/**
 * pcraft_normalize（検査。実装案 5.1）: 中核の normalizeSettings を、書き戻さずに実行する（CLI の --dry-run。check で --check）。0.3.0 から評価の子プロセスで（normalizeInChild）。
 * 書くのは保存のツール（pcraft_save_settings / pcraft_update_button）だけ。エラーがあれば invalid（findings にエラー）
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { normalizeInChild, readFieldsFile } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { failure, ok, type Finding } from "../result.ts";
import { isToolResult, logDiscardedOutput, prepare, workspaceIdSchema } from "./common.ts";
import { checkRelPaths, fieldsFileFor, fromError, originFields, readSettingsFile, trustedOrigin, withJsonError } from "./files.ts";
import { profileSchema } from "./kintone.ts";

/** --check の差の件数の上限（AI に返す量） */
const MAX_CHECK_DIFFS = 50;

export function registerNormalize(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_normalize",
    {
      title: "印刷屋の設定を検査",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の設定 JSON を検査（normalize）し、エラー・警告・情報を返す。ファイルは書き換えない。" +
        "check: true で、入力の派生値と生成した値が一致するか（項目定義が古くないか）も確かめる。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("設定 JSON のファイル（作業フォルダーからの相対パス）"),
          fields: z.string().min(1).max(512).optional().describe("項目定義のファイル（作業フォルダーからの相対パス）。アプリのフォルダー kintone/… の中の設定なら省略できる"),
          check: z.boolean().optional().describe("入力の派生値と生成した値の差を確かめる（エクスポートした設定を直す前）"),
          profile: profileSchema.describe("kintone の接続のファイルの profile（preview の iframe と外部 URL の判定に使う接続先。アプリのフォルダー kintone/<profile>/… の中のファイルは省略する。省略すると defaultProfile、無ければ dev。決まらなければ接続先なし）"),
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    (input) =>
      ctx.serial(async () => {
        try {
          checkRelPaths({ path: input.path, fields: input.fields });
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const f = readSettingsFile(w.root, input.path, w.mode);
          const fieldsFile = fieldsFileFor(w.root, f.file, input.fields, w.mode);
          const fields = await withJsonError(w.root, fieldsFile, "項目定義のファイル", () => readFieldsFile(fieldsFile));
          const origin = trustedOrigin(w.mode, w.root, f.file, input.profile);
          const baseUrl = origin.baseUrl;
          // 検査は子プロセスで（時間とメモリの上限。print-craft の docs/authoring-try-plan.md 4.6）
          const r = await normalizeInChild(w.evaluator, { settingsText: f.text, settingsFile: f.relPath, fields, policy: w.policy, check: input.check === true, baseUrl });
          logDiscardedOutput(ctx, r.diag);
          const findings = r.findings.items as unknown as Finding[];
          const checkDiffs = r.checkDiffs ? { count: r.checkDiffs.length, items: r.checkDiffs.slice(0, MAX_CHECK_DIFFS) } : undefined;
          if (!r.output) return failure("invalid", "NormalizeError", `normalize のエラーがある: ${r.summary}`, findings);
          return ok({ path: f.relPath, summary: r.summary, ...(r.size ? { size: r.size } : {}), ...(checkDiffs ? { checkDiffs } : {}), ...originFields(origin) }, { findings, digest: f.digest });
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
