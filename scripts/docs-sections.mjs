// pcraft_docs の章（section）の一覧と、その元のファイル（build-mcp.mjs が読み、本体に埋め込む。実装案 5.5）。
//   guide: このリポジトリの guide/（print-craft MCP のツールで書いた手順。テンプレートの CLAUDE.md を元にした）
//   ref:   references/template/（テンプレートの docs/ の写し。scripts/sync-references.mjs）
// 順番が目次の順。キーは英数字（AI が打ち間違えにくく、Desktop のツールの引数でも崩れない）
export const DOC_SECTIONS = [
  { key: "howto-new", title: "新しい設定を作る（手順）", guide: "howto-new.md" },
  { key: "howto-edit", title: "既存の設定を変える（ボタンの追加・修正）", guide: "howto-edit.md" },
  { key: "try", title: "式と帳票の試し（お試しアプリ。pcraft_try。使う場面の決まり）", guide: "try.md" },
  { key: "results", title: "結果の読み方（status、normalize のエラー・警告、断る場合）", guide: "results.md" },
  { key: "constraints", title: "制約（守らないと動かない・壊れる）", guide: "constraints.md" },
  { key: "usable", title: "使えるもの（関数・CSS の class・置き換えタグ）", guide: "usable.md" },
  { key: "deploy", title: "反映方法（設定画面でアップロード）", guide: "deploy.md" },
  { key: "connections", title: "kintone の接続とアプリのフォルダー（接続のファイル。profile、kintone/<profile>/<番号>-<アプリ名>/）", guide: "connections.md" },
  { key: "recipes", title: "帳票レシピ集（0 章が既定の形。R1 見積書 … R7 Web フォント）", ref: "docs/帳票レシピ集.md" },
  { key: "patterns", title: "計算パターン（和暦・曜日・支払期限・年度、文字列、空・比較・端数。✔ はお試しアプリで確かめた例）", ref: "docs/計算パターン.md" },
  { key: "patterns-verified", title: "計算パターンの検証の結果（式ごとの結果）", ref: "docs/計算パターン_検証.md" },
  { key: "report-functions", title: "印刷屋の関数・置き換えタグ・エスケープ", ref: "docs/帳票関数リファレンス.md" },
  { key: "spec", title: "設定ファイル仕様（キーの意味・列挙・上限）", ref: "docs/設定ファイル仕様.md" },
  { key: "field-types", title: "項目の型ごとの値の形（計算式）", ref: "docs/フィールドタイプ別仕様.md" },
  { key: "function-list", title: "計算式の関数一覧（大きい。query に関数名）", ref: "docs/関数一覧.md" },
  { key: "function-detail", title: "計算式の関数リファレンス（詳細。大きい。query に関数名）", ref: "docs/関数リファレンス（詳細）.md" },
  { key: "function-articles", title: "計算式の関数の使い方（記事。大きい。query に関数名）", ref: "docs/関数の使い方（計算式プラグインの記事）.md" },
  { key: "css-defaults", title: "共通 CSS の既定の class（cssInfo.json）", ref: "docs/defaults/cssInfo.json" },
  { key: "sample-quote", title: "雛形: 見積書（詳細画面。派生値なし。新しいボタンはこれを写す）", ref: "docs/samples/見積書/settings-source.json" },
  { key: "sample-list", title: "雛形: 一覧帳票（派生値なし）", ref: "docs/samples/一覧帳票/settings-source.json" }
];
