/**
 * pcraft_docs（手順と資料。実装案 5.1 ②、5.5）: 作業フォルダーを使わない（互換表の判定も通さない）。読み取りだけ、文章だけ。
 * 説明に利用者の言葉（印刷屋、帳票、見積書・請求書の PDF、印刷屋の設定）と「最初に呼ぶ」を書く（試作 0-4: あいまいな依頼でも結び付いた）
 */
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ServerContext } from "../context.ts";
import { DOCS, indexText, search, sectionKeys, sectionOf, sectionText } from "../docs.ts";
import { failure } from "../result.ts";

const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });

export function registerDocs(server: McpServer, _ctx: ServerContext): void {
  server.registerTool(
    "pcraft_docs",
    {
      title: "印刷屋の帳票づくりの手順と資料",
      description:
        "kintone の印刷屋プラグイン（rex0220 Print craft）で帳票（見積書・請求書・納品書・一覧表などの PDF）のボタン・設定を作る・直すとき、最初に呼ぶ。手順と資料（読み取りだけ）。" +
        "引数なしで目次（作業の順・決まり・章の一覧）、section でその章、query で資料から探す（関数名など。大きい資料は全部を読まない）。「印刷屋の設定」「帳票を作りたい」と言われたらまずこれ",
      inputSchema: z
        .object({
          section: z.string().min(1).max(60).optional().describe("章の名前（目次の section。例 howto-new、recipes、function-detail）"),
          query: z.string().min(1).max(100).optional().describe("探す言葉（関数名など。例 TABLE_HTML。空白で区切ると全部を含む節。例 ${ 改行）。section と一緒ならその章だけから")
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      if (DOCS.sections.length === 0) return failure("failed", "DocsMissing", "資料が埋め込まれていない（ビルドの誤り）");
      if (input.section !== undefined && !sectionOf(input.section)) {
        return failure("invalid", "UnknownSection", `知らない section: ${input.section}。使える名前: ${sectionKeys().join("、")}`);
      }
      if (input.query !== undefined) {
        const r = search(input.query, input.section);
        if (r.count === 0) return text(`「${input.query}」に合う節は無い${input.section ? `（section: ${input.section}）` : ""}。目次は引数なしの pcraft_docs`);
        return text(`「${input.query}」に合う節 ${r.count} 件${r.truncated ? "（上限で打ち切った。言葉を絞る）" : ""}:\n\n${r.text}`);
      }
      if (input.section !== undefined) return text(sectionText(sectionOf(input.section)!));
      return text(indexText());
    }
  );
}
