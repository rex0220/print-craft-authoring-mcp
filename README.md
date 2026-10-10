# print-craft-authoring-mcp（開発中・未公開）

kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定 JSON を、検査（normalize）を通して作業フォルダーに保存・確認する **print-craft MCP**（Claude Code のプラグインと Claude Desktop の `.mcpb`）。中核は npm の [`@rex0220/print-craft-authoring-tools/core`](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)。設計は [docs/プラグイン化の実装案.md](docs/プラグイン化の実装案.md)（kintone の接続は 15 章）。

今は段階 B1（print-craft MCP の本体）。プラグインのスキルとフックの仕上げは B2、`.mcpb` のリリースは B3。

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/` | print-craft MCP（MCP の SDK v2）。`server.ts`（ツールの登録）、`binding.ts`（作業フォルダーの結び付け 4.1）、`compat.ts`（互換表 7 章）、`docs.ts`（資料 5.5）、`tools/`（ツール） |
| `guide/` | `pcraft_docs` の手順の章（print-craft MCP のツールで書いた） |
| `references/template/` | テンプレートの `docs/` の写し（`scripts/sync-references.mjs`。元のコミットと sha256 は `SOURCE.json`） |
| `compat.json` | 互換表 |
| `build-mcp.mjs` | 1 つの CJS ファイルに束ねる → `dist/` |
| `build-mcpb.mjs` / `scripts/mcpb-verify.mjs` | `.mcpb` を作る → `dist-mcpb/print-craft.mcpb` / 検査 |
| `.claude-plugin/plugin.json`、`.mcp.json`、`hooks/` | Claude Code のプラグイン `print-craft` |
| `test/` | 試験（束ねた本体を MCP のクライアントで起動する。kintone は `test/mock-fetch.mjs` の偽物） |
| `prototype/` | 段階 0 の試作（0-3a、0-3b、0-4） |

ツール: `pcraft_docs`、`pcraft_status`、`pcraft_workspace_status`、`pcraft_save_settings`、`pcraft_update_button`、`pcraft_buttons`、`pcraft_normalize`、`pcraft_preview`、`pcraft_fields`、`pcraft_record`、`pcraft_pull`、`pcraft_files`、`pcraft_take`、`pcraft_edit`、`pcraft_diff`（Claude Code と Desktop）、`kintone_get_app`、`kintone_list_records`（Desktop だけ。Claude Code では公式の kintone MCP）。

## 設定項目

| | Desktop（拡張機能の設定） | Claude Code（`/config` の print-craft） |
| --- | --- | --- |
| 作業フォルダー | 「作業フォルダー」（必須。選ぶ画面で） | 「印刷屋の作業フォルダー」（初めて使うときに確認の画面から足す） |
| 印刷屋プラグインの zip | 「印刷屋プラグインの zip」（必須。アプリに入れたものと同じ版） | 「印刷屋プラグインの zip」（絶対パス。空なら作業フォルダーの `.env` の `PCRAFT_PLUGIN_ZIP`） |
| kintone の接続 | 「kintone の接続のファイル」（任意・強く勧める） | 「kintone の接続のファイル」（絶対パス。任意・強く勧める） |

kintone の URL・API トークン・ログイン名・パスワードの設定項目はない（接続のファイルに書く）。接続のファイルが無くても、`settings/` などでの保存・検査・preview は動く（kintone から取るツールだけが使えない）。設定を変えたら Claude Code は `/mcp` で print-craft を再接続、Desktop は終了して起動し直す。

## kintone の接続のファイル

kSQL の `ksql.config.json` と同じ形のファイル。**kSQL のファイルをそのまま指しても、別のファイルでもよい**。print-craft が読むのは `defaultProfile` と、`profiles` の各 profile の `baseUrl`、`guestSpaceId`、`auth`（`token` / `userpass` / `auto`）、`username`、`password`、`passwordEnv`、`tokenMap` だけ（ほかのキーは読まずに通す）。

```json
{
  "defaultProfile": "dev",
  "profiles": {
    "dev": { "baseUrl": "https://dev-example.cybozu.com", "tokenMap": { "APP101": "env:PCRAFT_TOKEN_APP101", "APP102": "<閲覧だけの API トークン>" } },
    "prod": { "baseUrl": "https://example.cybozu.com", "tokenMap": { "APP3740": "env:PCRAFT_TOKEN_APP3740" } },
    "guest15": { "baseUrl": "https://example.cybozu.com", "guestSpaceId": 15, "tokenMap": { "APP300": "env:PCRAFT_TOKEN_APP300" } }
  }
}
```

- **作業フォルダーの外に置く**（作業フォルダーの中・中を指す symlink は使わない）。トークンかパスワードを直接書くなら `chmod 600`
- **アプリごとの閲覧だけの API トークンを強く勧める**。kSQL で書き込みにも使うトークンを print-craft と共有しない（下の「受け入れた危険」）
- profile の選び方: ツールの `profile`、無ければ `defaultProfile`、無ければ `dev`（kSQL と同じ）。ゲストスペースは profile の `guestSpaceId`（1 つの profile は 1 つのスペース。通常のスペースとゲストスペースの同じ番号のアプリは profile を分ける）
- アプリのフォルダーは作業フォルダーの `kintone/<profile>/<アプリ ID>-<アプリ名>/`（アプリ名は kintone から取る）。中の印 `.pcraft-app.json`（profile、接続先、ゲストスペース、アプリ ID）が今の接続と合わないフォルダーは使わない。profile の接続先を変えたら、古いフォルダーの名前を変えて退け、`pcraft_fields` か `pcraft_pull` で作り直す
- 本番のアプリも同じに扱う（読み取りだけにする守りは無い。tools 1.x の `environments.json` の `role` はやめた）。print-craft が kintone に送るのは GET だけ
- 状態は `pcraft_workspace_status`（profile ごとの接続先、認証の種類、アプリごとのトークンが使えるか。秘密の値と環境変数の名前は返さない）

kSQL との違い（print-craft の方が厳しい。同じファイルを共有するときは、print-craft が使う profile をこの決まりに合わせる）:

| | kSQL | print-craft |
| --- | --- | --- |
| kSQL の環境変数の上書き（`KSQL_BASE_URL`、`KSQL_TOKEN`、`KSQL_TOKEN_MAP`、`KSQL_USERNAME`、`KSQL_PASSWORD`、`KSQL_AUTH`、`KSQL_PROFILE`、`KSQL_GUEST_SPACE_ID`） | 読む | 読まない（読む環境変数は、ファイルが名前を書いた `env:` と `passwordEnv` だけ） |
| token のときの `env:` | `tokenMap` のすべてを先に解決（使わないアプリの変数が無くても止まる） | 対象のアプリのトークンだけ |
| `env:` の値・`username`・`password` が空白だけ | 受け付ける | 無いとみなす |
| `tokenMap` のキー `APP001` | `APP001` のまま（`APP1` とは別） | 誤り（`APP1` と書く） |
| `tokenMap` の値が文字列でない | 文字列にして使う | 誤り |
| `APP1` と `app1` のようにそろえると重なるキー | 後のものが勝つ | 誤り |
| profile の名前（英数字と `-` `_` の 40 文字まで）・`baseUrl`（`https://*.cybozu.com` / `*.kintone.com` / `*.cybozu.cn`）・`guestSpaceId`・`auth`・`tokenMap` の形 | ほとんど検査しない | 検査し、誤りの profile は使わない（ほかの profile は使える） |
| 接続のファイルが無い | 空の設定として動く | kintone を使うツールは使えない |
| ゲストスペースの指定 | profile の値（`KSQL_GUEST_SPACE_ID` で上書き） | profile の値だけ |

**受け入れた危険**: 作業フォルダーの外に置くのは誤操作の防止で、Claude Code の AI からの秘密の隔離ではない。Claude Code の AI は Read / Bash で接続のファイルも環境変数（`env:` の参照先）も読める（作業フォルダーの外を読むときは許可の確認が出る。許可の確認を外した使い方では出ない）。読まれたトークンは print-craft の外でも使えるので、書き込みもできるトークンは書き込みに使われうる。だから閲覧だけのトークンを使う。Desktop で print-craft MCP だけを有効にしていれば、print-craft MCP を通して接続のファイルや環境変数を読む手段は無い（ほかのファイル・shell の MCP を同じ Desktop で有効にしていれば、Claude Code と同じ危険がある）。

**環境変数（`env:`、`passwordEnv`）**: print-craft MCP の環境変数は起動のときに決まる。変えたら Claude Code は `/mcp` で再接続、Desktop は起動し直す（接続のファイルの書き換えは再接続なしで効く）。Desktop から起動する print-craft MCP には、シェルの設定（`~/.zshrc` など）の環境変数は届かない。Desktop ではトークンを接続のファイルに直接書く（`chmod 600`）のが確実。`env:` を使うなら `pcraft_workspace_status` の `tokenApps` の `ready` で使えるかを確かめる。

**tools 1.x の `environments.json` から移す**: 接続のファイルを書いて設定する → 古いアプリのフォルダー（`kintone/<ホスト名>/…`）の名前を変えて退け、`pcraft_fields`（か `pcraft_pull`）で `kintone/<profile>/…` を作る → ダウンロード / pull のファイルは `inbox/` に置いて `pcraft_take`、`-edit.json` と新しい帳票は手で新しいフォルダーへ移す → `environments.json` を消す（残っていて接続のファイルが無いと、kintone のツールとアプリのフォルダーは止まる）。

## 作り方と試験

リリース（`.mcpb`、Claude Code のプラグイン）の手順は [docs/リリース手順.md](docs/リリース手順.md)。

隣に `print-craft`（印刷屋の zip `dist/print-craft-plugin7.zip`。試験だけ）があること。

中核は npm の `@rex0220/print-craft-authoring-tools` 2.0.0（lockfile で固定。`compat.json` の `coreVersion` は `>=2.0.0 <3.0.0`、`coreApiVersion` は 2）。公開前の中核で試すときは、隣の print-craft-authoring の `tools` で `npm pack` した tarball を `npm install --no-save <tgz>` で入れる（`package.json` と lockfile は変えない）。

```sh
npm ci
npm test                 # ビルド → 試験
npm run verify:mcpb      # ビルド → .mcpb → 検査
CLAUDE=~/.vscode/extensions/anthropic.claude-code-2.1.295-darwin-arm64/resources/native-binary/claude
"$CLAUDE" plugin validate . && "$CLAUDE" plugin test .
node scripts/sync-references.mjs   # テンプレートの資料を写し直す（compat.json の docsRevision も合わせる）
```

## 手で確かめること（B1）

試作（`print-craft-proto`）は外しておく（同じ表示名・ツール名で紛らわしい）。試験用の作業フォルダーで試す（テンプレートのフォルダーでは試さない）。接続のファイルは利用者がエディターで書く（作業フォルダーの外。閲覧だけのトークン。チャットに貼らない）。例: `~/pcraft-b1-conn/ksql.config.json` に、試験用のアプリの profile `dev`。

### Claude Code（`--plugin-dir`）

```sh
npm ci && npm run build
mkdir -p ~/pcraft-b1-ws && cd ~/pcraft-b1-ws
"$CLAUDE" --plugin-dir ~/Projects/kintone-plugin/print-craft-authoring-mcp
```

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | `/config` で print-craft の「印刷屋プラグインの zip」と「kintone の接続のファイル」（どちらも絶対パス）を入れて、`/mcp` で再接続 | `/mcp` に print-craft とツール 15 | 2026-10-10 Mac（0.1.3）: **期待どおり**（再接続の後、`pcraft_status` と `pcraft_workspace_status` が `ready: true`。zip 版 7、接続のファイルの profile 4 つ） |
| 2 | 「印刷屋で見積書の帳票を作りたい」 | `pcraft_docs` が呼ばれ、目次に版と作業の順 | 2026-10-10 Mac（0.1.3）: おおむね期待どおり。呼び出しは 2 回（status と workspace_status とみられる）で、`pcraft_docs` が呼ばれたかは見えなかった。指示文（Claude Code には届く）で手順を知っていて、profile の表を出し、アプリの番号・用紙・PDF の扱いを聞いた |
| 3 | （続き）アプリの番号を伝える | `pcraft_status`（`capabilities.kintone.ready: true`）→ 作業フォルダーの登録の確認 → 再接続 → `pcraft_fields` で項目の要約。`kintone/dev/<番号>-<アプリ名>/fields.json` と印 | 2026-10-10 Mac（0.1.3）: **期待どおり**（アプリ 3740「見積書(印刷屋)」、profile dev、アプリのフォルダー）。ただ、項目の対応を見せる前に、雛形（R1）の形で作って保存まで進めた（最初に「決まっていなければ既定の形で作る」と言ったとおり）。保存の後に、帳票の場所と項目コードの表、使わなかった項目、仮の値（社名・住所・社印）を示した |
| 4 | 「作業フォルダーの診断を見せて」 | `pcraft_workspace_status` に profile、トークンが使えるか、アプリのフォルダー（`ok`）。トークンと環境変数の名前は出ない | 2026-10-10 Mac（0.1.3）: **期待どおり**（profile ごとの接続先・ゲストスペース・認証の種類・ログインできるか、アプリのフォルダー `ok`、zip。秘密の値と環境変数の名前は出ない） |
| 5 | （続き）代表のレコードを決める | `pcraft_record` で形だけ（値は出ない）。アプリのフォルダーの `records/` | 2026-10-10 Mac（0.1.3）: **期待どおり**（7 の中で。レコード 3 の形だけ: 明細 5 行、商品名の最長 27 文字、単価の最大 7 桁、備考 2 行、見積ファイルに 1 件 → 「kintone ではボタンが出ない」と伝えた） |
| 6 | （続き）帳票を書いて保存 | `pcraft_save_settings` がアプリのフォルダーに `ok`（`trustedOrigin` が接続先のホスト）、警告を伝える | 2026-10-10 Mac（0.1.3）: **期待どおり**（3 で `ok`、警告 `formula.rawHtml` と大きさを伝えた。6 では保存済みを確かめて保存し直さなかった） |
| 7 | （続き）preview | `pcraft_preview` がアプリのフォルダーの `out/` に書く。Chrome で開く | 2026-10-10 Mac（0.1.3）: **期待どおり**（1 ページ、式の誤り 0、`out/見積書.html`。中身を読まず、AI はブラウザーを起動しない。開き方として利用者が実行する `! open -a "Google Chrome" …` を案内。反映の手順も添えた） |
| 8 | 「settings/x.json に Write で直接書いて」 | フックが拒否 | 2026-10-10 Mac（0.1.3）: **期待どおり**（フックが断り、shell などの回り道はせず、`pcraft_save_settings` で保存する案を出した） |
| 9 | 「同じ名前でもう一度保存して」 | `conflict`（ツールを呼んで返った結果を伝える） | 2026-10-10 Mac（0.1.3）: **期待どおり**（呼んで `conflict` とツールの文をそのまま伝えた。消す・上書きの回り道はせず、「消すかはご自身で」） |
| 10 | 接続のファイルの dev の `baseUrl` を別のサブドメインに書き換えて `pcraft_fields` | `conflict`（`app-identity-conflict`）。kintone に送らない。元に戻す | 2026-10-10: 省いた（Takashi「10 skip」）。同じ動きは自動の試験 `test/kintone.test.mjs`（接続先を変えた後の `pcraft_fields` / `pcraft_record` / `pcraft_normalize` が `app-identity-conflict`）で確かめている |

### Desktop（`.mcpb`）

`npm run build:mcpb` → `dist-mcpb/print-craft.mcpb` を入れる → **Desktop を終了して起動し直す** → 新しいチャット。

最初は、ツールごとに初めて使うときに許可の確認が出る（Claude Desktop の決まり）。確認の画面で「常に許可」を選ぶか、Desktop の設定のツールの権限で、読み取りだけのツール（診断、資料、buttons、normalize、files、diff、`kintone_*`）と書き込むツール（保存、差し替え、preview、fields、record、pull、take、edit）をまとめて決める。print-craft の書き込むツールが書くのは作業フォルダーの中だけ（kintone には読み取りだけ）。
preview の帳票は、Desktop では会話の中のプレビュー（MCP App）に表示される（2026-10-10 Takashi「MCP Apps で作る」。実装案 16 章。2026-10-10 の Mac の確認では表示の許可の確認は出なかった。Desktop の版によって出ることがある）。帳票の文書は結果の `_meta` で UI にだけ渡し、AI には渡さない（MCP Apps の仕様）。表示されなければ out/ の HTML を Chrome で開く。

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | 設定項目（入れたときの画面か、設定 → 拡張機能 → 印刷屋 設定オーサリング（Print craft）の設定）: 作業フォルダー（選ぶ画面で）、zip、kintone の接続のファイル（選ぶ画面で） | 設定に秘密の値の項目が無い | 2026-10-10 Mac（0.1.0）: **期待どおり**。作業フォルダー `~/pcraft-b1-desktop`、接続のファイルは kSQL MCP のものを Takashi がコピー（profile 4 つ、すべてログイン名とパスワード）。古い試作は表示名を「…試作）-old」（0.0.8）にした |
| 2 | 「印刷屋で見積書の帳票を作りたい」 | `pcraft_docs` → `pcraft_status`（版 0.1.4、`ready: true`） | 2026-10-10 Mac（0.1.0）: **期待どおり**（版 0.1.0、中核 2.0.0、`ready`、zip 版 7、profile 4 つと使えるか。秘密の値・環境変数の名前・パスは出ない）。ただし `pcraft_workspace_status` の `environmentsJson: { exists: false }` を見た AI が「environments.json を作る必要があるかもしれない」と案内した → 無いときは返さないように直した（5efcf2d）。0.1.2: `pcraft_status` で版 0.1.2 を確かめた |
| 3 | アプリの番号か URL を伝える | `kintone_get_app` で名前（profile と接続先）、`pcraft_fields` で要約 | 2026-10-10 Mac（0.1.0）: **期待どおり**（アプリ 3740「見積書(印刷屋)」、項目 19、`kintone/dev/3740-見積書(印刷屋)/fields.json`）。詳細画面の URL（`…/k/3740/show#record=3`）は断られ、AI が番号で指定し直した → 詳細画面・編集画面の URL も受け付けるようにした（Takashi「OK」）。0.1.2: 詳細画面の URL を `kintone_get_app` が受け付けた（アプリ 3740、profile dev） |
| 4 | 代表のレコードを選ぶ | `kintone_list_records`（形だけ、5 件）→ `pcraft_record` | 2026-10-10 Mac（0.1.0）: URL のレコード 3 を使ったので `kintone_list_records` は呼ばず、`pcraft_record` で形だけ（値は出ない） |
| 5 | 帳票を書いて保存 → preview | `pcraft_save_settings` `ok` → `pcraft_preview` | 2026-10-10 Mac（0.1.0）: **期待どおり**（`kintone/dev/3740-見積書(印刷屋)/見積書.json`、fields を渡さず、警告は `formula.rawHtml` だけ。preview は 1 ページ・式の誤り 0、アプリのフォルダーの `out/`）。最初はツールごとに許可の確認が出る（上の説明を足した）。HTML は「…をプレビュー」と頼むとチャットに表示できた → 頼まなくても表示する（Takashi「プレビューは、チャットに無条件に表示して」）ために MCP App にした（0.1.2）。0.1.2: 帳票が会話の中のプレビューに表示された（表示の許可の確認は出なかった）、全画面に切り替えられた、AI に帳票の宛名を聞いても答えられない（値は AI の文脈に無い）。0.1.3（中核 tools 2.0.1。MCP App の CSP から Google Fonts を外し、preview は Web フォントを読まない）: AI が頼まれる前に preview を呼び、会話の中のプレビューに表示された。検査の指摘をそのまま伝え、帳票の説明にレコードの値を出さなかった。0.1.4: 全画面（会話の欄いっぱいに出て、返信の欄が下に浮く）で帳票が真ん中に来て、下の余白で最後まで隠れずに見られた。Claude Desktop は小窓（pip）に対応していない（ボタンは出ない。対応すれば出る） |
| 6 | 同じ名前でもう一度保存 | `conflict`（ツールを呼んで返った結果を伝える。推し量らない） | 2026-10-10 Mac（0.1.0）: **期待どおり**（呼んで `conflict`、ファイルは変わらないと伝えた）。ただし「いったん削除してから保存する（macOS のファイルの操作で）」も案内した → 指示・資料に「ほかのツールで消す・書き換える回り道をしない（直すなら pcraft_update_button、消すかは利用者）」を足した（0.1.1） |
| 7 | `env:` のトークンの profile（シェルの設定だけに変数を書いた）で `pcraft_workspace_status` | `tokenApps` の `ready: false`（Desktop にシェルの環境変数は届かない）。`pcraft_fields` は `env-missing` | 2026-10-10: 試していない（kSQL の接続のファイルの profile はすべてログイン名とパスワードで、`env:` が無い） |
| 8 | `main.log` | `[print-craft-mcp] print-craft MCP 0.1.4 …` の行。秘密の値、レコードの値（宛名など）、印刷屋のログ（`file name err`）、moment の警告（`Deprecation warning`）が無い（捨てたときは「console の出力を N 件捨てた」の行だけ） | 2026-10-10 Mac（0.1.0）: **期待どおり**（`print-craft MCP 0.1.0（中核 … 2.0.0、commit 705337e） node=v24.21.0 surface=desktop workspace=… pluginZip=設定済み`。秘密の値・レコードの値は無い）。同じ秒に 4 回起動していた（Desktop が 4 つのプロセスを立てた）。起動の行に接続のファイルの状態が無かった → `kintoneConfig=設定済み（<ファイルの名前>）` を足した（0.1.1）。0.1.2: `print-craft MCP 0.1.2 … kintoneConfig=設定済み（ksql.config.json）` の行（パスは出ない） |
