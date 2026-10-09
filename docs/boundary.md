# 配布物と秘密の値の境界（段階 0-1 ⑤）

2026-10-09 作成。何がどのプロセス・どの配布物にあり、どのデータがどの境界を越えるかを図と表にする。承認: Takashi（2026-10-09）。

## 1. 配布物（実装案 2 章、5.3、8 章）

```
[print-craft-authoring]（公開、MIT）
  ├─ テンプレート（CLAUDE.md、.claude/settings.json、.mcp.json = 公式の kintone MCP、policy/、environments.example.json）
  ├─ npm @rex0220/print-craft-authoring-core   … 共通の中核（ライブラリ）
  └─ npm @rex0220/print-craft-authoring-tools  … 今の CLI（core を使う）

[print-craft-authoring-mcp]（公開、MIT）
  ├─ print-craft MCP のビルド（core と依存を 1 つのファイルに束ねる。8.3）
  ├─ .mcpb（GitHub のリリース）  = ビルド + manifest（user_config、privacy_policies）+ 起動のファイル
  └─ Claude Code のプラグイン    = ビルド + .mcp.json（--surface claude-code）+ skills/ + hooks/ + compat.json

どの配布物にも入れない: 印刷屋のコード（利用者の zip から読む）、.env、env/、records/、out/、実案件の設定、秘密の値
```

## 2. 実行のときの境界（Desktop のチャット）

```
┌───────────────── 利用者の PC ─────────────────────────────────────────────┐
│                                                                             │
│  Claude Desktop                                                             │
│   ├─ 設定項目の保管（user_config。sensitive の保管先は未確認）              │
│   │     kintoneBaseUrl / kintoneApiToken / pluginZip / workspaceDir         │
│   │                    │ ① 起動のとき: 環境変数（トークン）と引数（パス）   │
│   │                    ▼                                                   │
│   │   ┌──── print-craft MCP（Desktop 同梱の Node。1 つのプロセス）────┐    │
│   │   │  中核（core）                                                  │    │
│   │   │  印刷屋の zip のコード（受け入れた危険。同じプロセス）          │    │
│   │   │  認証情報（メモリだけ。応答・ログに出さない）                   │    │
│   │   └──────┬───────────────────────┬────────────────────┬──────┘    │
│   │          │② MCP（stdio）           │③ ファイル            │④ HTTPS GET │
│   │          ▼                         ▼                      ▼            │
│   └─ Claude（モデル）との会話   作業フォルダー（workspaceDir） │            │
│         ↕ Anthropic                fields/ records/ settings/ │            │
│                                     out/ kintone/ inbox/       │            │
└────────────────────────────────────────────────────────────────┼────────────┘
                                                                 ▼
                                                   利用者の kintone（*.cybozu.com など）
```

## 3. 境界を越えるデータ

| 境界 | 越えるもの | 越えないもの |
| --- | --- | --- |
| ① 設定項目 → print-craft MCP | トークン（環境変数 `mcp_config.env`。要確認 0-4）、接続先、zip と作業フォルダーのパス（引数） | — |
| ② print-craft MCP → Claude（モデル。会話は Anthropic に送られる） | 項目定義の要約（ラベル・フィールドコード・型・選択肢）、レコードの**形の要約**、アプリの情報（ID・名前・コード）、新しく作った設定・ボタンの中身（data: の URL は先頭と長さ）、normalize / preview の結果、版・診断、資料（`pcraft_docs`） | **認証情報**、**レコードの値**（Desktop）、作成者・更新者・選択肢のユーザーのコード、kintone のサーバーの message、作業フォルダーの外のファイル、印刷屋の zip の中身 |
| ③ print-craft MCP ↔ 作業フォルダー | 項目定義（`fields.json`）、レコードの値（`records/`。preview の入力）、設定、preview の HTML（`out/`。レコードの値を含む） | 秘密の値（作業フォルダーに書かない） |
| ④ print-craft MCP → kintone | GET の要求（許可した API だけ）、認証の見出し（`X-Cybozu-API-Token`） | 書き込み（GET だけ） |
| print-craft MCP → その他 | 無し（rex0220 や第三者には送らない。preview の HTML が承認済みの Web フォントを読むのは、利用者がブラウザーで開いたとき） | — |

## 4. Claude Code（プラグイン）の場合の違い

```
Claude Code
 ├─ userConfig（secure storage）── ${user_config.*} ──▶ print-craft MCP（--surface claude-code。利用者の Node）
 ├─ フック（hooks/。Claude Code のプロセスの中）
 │     ・print-craft MCP の作業フォルダーを使うツールの workspaceId を書き換える
 │     ・直接の Write / Edit、設定ファイルの丸ごとの表示、ブラウザーの起動を拒否
 ├─ 公式の kintone MCP（テンプレートの .mcp.json + .env）── レコードの値を含めて AI に返す（今のまま）
 └─ Bash（AI が使う）── 秘密の値を渡さない（$.env.set を使わない）
```

| | Desktop | Claude Code |
| --- | --- | --- |
| kintone の値を AI に返す口 | 無し（形の要約だけ） | 公式の kintone MCP（今のまま） |
| print-craft MCP の認証情報の置き場 | `.mcpb` の設定項目 | プラグインの `userConfig` |
| kintone MCP の認証情報の置き場 | 使わない | `.env`（今のまま） |
| 強制の場所 | print-craft MCP だけ | print-craft MCP + フック + `.claude/settings.json` |

## 5. プライバシーポリシー（`PRIVACY.md`）に書くことの元

3 章の表をそのまま元にする（実装案 8.2）。データの送り先は利用者が設定した kintone だけ、AI に渡るものは ② の列、手元に残るものは ③ の列、秘密の値は ① と「越えないもの」。

## 6. 未決

無し。要確認は `sensitive` の保管先と環境変数で届くか（0-4。threat-model.md M11）。
