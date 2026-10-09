/**
 * pcraft_record（レコード 1 件。実装案 5.1、5.4）: kintone からレコードを取り、作業フォルダーに保存して（preview の入力）、形の要約だけを返す
 * （文字数・行数・数値の桁・テーブルの行数・添付の件数と種類。値は返さない。今の record --summary）。
 *   保存先: environments.json があればアプリのフォルダーの records/<番号>.json（アプリのフォルダーは pcraft_fields が作る）、無ければ records/<アプリ>-<番号>.json
 *   fieldsFrom（設定 JSON）を渡すと、その設定が使う項目だけに絞る（個人情報を減らす）
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { InputError, WRITE_ROOTS, describeRecord, fetchRecord, usedFieldCodes } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { incompatibleResult, workspaceIdSchema } from "./common.ts";
import { appDirIn, checkRelPaths, fromError, readSettingsFile, rel, writeChecked } from "./files.ts";
import { appIdOf, appSchema, envSchema, kintoneFor } from "./kintone.ts";

export function registerRecord(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_record",
    {
      title: "kintone のレコードを取る（preview 用）",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の帳票の試し出力（pcraft_preview）に使うレコード 1 件を kintone から取り、作業フォルダーに保存する。返すのは形の要約だけ（値は返さない）。" +
        "代表の 1 件（明細が複数行、備考に改行、添付あり）を選ぶ。kintone には読み取り（GET）だけ。保存したファイルはレコードの値を含む（コミットしない）",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          app: appSchema,
          id: z.number().int().positive().describe("レコード番号"),
          env: envSchema,
          fieldsFrom: z.string().min(1).max(512).optional().describe("この設定 JSON が使う項目だけに絞る（作業フォルダーからの相対パス。normalize した設定）"),
          guestSpaceId: z.number().int().positive().optional().describe("ゲストスペースのアプリならスペースの番号")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        checkRelPaths({ fieldsFrom: input.fieldsFrom });
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const target = kintoneFor(ctx, root, input.env);
        const appId = appIdOf(target, input.app);
        let outRel: string;
        let roots: readonly string[];
        if (target.ws && target.env) {
          const dir = appDirIn(root, target.env, appId);
          if (!dir) throw new InputError(`アプリ ${appId} のフォルダー（kintone/${target.env.host}/${appId}-…）が無い。先に pcraft_fields で項目定義を取る`);
          outRel = path.join(dir, "records", `${input.id}.json`);
          roots = WRITE_ROOTS.kintone;
        } else {
          outRel = path.join(root, "records", `${appId}-${input.id}.json`);
          roots = WRITE_ROOTS.records;
        }
        let keep: Set<string> | undefined;
        const notes: string[] = [];
        if (input.fieldsFrom) {
          const codes = usedFieldCodes(readSettingsFile(root, input.fieldsFrom).settings);
          if (codes) keep = codes;
          else notes.push(`${input.fieldsFrom} に使う項目の情報（usedFields）が無いので絞らなかった（normalize した設定なら絞れる）`);
        }
        const file = await fetchRecord(target.client, { app: appId, id: input.id, guestSpaceId: input.guestSpaceId, keep });
        const existed = existsSync(outRel);
        const out = writeChecked(root, outRel, `${JSON.stringify(file, null, 2)}\n`, roots, "record");
        return ok({
          path: rel(root, out),
          appId,
          id: input.id,
          shape: describeRecord(file),
          ...(existed ? { replaced: true } : {}),
          note: ["保存したファイルはレコードの値を含む（コミットしない）。値は AI に返さない", ...notes].join("。"),
          auth: target.authLabel,
          baseUrl: target.client.baseUrl
        });
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
