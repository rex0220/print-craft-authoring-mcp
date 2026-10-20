/**
 * pcraft_save_settings（新しい設定の保存。実装案 5.1 ①、5.3）: 中核の saveNewSettings。同じ名前があれば conflict（上書きしない）。
 * 説明は「何をするか」と「結果を推し量らず必ず呼ぶ」にとどめ、断る場合の一覧は書かない（試作 0-3b: Desktop の AI が説明から推し量って
 * ツールを呼ばずに答えた。断る場合は pcraft_docs に置く。5.2）
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_SAVE_INPUT_BYTES, saveNewSettings } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { fromSaveResult, isToolResult, prepare, workspaceIdSchema } from "./common.ts";
import { checkRelPaths, fromError, originFields, trustedOrigin } from "./files.ts";
import { profileSchema } from "./kintone.ts";

export function registerSaveSettings(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_save_settings",
    {
      title: "印刷屋の新しい設定を保存",
      description:
        "kintone の印刷屋プラグイン（rex0220 Print craft）の新しい設定 JSON（封筒形式。帳票のボタン）を、検査（normalize）を通して作業フォルダーに保存する。上書きはしない。" +
        "保存できるか・結果を推し量らず、必ずこのツールを呼び、返った status（ok / invalid / conflict / denied / failed）と findings をそのまま利用者に伝える。警告は保存を止めないが、消さずに伝える",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("保存先。作業フォルダーからの相対パス（例 settings/APP3740-見積書-ご提案書.json）"),
          content: z.string().min(1).max(MAX_SAVE_INPUT_BYTES).describe("設定 JSON（封筒形式）の全文。UTF-8 で 256 KiB まで"),
          fields: z.string().min(1).max(512).optional().describe("項目定義のファイル（作業フォルダーからの相対パス。例 fields/3740.json）。アプリのフォルダー kintone/… の中に保存するときは省略する（同じフォルダーの fields.json を使う）"),
          expectedAbsent: z.literal(true).describe("同じ名前のファイルが無いこと（上書きしない）。true だけ"),
          profile: profileSchema.describe("kintone の接続のファイルの profile（preview の iframe と外部 URL の判定に使う接続先。アプリのフォルダー kintone/<profile>/… の中のファイルは省略する。省略すると defaultProfile、無ければ dev。決まらなければ接続先なし）"),
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (input) =>
      ctx.serial(async () => {
        try {
          checkRelPaths({ path: input.path, fields: input.fields });
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const origin = trustedOrigin(w.mode, w.root, path.resolve(w.root, input.path), input.profile);
          const r = await saveNewSettings(
            { root: w.root, evaluator: w.evaluator, policy: w.policy, baseUrl: origin.baseUrl, mode: w.mode },
            { path: input.path, content: input.content, fields: input.fields, expectedAbsent: input.expectedAbsent }
          );
          return fromSaveResult(r, originFields(origin));
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
