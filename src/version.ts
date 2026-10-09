/**
 * 版（実装案 5.5、7 章）。この呼び出しに答えた常駐のプロセスの版を、instructions の 1 行目と pcraft_status / pcraft_docs に出す
 * （更新の後も古いプロセスが動き続けることがある。kSQL の B101、試作 0-3b で Desktop が 0-4 のまま答えた）
 */
import { toolsMeta } from "./core.ts";

declare const __PCRAFT_MCP_VERSION__: string;

/** print-craft MCP の版（build-mcp.mjs が package.json から埋め込む） */
export const VERSION: string = typeof __PCRAFT_MCP_VERSION__ === "string" ? __PCRAFT_MCP_VERSION__ : "0.0.0-dev";

export function coreVersion(): { toolsVersion: string; commit: string } {
  const m = toolsMeta();
  return { toolsVersion: m.toolsVersion, commit: m.commit };
}

export function versionLine(): string {
  const c = coreVersion();
  return `print-craft MCP ${VERSION}（中核 @rex0220/print-craft-authoring-tools ${c.toolsVersion}、commit ${c.commit}）`;
}
