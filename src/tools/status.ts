/**
 * pcraft_status（作業フォルダーを使わない診断。実装案 5.1 ②）: サーバーの版、中核の版、出し分け、作業フォルダーの設定、印刷屋の zip の設定。
 * 準備ができているか（ready）と、足りないときに次にすること（next）を文でも返す（AI が手順の文から推し量らないように。5.2）。秘密の値は出さない
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { zipGuide, zipOf, type ServerContext } from "../context.ts";
import { ok } from "../result.ts";
import { VERSION, coreVersion } from "../version.ts";

export function registerStatus(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_status",
    {
      title: "印刷屋の環境の診断",
      description:
        "kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定づくりの環境の診断。サーバーの版、作業フォルダー、印刷屋プラグインの zip の設定。準備ができているか（ready）と、足りないときに次にすること（next）を返す。状態は推し量らず、このツールで確かめる。秘密の値は出さない。読み取りだけ",
      inputSchema: z.object({}).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      let workspace: Record<string, unknown>;
      let root: string | undefined;
      const next: string[] = [];
      if (ctx.surface === "desktop") {
        const ws = ctx.binding.desktopWorkspace();
        root = ws.root;
        workspace = ws.root ? { configured: true, path: ws.root } : { configured: false, problem: ws.problem };
        if (!ws.root) next.push(String(ws.problem));
      } else {
        workspace = { registered: ctx.binding.registered.roots, ignoredInvalidEntries: ctx.binding.registered.dropped };
        if (ctx.binding.registered.roots.length === 0) next.push("作業フォルダーが未登録。作業フォルダーで印刷屋のツール（pcraft_save_settings など）を呼ぶと登録の確認が出る（登録の後は /mcp で print-craft を再接続）");
      }
      const zip = zipOf(ctx, root);
      if (zip.problem) next.push(`印刷屋の zip の設定が読めない: ${zip.problem}`);
      else if (!zip.zip && (ctx.surface === "desktop" || ctx.env.PCRAFT_PLUGIN_ZIP !== undefined)) next.push(`印刷屋の zip が未設定。${zipGuide(ctx.surface)}`);
      else if (!zip.zip) next.push(`印刷屋の zip が未設定（作業フォルダーの .env にあれば使う）。${zipGuide(ctx.surface)}`);
      return ok({
        ready: next.length === 0,
        next: next.length ? next : ["準備ができている。手順と資料は pcraft_docs、作業フォルダーの診断は pcraft_workspace_status"],
        version: VERSION,
        core: coreVersion(),
        surface: ctx.surface,
        node: process.version,
        platform: process.platform,
        workspace,
        pluginZip: { configured: zip.zip !== undefined, source: zip.source, ...(zip.zip ? { path: zip.zip } : {}), ...(zip.problem ? { problem: zip.problem } : {}) }
      });
    }
  );
}
