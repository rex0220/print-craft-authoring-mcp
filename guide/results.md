# 結果の読み方（status と findings）

ツールの結果は推し量らない。必ずツールを呼び、返った `status` と `findings` をそのまま利用者に伝える（保存できたか、断られたかを、前の結果やこの表から推し量って答えない）。

## status

| status | 意味 | すること |
| --- | --- | --- |
| `ok` | できた。`findings` に警告・情報があることがある | 警告は消さずに利用者に伝える |
| `invalid` | 設定の検査（normalize）のエラー、入力の誤り（項目定義のファイルが無い、JSON として読めない、ボタンの名前が無い、パスの形が違う（`./`・末尾の `/`・`//`）など） | `findings` のエラーと `error.message` を読んで直す |
| `incompatible` | print-craft MCP と合わない（印刷屋の zip の版が対応外、authoring API の版、互換表） | `error.message` のとおり利用者に頼む（print-craft MCP の更新か、アプリに入れたものと同じ版の zip） |
| `conflict` | 同じ名前のファイルがある（新しい設定の保存は上書きしない）、読んだ後にファイルが変わった（digest が違う）、別の保存が進行中 | 新しい設定なら別の名前に。既存のボタンを直すなら `pcraft_buttons` で読み直して `pcraft_update_button` |
| `denied` | 断った（下の「断る場合」） | 利用者に伝える。回り道をしない（Bash や別のツールで書かない） |
| `failed` | 印刷屋の zip が無い・読めない・読み込んだものと違う・前に読み込みに失敗した（zip を変えた・直したら再接続）、帳票を描けなかった（`RenderError`。誤りの文はレコードの値を含みうるので返らない）、kintone の誤り（HTTP の状態とエラーコード）、想定外の失敗 | `error.message` を利用者に伝える |

## 断る場合（denied）

- 作業フォルダーの外、`.env` などの読まないファイル。パスは作業フォルダーからの相対パスだけ（絶対パス・ドライブ名・`~`・`\`・`..` は断る。区切りは `/`）
- 作業フォルダーの外を指すフォルダーと `environments.json`（symlink など。リンク切れも）
- 登録していない作業フォルダー（Claude Code。登録したばかりなら `/mcp` で print-craft を再接続）
- 書けない場所（設定は `settings/` `temp/` と、開発の環境のアプリのフォルダー `kintone/<ホスト名>/<番号>-<アプリ名>/` だけ）
- 本番（`environments.json` の `role: production`）のアプリのフォルダーを変えること（本番のフォルダーは今の設定を見るためだけ。作るのも直すのも開発の環境）
- `role` の無い環境のフォルダー、`environments.json` が無いのに `kintone/` の下（利用者が `environments.json` に `role` を書くまで変えない）
- ダウンロード / pull のファイル（`rex0220-print-craft-app<番号>-<日時>.json`）を書き換えること

## normalize のエラー（invalid の findings。rule の名前）

| rule | 意味と直し方 |
| --- | --- |
| `json` / `schema` | JSON として読めない、型・上限が合わない。`spec`（設定ファイル仕様）のキーの表で確かめる |
| `envelope.pluginID` / `envelope.version` / `envelope.appId` | 封筒の誤り。封筒なしの素の設定は作らない。`envelope.version` は zip より新しい版の設定か Ver.5 以前 |
| `tags.rows` | HTML 設定の行の並び（1 行目 `$out`、2 行目 `$fname`、3 行目以降が帳票）、有効なボタンに HTML 設定が無い |
| `tags.pageSize` / `tags.orientation` / `tags.dpi` / `tags.printMode` | 列挙に無い値 |
| `tags.filecode` | 保存先がテーブルの外の添付ファイル項目でない |
| `menu.duplicate` | 有効なボタンの名前が重複している |
| `field.unknown` | 項目定義に無い項目（ラベルで書いた、綴りの違い、別アプリの項目） |
| `formula.syntax` | 計算式を評価できない（メッセージを読む） |
| `formula.comment` | 計算式の文字列の中に `//`（`"https://…"` など）。文字列の中でも `//` 以降を捨てる。URL は HTML の属性か `##目印##` に置く |
| `calc.ineligible` / `calc.duplicate` | 更新できない項目（計算項目、ルックアップのコピー先、テーブルの中、更新できない型）、同じ項目が 2 回 |
| `html.rule` / `css.rule` | 許可されていない要素・属性・URL・CSS の書き方（`constraints`） |
| `external.blocked` | `"block"` の設定の HTML / CSS の外部 URL。添付ファイルの `#{&f(…)}` か `data:image/` にする |
| `externalRefs.unapproved` / `externalRefs.value` | `"allow"` は利用者の承認（policy）が要る。AI は policy を書かない。値は `block` か `allow` |
| `font.url` | Web フォントの `cssUrl` が https でない |
| `size` | 保存値が 256 KB を超えた。data URL の画像を小さくするか添付ファイルにする |

## 警告（消さずに利用者に伝える）

| rule | 意味 |
| --- | --- |
| `html.rawExpression` | `${式}` が文字列を `ESC_HTML` なしで差し込んでいる。新しく書いた式なら `${ESC_HTML(項目)}` に直す |
| `formula.escape` | 計算式の文字列に `\n` など。`\` は解釈されないので改行にならない。`NEWLINE()` に直す |
| `formula.rawHtml` | 生の HTML を入れる関数（`TABLE_HTML`、`FVAL` など）。想定どおりなら伝えるだけ |
| `formula.attr` / `formula.html` | 要素名・属性にレコードの値や式を入れている、計算式の文字列の HTML / CSS の危険な書き方 |
| `preview.record` | 設定が使う項目が preview のレコードに無い（帳票では空になる）。`pcraft_record` に `fieldsFrom`（この設定）を付けて取り直す |
| `external.url` / `external.blocked` | `"allow"` の設定の未承認の外部 URL / 計算式の文字列の外部 URL（帳票に入れば除かれる） |

情報（保存値の大きさ、`envelope.version.upgrade` など）は要るときだけ伝える。
