/**
 * Desktop の kintone の GET（実装案 5.4、6.3。Claude Code では公式の kintone MCP を使うので出さない）。
 *   - kintone_get_app: アプリ 1 件の情報のうち決めた項目だけ（appId、name、code、spaceId、threadId。作成者・更新者・説明は返さない）
 *   - kintone_list_records: レコードを数件（固定の 5 件）、形の要約だけ（値・ファイル名・ユーザー名は返さない）。query は条件と並べ替えだけ
 * アプリは番号か URL（オリジンが接続先と同じときだけ）。名前検索はしない（apps.json は API トークンで使えない）
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { QUERY_MAX, listRecordShapes } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { workspaceIdSchema } from "./common.ts";
import { fromError } from "./files.ts";
import { appRefOf, envSchema, kintoneFor } from "./kintone.ts";

/** 返す文字の長さの上限（アプリ名など） */
const MAX_TEXT = 200;
const cut = (v: unknown): string | undefined => (typeof v === "string" ? v.slice(0, MAX_TEXT) : undefined);

const appRefSchema = z
  .union([z.number().int().positive(), z.string().min(1).max(2048)])
  .describe("アプリの番号か、アプリの URL（https://<サブドメイン>.cybozu.com/k/<番号>/。ゲストスペースは /k/guest/<スペース>/<番号>/）");

export function registerKintoneGet(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "kintone_get_app",
    {
      title: "kintone のアプリの情報",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の帳票を作る kintone のアプリ 1 件の情報（番号、名前、アプリのコード、スペース）を取る。アプリは番号か URL で指定する（名前で探せない。利用者に番号か URL を聞く）。読み取りだけ",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface), app: appRefSchema, env: envSchema }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const target = kintoneFor(ctx, root, input.env);
        const ref = appRefOf(input.app, target.client.baseUrl);
        const app = await target.client.get<Record<string, unknown>>("app", { id: ref.appId }, ref.guestSpaceId);
        return ok({
          appId: Number(app.appId),
          name: cut(app.name),
          code: cut(app.code) ?? "",
          spaceId: app.spaceId == null ? null : String(app.spaceId),
          threadId: app.threadId == null ? null : String(app.threadId),
          ...(ref.guestSpaceId ? { guestSpaceId: ref.guestSpaceId } : {}),
          baseUrl: target.client.baseUrl
        });
      } catch (e) {
        return fromError(e);
      }
    }
  );

  server.registerTool(
    "kintone_list_records",
    {
      title: "kintone のレコードの形を数件",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の帳票の試し出力に使う代表のレコードを選ぶため、レコードを 5 件まで、形の要約だけで返す（値は返さない）。" +
        "query は条件と並べ替えだけ（limit / offset は書かない）。選んだら pcraft_record で保存する。読み取りだけ",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          app: appRefSchema,
          query: z.string().max(QUERY_MAX).optional().describe(`kintone の query の条件と並べ替え（${QUERY_MAX} 文字まで。limit / offset は書かない）`),
          env: envSchema
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const target = kintoneFor(ctx, root, input.env);
        const ref = appRefOf(input.app, target.client.baseUrl);
        const r = await listRecordShapes(target.client, { app: ref.appId, query: input.query, guestSpaceId: ref.guestSpaceId });
        return ok({ ...r, baseUrl: target.client.baseUrl }, r.truncated ? { findings: [{ level: "info", rule: "truncated", message: "返す量の上限（64 KiB）で打ち切った" }] } : {});
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
