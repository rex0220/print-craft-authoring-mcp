/**
 * pcraft_buttons（ボタンの一覧と中身。実装案 5.1、5.3）: 中核の listButtons（data: の URL は先頭と長さだけ）、ファイル全体の digest、
 * ボタンの識別子（menu）。設定ファイルそのものは返さない（既存の設定の丸ごとの読み出しを止める。13.3）。読み取りだけ
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { listButtons } from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { workspaceIdSchema } from "./common.ts";
import { fromError, readSettingsFile } from "./files.ts";

export function registerButtons(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_buttons",
    {
      title: "印刷屋の設定のボタンの一覧",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の設定 JSON の、ボタンの一覧（出す画面、保存先、用紙、押したとき、表示条件、ファイル名、帳票の行、更新項目）か、button を付けるとそのボタンの HTML / CSS / 計算式。" +
        "ファイル全体の digest（pcraft_update_button に渡す）とボタンの名前（menu）も返す。設定ファイルそのものは返さない。読み取りだけ",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).describe("設定 JSON のファイル（作業フォルダーからの相対パス）"),
          button: z.string().min(1).max(200).optional().describe("中身を見るボタンの名前（menu）。省略すると一覧")
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const f = readSettingsFile(root, input.path);
        const text = listButtons(f.settings, { file: f.relPath, button: input.button });
        const menus = (Array.isArray(f.settings.pluginInfos) ? f.settings.pluginInfos : []).map((r) => String((r as { menu?: unknown }).menu ?? ""));
        return ok({ path: f.relPath, menus, text }, { digest: f.digest });
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
