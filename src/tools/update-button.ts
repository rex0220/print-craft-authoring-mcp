/**
 * pcraft_update_button（既存の設定のボタン 1 つの差し替え・追加。実装案 5.1、5.3）: 中核の updateButton。
 * pcraft_buttons が返した digest（expectedDigest）を照合し、違えば conflict。ボタンは menu の名前で選び、無ければ末尾に足す。
 * 説明は「何をするか」と「結果を推し量らず必ず呼ぶ」にとどめる（試作 0-3b。5.2）
 */
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { MAX_SAVE_INPUT_BYTES, updateButton } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { fromSaveResult, isToolResult, prepare, workspaceIdSchema } from "./common.ts";
import { fromError, trustedBaseUrl } from "./files.ts";

export function registerUpdateButton(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_update_button",
    {
      title: "印刷屋の設定のボタンを差し替え",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の既存の設定 JSON の、ボタン 1 つ（menu の名前で選ぶ。無ければ末尾に足す）を、検査（normalize）を通して差し替える。" +
        "expectedDigest には pcraft_buttons が返した digest を渡す（読んだ後に変わっていれば保存しない）。" +
        "保存できるか・結果を推し量らず、必ずこのツールを呼び、返った status と findings をそのまま利用者に伝える。警告は消さずに伝える",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("設定 JSON のファイル（作業フォルダーからの相対パス）"),
          button: z.string().min(1).max(200).describe("差し替えるボタンの名前（menu）。無ければ末尾に足す"),
          expectedDigest: z.string().regex(/^[0-9a-f]{64}$/).describe("pcraft_buttons が返した digest（sha256 の 16 進 64 文字）"),
          replacement: z.string().min(1).max(MAX_SAVE_INPUT_BYTES).describe("ボタン 1 つ（pluginInfos の 1 行）の JSON。menu は button と同じ。UTF-8 で 256 KiB まで"),
          fields: z.string().min(1).max(512).optional().describe("項目定義のファイル（作業フォルダーからの相対パス）。アプリのフォルダー kintone/… の中の設定なら省略する")
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    (input) =>
      ctx.serial(async () => {
        try {
          const w = await prepare(ctx, input.workspaceId);
          if (isToolResult(w)) return w;
          const baseUrl = trustedBaseUrl(ctx, w.root, path.resolve(w.root, input.path));
          const r = await updateButton(
            { root: w.root, engine: w.engine, policy: w.policy, baseUrl },
            { path: input.path, button: input.button, expectedDigest: input.expectedDigest, replacement: input.replacement, fields: input.fields }
          );
          return fromSaveResult(r);
        } catch (e) {
          return fromError(e);
        }
      })
  );
}
