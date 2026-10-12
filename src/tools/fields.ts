/**
 * pcraft_fields（項目定義。実装案 5.1、15.8）: kintone から項目定義・レイアウト・アプリ名を取り、アプリのフォルダー kintone/<profile>/<番号>-<アプリ名>/fields.json に
 * 保存して、要約（1 項目 1 行）を返す。フォルダーが無ければ作る（中身より先に印を置く。15.5）。印が今の接続のこのアプリのものでなければ、kintone に送る前に conflict。
 * 関連レコード一覧（印刷屋 Ver.8。実装案 17 章）: 参照先のアプリの項目定義も、その profile の tokenMap のそのアプリのトークンで取り、fields.json の related に入れる（中核 tools 2.1.0）。
 * 取れなかった関連レコード一覧は findings（fields.related）に理由を出す
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WRITE_ROOTS, appDirFor, ensureAppFolder, fetchFields, listFields } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { incompatibleResult, workspaceIdSchema } from "./common.ts";
import { checkWritable, fromError, precheckAppWrite, rel, writeChecked } from "./files.ts";
import { appSchema, kintoneFor, profileFor, profileSchema } from "./kintone.ts";

/** 要約の上限（AI に返す量） */
const MAX_SUMMARY_CHARS = 64 * 1024;

export function registerFields(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_fields",
    {
      title: "kintone の項目定義を取る",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の帳票を作るアプリの項目定義（項目コード、型、ラベル、選択肢、テーブルの子など）を kintone から取り、作業フォルダーのアプリのフォルダーに保存して、1 項目 1 行の要約を返す。" +
        "帳票の計算式と HTML にはラベルでなく項目コードを書く。関連レコード一覧（REFERENCE_TABLE）があれば参照先の項目定義も取り、要約に「親コード$参照先の項目コード」で出す（印刷屋 Ver.8 で帳票の計算式に使える）。kintone には読み取り（GET）だけ。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          app: appSchema,
          profile: profileSchema,
          preview: z.boolean().optional().describe("動作テスト環境（保存して未反映）の項目定義（アプリ管理の権限が要る）")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const t = profileFor(ctx, root, input.profile);
        const appId = input.app;
        // 保存先に書けるか（実体が作業フォルダーの中、印が今の接続のこのアプリのもの）を kintone に送る前に確かめる
        const existing = precheckAppWrite(root, t.def, appId, "fields.json", "fields", t.mode);
        const k = kintoneFor(t, appId);
        // 参照先のアプリ（関連レコード一覧）は同じ profile のそのアプリの認証で（tokenMap に無ければ中核が relatedNotes に残す）
        const file = await fetchFields(k.client, { app: appId, preview: input.preview === true, guestSpaceId: k.guestSpaceId, relatedClientFor: (relatedApp) => kintoneFor(t, relatedApp).client });
        const dir = existing ?? appDirFor(root, t.def.profile, appId, file.appName);
        const target = path.join(dir, "fields.json");
        checkWritable(root, target, WRITE_ROOTS.kintone, "fields", t.mode);
        ensureAppFolder(dir, t.def, appId);
        const out = writeChecked(root, target, `${JSON.stringify(file, null, 2)}\n`, WRITE_ROOTS.kintone, "fields", t.mode);
        let summary = listFields(file);
        const truncated = summary.length > MAX_SUMMARY_CHARS;
        if (truncated) summary = `${summary.slice(0, MAX_SUMMARY_CHARS)}\n…（打ち切った。全体は ${rel(root, out)}）`;
        const related = Object.entries(file.related ?? {}).map(([code, r]) => [code, { app: r.app, appName: r.appName, fieldCount: Object.keys(r.properties).length }] as const);
        const findings = [
          ...(file.relatedNotes ?? []).map((message) => ({ level: "warning", rule: "fields.related", message: `${message}（参照先のアプリのトークンを接続のファイルの tokenMap に足すか、参照する権限を付けて pcraft_fields で取り直す）` })),
          ...(truncated ? [{ level: "info", rule: "truncated", message: "要約を打ち切った" }] : [])
        ];
        return ok(
          {
            path: rel(root, out),
            appId,
            appName: file.appName,
            fieldCount: Object.keys(file.properties).length,
            ...(related.length ? { related: Object.fromEntries(related) } : {}),
            summary,
            profile: t.def.profile,
            ...(k.guestSpaceId ? { guestSpaceId: k.guestSpaceId } : {}),
            auth: k.authLabel,
            baseUrl: k.client.baseUrl
          },
          findings.length ? { findings } : {}
        );
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
