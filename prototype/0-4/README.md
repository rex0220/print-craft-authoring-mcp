# 段階 0-4 の試作（Claude Desktop の `.mcpb`）

実装案（[../../docs/プラグイン化の実装案.md](../../docs/プラグイン化の実装案.md)）の 9 章 0-4。帳票は作らない。**本物の資格情報は使わない**（試験用の値か、本番でない kintone の閲覧だけの API トークン）。

| ファイル | 中身 |
| --- | --- |
| `server/hello.cjs` | hello の print-craft MCP（依存なし。`--surface desktop`）。ツール `pcraft_docs`、`pcraft_status`、`pcraft_workspace_status`、`kintone_probe`（任意） |
| `build-mcpb.mjs` | `.mcpb` を作る（manifest をここで組み立てる。無圧縮の zip。起動のファイルは `main()` を必ず呼ぶ）。kintone-sql-tools の `build-mcpb.mjs` を元にした |
| `verify-mcpb.mjs` | `.mcpb` の検査（manifest の値、展開して Desktop と同じ形で起動、JSON-RPC で話す、試験用のトークンが漏れない）。kintone-sql-tools の `scripts/mcpb-verify.mjs` を元にした（SDK は使わない） |

作り方と検査:

```sh
cd ~/Projects/kintone-plugin/print-craft-authoring-mcp
node prototype/0-4/build-mcpb.mjs     # → prototype/0-4/dist-mcpb/print-craft-proto.mcpb（git に入れない）
node prototype/0-4/verify-mcpb.mjs
```

## 自動で確かめたこと（2026-10-09。Mac、node v24.14.0）

`verify-mcpb.mjs` が通った:

- manifest: `manifest_version` 0.3、版は semver、`server.type: node`、起動のファイル、**秘密の値は引数でなく `mcp_config.env`**、`workspaceDir` はフォルダーを選ぶ・必須、API トークンは `sensitive`、`pluginZip` はファイルを選ぶ、`platforms` は darwin / win32、`runtimes.node >=20.0.0`
- 起動のファイルは `main()` を必ず呼ぶ
- 起動して: `instructions` の 1 行目に版、ツールの一覧が manifest と同じ、`inputSchema` は `additionalProperties: false`、`pcraft_docs` は文章だけで目次は版の行で始まる、作業フォルダーは起動時に固定・別の `workspaceId` は拒否、cwd は使わない
- 試験用のトークンが env で届き（文字数が合う）、引数・応答（標準出力）・標準エラーに出ない

manifest に `privacy_policies` は入れていない（試作。Desktop がインストールのときに求めるかを手で見る）。

## 手で確かめること（Takashi。Mac、後で Windows）

今の `.mcpb` は 0.0.3（作業フォルダーを作る。表示名とツールの説明を変えた）。0.0.1 を入れていれば、0.0.2 を入れるのが項目 9（更新）の 1 回目になる。

| # | すること | 期待・見ること | 結果 |
| --- | --- | --- | --- |
| 1 | `dist-mcpb/print-craft-proto.mcpb` をダブルクリック（または Desktop の Settings > Extensions > Advanced settings > Install Extension…） | インストールの画面に「印刷屋 設定オーサリング（試作 0-4）」と設定項目 4 つ。`privacy_policies` が無いことで止まるか・注意が出るか | |
| 2 | 設定項目を入れる: 作業フォルダー = 新しい空のフォルダー（例 `~/pcraft-proto-desktop`）、URL・トークン = 空か試験用、zip = 任意のファイル | フォルダー・ファイルを**選ぶ画面**が出るか。トークンの欄が伏せ字か | |
| 3 | インストールの後、拡張機能の設定画面を開く | **トークンが平文で見えないか**（公開の報告 MCPB issue #244） | 2026-10-09 Mac: **平文で見えない**（MCPB issue #244 の現象は出なかった） |
| 4 | 新しいチャットで「print-craft の pcraft_status を呼んで、結果をそのまま見せて」 | `node`（**Desktop 同梱の Node の版**）、`execPath`、`cwd`、`workspaceDirRaw` / `pluginZipRaw`（**選ぶ画面が返したパスの形**）、`token.set` / `length` / `appearsInArgv: false`（**env で届いたか**。公開の報告 MCPB issue #297） | 2026-10-09 Mac: Node **v24.21.0**（`execPath` は `/Applications/Claude.app/…/Claude Helper (Plugin).app/…`。Desktop のアプリの中のプロセス）。`cwd` は `/`。パスは `/Users/…` の絶対パス。**トークンは env で届いた**（`set: true`、文字数 5 = 試験用の値、引数に無い。`KINTONE_` の環境変数はこれだけ）。接続先は検査を通った。作業フォルダーは「存在しない」（下の気付き） |
| 5 | 新しいチャットで「印刷屋の設定の作り方を教えて」とだけ頼む | AI が自分で `pcraft_docs` を呼ぶか（**instructions と資料のツールを使うか**）。resources を探そうとしないか | 2026-10-09 Mac: **`pcraft_docs` を呼ばなかった**。「印刷屋の設定」を一般の言葉（印刷会社向けのアプリ、kintone プラグインの設定画面の作り方、プリンターの設定）として受け取り、聞き返した。指示（instructions）が AI に渡っていないのか、渡っているが言葉が弱いのかを 5b・5c で見分ける |
| 5b | 新しい会話で「拡張機能 print-craft のサーバーからの指示（instructions）に書いてあることを、そのまま教えて」 | 指示が AI に渡っているか | 2026-10-09 Mac: **指示は AI に渡っていない**（AI に見える MCP サーバーの指示は Claude in Chrome のものだけ）。ツールは遅れて読み込まれる形で、名前 `mcp__claude-device__lcl-0-4-pcraft_*` だけが見えている（`lcl-0-4-` は表示名の英数字の部分から作られたように見える。推測）。kSQL の B55（resources と prompts が届かない）と同じく、手元の MCP サーバーの中継（`claude-device`）ではツールだけが届く |
| 5c | 新しい会話で「kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定の作り方を教えて」 | はっきり言えば `pcraft_docs` を呼ぶか | 2026-10-09 Mac: **呼んだ**。はっきり「印刷屋プラグイン（rex0220 Print craft）」と言えば、AI は名前だけ見えているツールを探して `pcraft_docs` を呼び、目次と章（setup、overview）を読んだ |
| 5d | **0.0.3 を入れてから**、新しい会話で「印刷屋の設定を作って」（あいまい）、別の新しい会話で「見積書の帳票を作りたい」 | 0.0.3 は表示名に英数字（Print craft）を入れ、ツールの説明に利用者の言葉（帳票、見積書、印刷屋の設定）と「最初に呼ぶ」を書いた。ツールの名前の前置き（`lcl-…-`）がどう変わるか、あいまいな頼み方で `pcraft_docs` を呼ぶか | 2026-10-09 Mac（「印刷屋の設定を作って」）: **0.0.3 では、あいまいな頼み方でも AI が自分で print-craft のツールを読み込んで呼んだ**（ツールの呼び出し 4 回。名前と説明の工夫が効いた）。ただし AI の報告に誤り: 「作業フォルダーはまだ作成されていない」（実際は存在する。`created: false` の読み違いと見られる）、「接続情報は未設定」（実際は設定済み。`pcraft_status` を呼ばず、資料の setup の手順の文から推し量ったと見られる）。「見積書の帳票を作りたい」（印刷屋の言葉なし）: **結び付かず**、出力の形（Excel、PDF、kintone プラグイン）を聞き返した（あいまいな依頼としては妥当）。ツールの名前（0.0.3）: `mcp__claude-device__lcl-Print_craft-pcraft_docs` など 4 つ（0.0.2 までは `lcl-0-4-`）。**前置きは表示名の英数字の部分から作られる**（空白は `_`）。どれも遅れて読み込まれる |
| 6 | 「pcraft_workspace_status を呼んで」 | 設定のフォルダーが固定されている | |
| 7 | （任意。試験用の kintone があるとき。0.0.4 で動作テスト環境の API も確かめる）設定に URL と**閲覧だけの API トークン**を入れ、「kintone_probe を app <番号> で呼んで」 | `app` が 200 か。`pluginConfig`（**pull が使う API ラボの API**）が API トークンで通るか（403 / エラーコードなら API トークンでは使えない → Desktop では `pcraft_pull` を出さない。api-table.md） | 2026-10-09 Mac（0.0.4。アプリ 3740「見積書(印刷屋)」、開発用の kintone、API ラボ有効）: 閲覧だけの API トークンで、`app` 200、**`pluginConfig`（運用環境）200**、`pluginConfigPreview`（動作テスト環境）403 `GAIA_NO01`。アプリ管理の権限を外した後の結果（動作テスト環境が 403 になったことで外れたと分かる）。→ **運用中の設定の pull は閲覧だけのトークンで使える、`--preview` はアプリ管理が要る**。`app` の `kintoneCode: ""` はエラーコードでなくアプリのコード（未設定）を拾った試作の誤り |
| 8 | Desktop のログ（`~/Library/Logs/Claude/` の `mcp*.log`）を、試験用のトークンの文字列で検索する | 見つからない | 2026-10-09 Mac（一部）: 拡張機能ごとのログ（`mcp-server-印刷屋 設定オーサリング（試作 0-4）.log`）は呼び出しの名前だけで、引数・結果の中身は残らない。サーバーの標準エラーは `main.log` に `[UtilityProcess stderr]` で残り、`token=set` だけ。**試験用のトークンの文字列での検索はまだ** |
| 9 | `server/hello.cjs` の `VERSION` を `0.0.3-proto` に変えて作り直し、もう一度ダブルクリック | 更新できるか。同じ会話のまま `pcraft_status` の版が変わるか（変わらなければ再起動 + 新しい会話で変わるか。kSQL の B101） | 2026-10-09 Mac（0.0.1 → 0.0.2）: ダブルクリックで更新でき、**同じ会話のまま** `pcraft_status` の版が 0.0.2 になった（再起動・新しい会話は要らなかった）。更新のとき Desktop はサーバーを**続けて 4 回起動**した（`main.log`。13:50:26〜27）。作業フォルダーは 1 回目のプロセスが作り、答えたプロセスは `workspaceCreated: false`（下の気付き） |
| 10 | 拡張機能を外す（アンインストール）→ もう一度入れる | 前の設定項目（トークン）が残っているか・消えるか（**値の消し方**） | |
| 11 | Windows の Desktop で 1〜6 と 8〜10 | パスの形（ドライブ文字、`\`）、Node の版、env | |

気付いたこと（関門で決める候補）:

- **「フォルダー」の種類（`type: "directory"`）の設定項目は、存在しないパスも受け付けて、そのままサーバーに渡す**（2026-10-09。設定の欄にパスを入れただけで、フォルダーを作っていなかった）。起動時に確かめる仕組み（実装案 4.1。kSQL は仕様にあったがコードに無かった）が要る裏付け。サーバーは「作業フォルダーが存在しない」と返し、作業フォルダーを使うツールを止めた
- 作業フォルダーは起動時に固定するので、後からフォルダーを作っても拡張機能の入れ直しか Desktop の再起動まで使えなかった
- → **0.0.2 で直した（2026-10-09 Takashi）**: 作業フォルダーが無ければ起動時に作る（絶対パスで、すぐ上のフォルダーが存在するときだけ、最後の 1 段だけ。同じ名前のファイルがあれば使わない）。起動時にだめなら、作業フォルダーを使う呼び出しのたびに同じ設定の値で確かめ直す。`pcraft_status` / `pcraft_workspace_status` に `created` を出す。`verify-mcpb.mjs` で、作る・すぐ上が無いときは作らない・ファイルなら使わない、を確かめた

- **Desktop はサーバーを何度も起動し直す**（更新のとき 0.1 秒ほどの間に 4 回）。プロセスごとの値（「作った」の印など）は利用者に伝わらない。本番では、作ったことを作業フォルダーの中の印（例 `.print-craft/workspace.json` に作った日時と版）に残すか、`main.log` に出す標準エラーの行で伝える。起動の処理は何度走っても同じ結果になるように書く（作業フォルダーを作る処理は既にそうなっている）
- **Desktop はプロトコルの新旧を試し、この試作のサーバー（手書き）は「legacy」と判定された**（拡張機能のログの `Era probe verdict: legacy`。kSQL MCP は `modern (sibling answered server/discover)`）。本番の print-craft MCP は、kSQL と同じく MCP の SDK v2（`@modelcontextprotocol/server`。kSQL の B99）で作り、新旧の両方に答える
- 拡張機能のログに `Using built-in Node.js for MCP server` と出る（Desktop 同梱の Node を使っている裏付け）

- **Desktop のチャットでは、サーバーの指示（instructions）は AI に渡らず、ツールも最初は名前だけが見える**（5b）。AI を導けるのは、ツールの名前（表示名から作られる前置きを含む）、ツールの説明（読み込まれた後）、`pcraft_docs` の中身（呼ばれた後）、Customize から入れるスキルの説明（チャットに見える）。`.mcpb` 1 つで配れるかは、名前と説明だけで導けるかで決まる（実装案 5.5、13.2）

- **Desktop のチャットでは、ツールの名前と説明で AI を導ける**（5c・5d）。表示名に英数字（Print craft）を入れ、ツールの説明に利用者の言葉（帳票、見積書、印刷屋の設定）と「最初に呼ぶ」を書けば、あいまいな頼み方でも結び付いた。`.mcpb` 1 つで配る見込みは高い（実装案 5.5、13.2 を直す材料）
- **表示名の英数字の部分がツールの名前の前置きになる**（`印刷屋 設定オーサリング（Print craft 試作）` → `mcp__claude-device__lcl-Print_craft-<ツール>`）。AI がツールを探す手がかりになるので、本番の表示名にも英数字の識別しやすい名前を入れる。ただし名前全体が長くなる（今いちばん長いもので 59 文字）。ツールの名前の長さの上限（64 文字と見られるが未確認）を超えないよう、英数字の部分は短く（`Print craft`）、ツール名も短く保つ
- **利用者には「印刷屋で〜」と頼んでもらう**（5d）。印刷屋の言葉が無い「見積書の帳票を作りたい」は、Excel のひな形などと区別できないので結び付かない。README と使い方の例に「印刷屋で見積書の帳票を作って」の形を書く。手順のスキル（Customize）を配る場合は、説明に帳票・見積書を入れれば結び付く余地があるが、ほかの意味との取り違えに気を付ける
- **ツールの答えは、AI が読み違えない形にする**（5d）。「この起動で作ったか」の印（`created: false`）は「作られていない」と読まれた → 外すか、`exists` など意味のはっきりした名前にする。状態のツールは「準備ができている / 何が足りないか」を文章でも返す。資料に「状態は手順の文から推し量らず、`pcraft_status` / `pcraft_workspace_status` で確かめる」と書く（AI は setup の手順の文から「未設定」と推し量った）

結果を書いたら、関門（9 章）で 6.1・6.2（秘密の値の渡し方）、5.5（`.mcpb` 1 つで配れるか）、api-table.md の pull の扱いを確定する。

## 後片付け

拡張機能を外し、作業フォルダー（例 `~/pcraft-proto-desktop`）を消す。`dist-mcpb/` と `.tmp/` は git に入らない。
