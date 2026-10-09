# 使えるもの（積極的に使ってよい）

- `TABLE_HTML(テーブル, OPT("pref","pcraft-inv-item-"), ARRAY("#", ROWNO(テーブル)+1), 商品名, 数量, 単価, 金額)` — テーブルを表に。`OPT("pagination","Y","perPage","20")` で複数ページ、`OPT("type","card")` でカード形式
- `LET(table, TABLE_HTML(…), REPLACE($html, "##table##", table))` — HTML テンプレートの目印を計算式で置き換える形
- `FIELDS_HTML(項目, …)` — 項目をラベル付きで縦に並べるカード
- 共通 CSS の既定の class: `pcraft-table-*`（表）、`pcraft-card-*`（カード）、`pcraft-inv-*`（見積書・請求書）。一覧は `css-defaults`
- 置き換えタグ `#{&p}` / `#{&n}`（ページ番号）、`#{&f(fileKey)}`（添付ファイルの画像）、`#{&q(文字列)}`（QR）
- Web フォント: `fontInfo`（`enabled`、`preset`、`family`、`cssUrl`）。Google Fonts の URL は承認済み。PC・Mac・スマホで同じ字形にしたいときだけ
  - スマホの詳細画面のボタンは Web フォントが有効なとき（`enabled` が真で、`family` と https の `cssUrl` が正しい）だけ出る。スマホでも使う帳票なら有効にする
- 「ボタンを押したとき」 `printMode`: `preview`（既定）/ `confirm` / `direct`
- 多言語のボタン名 `menu_en` / `menu_zh`、説明 `desc_*`
  - 説明（`desc`）はプレビューの見出しに 24px の太字で出る。**16 文字前後の 1 行**にする（例「ご提案書の PDF を作ります」。英語の `desc_en` は 32 文字前後）。帳票の中身の説明は書かない
- 計算式の `//` コメント（`formulaSet` に書ける。保存のときに除いた `formula` を作る）

関数は `report-functions`（印刷屋の関数・置き換えタグ・エスケープ）、一般の計算式の関数は `function-list` / `function-detail` / `function-articles` に関数名の `query` を付けて読む（全部を読まない）。
