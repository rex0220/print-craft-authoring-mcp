# 新しい設定を作る（print-craft MCP のツールで）

要件は利用者から受け取る（チャットか、作業フォルダーの `requirements/` のファイル）。各ツールの結果は推し量らず、必ず呼んで、返った `status` と `findings` をそのまま利用者に伝える。

1. **準備** — `pcraft_status` で `ready` を確かめる。`ready: false` なら `next` のとおりに利用者に頼む（作業フォルダー、印刷屋の zip、kintone の接続のファイルの設定）。接続は `pcraft_workspace_status`（profile ごとの接続先とトークン。`connections`）
2. **アプリ番号** — 要件に番号があればそれを使う。無ければ利用者に番号かアプリの URL を聞く（名前で探さない。同名・似た名前のアプリを推測しない）。profile（接続先）が複数あれば、どれのアプリかも確かめる。Desktop では `kintone_get_app` で名前を確かめる
3. **項目** — `pcraft_fields` で項目定義を取る（アプリのフォルダー `kintone/<profile>/<番号>-<アプリ名>/` ができる）。返った 1 項目 1 行の要約から、要件のラベルを**項目コード**に対応させ、その対応を利用者に示す。計算式と HTML にはラベルでなく項目コードを書く。似たラベル（「合計」「合計金額」など）は推測せず利用者に聞く。関連レコード一覧（REFERENCE_TABLE）があれば、参照先の項目も `親コード$参照先の項目コード` で要約に出る（印刷屋 Ver.8。テーブルと同じ関数で使える。ボタン表示条件・更新条件・一覧用のボタンでは使えない）。要約に「参照先の項目定義なし」と出たら、`findings`（`fields.related`）の理由を利用者に伝える（接続のファイルの `tokenMap` に参照先のアプリのトークンが要る）
4. **レコード** — preview に使う代表の 1 件（明細が複数行、備考に改行、添付あり）を選ぶ。Desktop は `kintone_list_records`（形だけ）、Claude Code は kintone MCP で数件を見て、利用者と決める。`pcraft_record` でアプリのフォルダーの `records/` に保存する（形だけが返る。値は返らない）。項目定義に関連レコード一覧の参照先があれば、参照先のレコードも印刷屋と同じ規則で取り、仮のテーブルとして同じファイルに入る（`fieldsFrom` を付けると、その設定が使う参照先の項目だけ。1,000 件を超えると取れない。印刷屋の zip が要る）
5. **帳票** — `pcraft_docs` の `recipes`（帳票レシピ集）の 0 章の既定の形: **HTML テンプレート + `${ESC_HTML(項目)}` + テーブルは `TABLE_HTML`**。CSS は共通 CSS（`css-defaults`）の差分だけ。雛形は `sample-quote`（詳細画面）、`sample-list`（一覧帳票）
6. **保存** — 雛形を写して**封筒形式**で書き、`pcraft_save_settings` でアプリのフォルダーに `<帳票名>.json` で保存する（例 `kintone/dev/3740-見積書/ご提案書.json`。1 ファイルに 1 帳票）。`fields` は渡さない（同じフォルダーの `fields.json` で検査する）。接続のファイルが無い作業フォルダーでは `settings/APP<アプリ番号>-<アプリ名>-<帳票名>.json` に、`fields` に項目定義のファイルを渡して保存する
   - 封筒: `pluginID` は `"rex0220 Print craft plugin"`、`PluginVersion` は印刷屋の版（`pcraft_status` の zip の版）、`externalRefs` は `"block"`
   - `filecode`（保存先。空ならダウンロード）、`pageSize`、`orientation`、`dpi`、`printMode` を明示する
   - 派生値（`formula` / `usedFields` / `id` / `views` / `pluginUOG`、更新項目の `type` など）は書かない（保存のときに作られる）
   - `cssInfo`（共通 CSS）は共通 CSS を変えるときだけ書く（帳票の CSS は行の `css` に書く）
   - `invalid` なら `findings` のエラーを直してもう一度（`results` の表）。警告は消さずに利用者に伝える
7. **preview** — `pcraft_preview` で帳票の HTML を `out/` に出す（アプリのフォルダーの設定なら `record` はレコード番号だけ。出す先はそのフォルダーの `out/`）。Claude Desktop では、帳票は会話の中のプレビュー（MCP App）に表示される（表示の許可を求められたら、利用者に許可してもらう）。表示されなければ Chrome で開いてもらう。out/ の HTML を読んだり、ほかのツールで会話に出したりしない（レコードの値が会話に入る）。利用者に Chrome で開いてもらい、印刷屋のプレビューと比べてもらう（近似。画像はダミー、Web フォントは読まない）。AI はブラウザーを起動しない。ページ数と式の誤りの場所は結果で確かめる（誤りの文とファイル名はレコードの値を含みうるので返らない。中身は利用者に out/ の HTML で見てもらう）
8. **反映方法を伝える** — `deploy` の手順。確かめてほしい点（見た目、改行、ファイル名、保存先）を添える
