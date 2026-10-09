/**
 * pcraft_fields（項目定義。実装案 5.1）: kintone から項目定義・レイアウト・アプリ名を取り、作業フォルダーに保存して、要約（1 項目 1 行）を返す。
 *   保存先: environments.json があればアプリのフォルダー kintone/<ホスト名>/<番号>-<アプリ名>/fields.json（本番の環境は denied。
 *   本番の項目定義は開発の環境で取る。4.2 の P7）、無ければ fields/<番号>.json
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WRITE_ROOTS, appDirFor, fetchFields, listFields } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { incompatibleResult, workspaceIdSchema } from "./common.ts";
import { fromError, rel, writeChecked } from "./files.ts";
import { appIdOf, appSchema, envSchema, kintoneFor } from "./kintone.ts";

/** 要約の上限（AI に返す量） */
const MAX_SUMMARY_CHARS = 64 * 1024;

export function registerFields(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_fields",
    {
      title: "kintone の項目定義を取る",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の帳票を作るアプリの項目定義（項目コード、型、ラベル、選択肢、テーブルの子など）を kintone から取り、作業フォルダーに保存して、1 項目 1 行の要約を返す。" +
        "帳票の計算式と HTML にはラベルでなく項目コードを書く。kintone には読み取り（GET）だけ。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          app: appSchema,
          env: envSchema,
          preview: z.boolean().optional().describe("動作テスト環境（保存して未反映）の項目定義（アプリ管理の権限が要る）"),
          guestSpaceId: z.number().int().positive().optional().describe("ゲストスペースのアプリならスペースの番号")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const target = kintoneFor(ctx, root, input.env);
        const appId = appIdOf(target, input.app);
        const file = await fetchFields(target.client, { app: appId, preview: input.preview === true, guestSpaceId: input.guestSpaceId });
        const out =
          target.ws && target.env
            ? writeChecked(root, path.join(appDirFor(root, target.env, appId, file.appName), "fields.json"), `${JSON.stringify(file, null, 2)}\n`, WRITE_ROOTS.kintone, "fields")
            : writeChecked(root, path.join(root, "fields", `${appId}.json`), `${JSON.stringify(file, null, 2)}\n`, WRITE_ROOTS.fields, "fields");
        let summary = listFields(file);
        const truncated = summary.length > MAX_SUMMARY_CHARS;
        if (truncated) summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}\n…（打ち切った。全体は ${rel(root, out)}）`;
        return ok(
          { path: rel(root, out), appId, appName: file.appName, fieldCount: Object.keys(file.properties).length, summary, auth: target.authLabel, baseUrl: target.client.baseUrl },
          truncated ? { findings: [{ level: "info", rule: "truncated", message: "要約を打ち切った" }] } : {}
        );
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
