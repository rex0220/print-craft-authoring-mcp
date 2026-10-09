/**
 * pcraft_workspace_status（作業フォルダーの診断。実装案 5.1 ③）: 作業フォルダーの照合は通す（未登録なら denied）が、互換表の判定は通さない。
 * environments.json の有無、環境ごとの role、未分類（role の無い）環境、印刷屋の zip の場所。読み取りだけ（13.3）
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { WorkspaceError } from "../binding.ts";
import { WORKSPACE_FILE, loadWorkspace } from "../core.ts";
import { zipGuide, zipOf, type ServerContext } from "../context.ts";
import { failure, ok, unexpected } from "../result.ts";
import { workspaceIdSchema } from "./common.ts";

export function registerWorkspaceStatus(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_workspace_status",
    {
      title: "印刷屋の作業フォルダーの診断",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の作業フォルダーの診断: environments.json の有無、環境ごとの役割（development / production）、役割の無い環境、印刷屋の zip の場所。次にすること（next）を返す。状態は推し量らず、このツールで確かめる。読み取りだけ",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface) }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      let root: string;
      try {
        root = ctx.binding.resolve(input.workspaceId);
      } catch (e) {
        if (e instanceof WorkspaceError) return failure("denied", "WorkspaceError", e.message);
        return unexpected(e);
      }
      try {
        const next: string[] = [];
        let environments: Record<string, unknown> | null = null;
        let problem: string | undefined;
        try {
          const ws = loadWorkspace(root);
          if (ws) {
            const envs = Object.values(ws.environments);
            environments = {
              default: ws.defaultEnv,
              list: envs.map((e) => ({ name: e.name, role: e.role, host: e.host })),
              apps: ws.apps.map((a) => ({ name: a.name, ids: a.ids }))
            };
            const unclassified = envs.filter((e) => e.role === "unclassified").map((e) => e.name);
            if (unclassified.length) next.push(`環境 ${unclassified.join("、")} に role が無い。利用者が ${WORKSPACE_FILE} に role（development か production）を書くまで、その環境のフォルダー（kintone/<ホスト名>/…）は変更できない`);
          }
        } catch (e) {
          problem = (e as Error).message;
          next.push(`${WORKSPACE_FILE} が読めない: ${problem}（利用者が直す。AI は書かない）`);
        }
        const zip = zipOf(ctx, root);
        if (zip.problem) next.push(`印刷屋の zip の設定が読めない: ${zip.problem}`);
        else if (!zip.zip) next.push(`印刷屋の zip が未設定。${zipGuide(ctx.surface)}`);
        return ok({
          ready: next.length === 0,
          next: next.length ? next : ["準備ができている"],
          workspace: root,
          environmentsJson: { exists: existsSync(path.join(root, WORKSPACE_FILE)), ...(environments ? { environments } : {}), ...(problem ? { problem } : {}) },
          pluginZip: { configured: zip.zip !== undefined, source: zip.source, ...(zip.zip ? { path: zip.zip } : {}), ...(zip.problem ? { problem: zip.problem } : {}) }
        });
      } catch (e) {
        return unexpected(e);
      }
    }
  );
}
