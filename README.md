# print-craft-authoring-mcp

kintone の印刷屋プラグイン（rex0220 Print craft）の帳票の設定 JSON を、検査（normalize）を通して作業フォルダーに保存・確認する **print-craft MCP**（Claude Code のプラグインと Claude Desktop の `.mcpb`）。中核は npm の [`@rex0220/print-craft-authoring-tools/core`](https://www.npmjs.com/package/@rex0220/print-craft-authoring-tools)。設計は [docs/プラグイン化の実装案.md](docs/プラグイン化の実装案.md)（kintone の接続は 15 章）。

最新の版は [リリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest)（0.1.5 から公開）。開発の段階は B2（Claude Code のプラグインの配布）で、`.mcpb` の Windows での確かめは B3。

## 入れ方

- **Claude Desktop**: [リリース](https://github.com/rex0220/print-craft-authoring-mcp/releases/latest) から `print-craft-authoring-<版>.mcpb` をダウンロードしてダブルクリック。設定で、作業フォルダー、印刷屋プラグインの zip、kintone の接続のファイルを選ぶ（下の「設定項目」と「kintone の接続のファイル」）
- **Claude Code**（ターミナルの `claude`。Node.js 20 以降）: `/plugin install print-craft --marketplace rex0220/print-craft-authoring-mcp`（Claude Code 2.1.275 以降。それより前は `/plugin marketplace add rex0220/print-craft-authoring-mcp` → `/plugin install print-craft@rex0220-print-craft`）。そのあと `/config` で、印刷屋プラグインの zip と kintone の接続のファイル
- 印刷屋プラグインの zip は、アプリに入れたものと同じ版（Ver.6 以降）の、配布元から入手したものを使う。kintone の API トークンは、アプリごとのレコード閲覧だけのものを使う
- 使い方の記事（Claude Desktop）: [rex0220 印刷屋プラグイン - AI(Claude Desktop)にチャットで帳票を作らせる](https://qiita.com/rex0220/items/8cbebab5a5f8a9c21b1f)
- デザインの作り込みの記事（Claude Desktop）: [rex0220 印刷屋プラグイン - AI(Claude Desktop)に帳票のデザインを作り込ませる](https://qiita.com/rex0220/items/43ceafa584690b4b0a5b)
- 見積書から注文書・請求書を作る記事（Claude Desktop）: [rex0220 印刷屋プラグイン - AI(Claude Desktop)に見積書から注文書・請求書を作らせる](https://qiita.com/rex0220/items/eae546dc726e7c61512f)
- 組織図を設計してからアプリを作る記事（Claude Desktop）: [rex0220 印刷屋プラグイン - AI(Claude Desktop)に組織図を設計させてから、アプリを作らせる](https://qiita.com/rex0220/items/6e739ace80cffd2ad70a)

利用者向け: [PRIVACY.md](PRIVACY.md)（プライバシーポリシー）、[SECURITY.md](SECURITY.md)（脆弱性の報告と、受け入れた危険）、[CHANGELOG.md](CHANGELOG.md)、[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)（同梱の依存のライセンス）。

## 構成

| 場所 | 中身 |
| --- | --- |
| `src/` | print-craft MCP（MCP の SDK v2）。`server.ts`（ツールの登録）、`binding.ts`（作業フォルダーの結び付け 4.1）、`compat.ts`（互換表 7 章）、`docs.ts`（資料 5.5）、`tools/`（ツール） |
| `guide/` | `pcraft_docs` の手順の章（print-craft MCP のツールで書いた） |
| `references/template/` | テンプレートの `docs/` の写し（`scripts/sync-references.mjs`。元のコミットと sha256 は `SOURCE.json`） |
| `compat.json` | 互換表 |
| `build-mcp.mjs` | 1 つの CJS ファイルに束ねる → `dist/`。束ねた依存の著作権表示 `THIRD_PARTY_NOTICES.md` も作る（`scripts/third-party-notices.mjs`。リポジトリのものと違えば止める） |
| `build-mcpb.mjs` / `scripts/mcpb-verify.mjs` | `.mcpb` を作る → `dist-mcpb/print-craft.mcpb` / 検査 |
| `scripts/build-plugin-zip.mjs` / `scripts/plugin-zip-verify.mjs` / `scripts/write-marketplace.mjs` | Claude Code のプラグインの zip を作る → `dist-plugin/print-craft-plugin-<版>.zip` / 検査 / リリースのときに `.claude-plugin/marketplace.json` を書く |
| `scripts/forbidden-files.mjs`、`scripts/zip.mjs` | 入れてはいけないもの（認証情報、レコードの値、実案件の設定、本物の kintone のホスト名）の検査 / 無圧縮の zip |
| `.claude-plugin/plugin.json`、`.mcp.json`、`hooks/` | Claude Code のプラグイン `print-craft` |
| `test/` | 試験（束ねた本体を MCP のクライアントで起動する。kintone は `test/mock-fetch.mjs` の偽物） |
| `prototype/` | 段階 0 の試作（0-3a、0-3b、0-4） |

ツール: `pcraft_docs`、`pcraft_status`、`pcraft_workspace_status`、`pcraft_save_settings`、`pcraft_update_button`、`pcraft_buttons`、`pcraft_normalize`、`pcraft_preview`、`pcraft_try`（0.3.0 から。お試しアプリ）、`pcraft_fields`、`pcraft_record`、`pcraft_pull`、`pcraft_files`、`pcraft_take`、`pcraft_edit`、`pcraft_diff`（Claude Code と Desktop）、`kintone_get_app`、`kintone_list_records`（Desktop だけ。Claude Code では公式の kintone MCP）。

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

中核は npm の `@rex0220/print-craft-authoring-tools` 2.3.2（lockfile で固定。`compat.json` の `coreVersion` は `>=2.3.2 <3.0.0`、`coreApiVersion` は 2）。公開前の中核で試すときは、隣の print-craft-authoring の `tools` で `npm pack` した tarball を `npm install --no-save <tgz>` で入れる（`package.json` と lockfile は変えない）。

```sh
npm ci
npm test                 # ビルド → 試験
npm run verify:mcpb      # ビルド → .mcpb → 検査
npm run verify:plugin    # ビルド → プラグインの zip → 検査（claude があれば plugin validate も）
npm run notices          # 依存を変えたとき: THIRD_PARTY_NOTICES.md を作り直す（差分を見てコミット）
node scripts/forbidden-files.mjs [--history]   # 入れてはいけないもの（--history は履歴のすべてのコミット）
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

リリースの候補 0.1.5（2026-10-10 Mac。プラグインの zip を、ターミナルの `claude --plugin-dir <zip>` で。VS Code の会話の欄では `/plugin` も `--plugin-dir` も使えない）: 1 は `pcraft_status` と `pcraft_workspace_status` が `ready: true`（0.1.5、中核 2.0.2、zip 版 7、profile 4 つ）、8 は zip の中のフックが Write を止めた（回り道なし）。保存から preview までは、展開した zip で保存まで通す自動の検査（`npm run verify:plugin`）に任せた。

公開した 0.1.5 を marketplace から（2026-10-10 Mac、ターミナルの Claude Code 2.1.296）: `/plugin` の画面から user scope で入れた（入れる前の画面は「Component summary not available for remote plugin」）→ `/plugin configure print-craft@rex0220-print-craft` で zip と接続のファイル（作業フォルダーは空のまま）→ 起動し直して「印刷屋の準備を確かめて」→ 作業フォルダーの登録の確認 → `/mcp` で再接続 → `pcraft_status` と `pcraft_workspace_status` が 0.1.5（中核 2.0.2）・`ready: true`。

公開した 0.2.0 を marketplace から（2026-10-12 Mac、ターミナルの Claude Code）: `/plugin marketplace update rex0220-print-craft`（「1 plugin bumped」）→ `/reload-plugins` → `pcraft_status` が 0.2.0・中核 2.1.0（c34059c）・authoring API 1〜3、`ready`（zip は Ver.7 のまま。関連レコード一覧を使うときは `/config` で Ver.8 の zip にする）。

公開した 0.2.1 を marketplace から（2026-10-20 Mac）: 手元の marketplace は v0.2.1 の zip を指していたが、入れたプラグインは 0.2.0 のまま（`claude plugin list`）→ 更新して起動し直した → `pcraft_status` が 0.2.1・中核 2.2.0（d37b918）、zip は `print-craft-plugin9.zip`（`/plugin configure` で Ver.9 に）、`ready`。Desktop の Code（Claude Code）では、プラグインの print-craft と拡張機能の print-craft（`.mcpb` 0.2.1）が一緒に見え、`pcraft_status` は両方が答えた（作業フォルダーはプラグインが pcraft-b1-ws・pj-print-craft、拡張機能が pcraft-b1-desktop）。プラグインが 0.2.0 のままだと、0.2.0 のフックが拡張機能の作業フォルダーのツールまで捕まえる（0.2.1 で直した）。

公開した 0.3.0 を marketplace から（2026-10-20 Mac、Claude Code 2.1.304）: 更新して確かめた（Takashi「1 OK」。`pcraft_status` が 0.3.0・中核 2.3.2）。`claude plugin list` で print-craft@rex0220-print-craft が 0.3.0、user scope、有効。

### Desktop（`.mcpb`）

`npm run build:mcpb` → `dist-mcpb/print-craft.mcpb` を入れる → **Desktop を終了して起動し直す** → 新しいチャット。

最初は、ツールごとに初めて使うときに許可の確認が出る（Claude Desktop の決まり）。確認の画面で「常に許可」を選ぶか、Desktop の設定のツールの権限で、読み取りだけのツール（診断、資料、buttons、normalize、files、diff、`kintone_*`）と書き込むツール（保存、差し替え、preview、fields、record、pull、take、edit）をまとめて決める。print-craft の書き込むツールが書くのは作業フォルダーの中だけ（kintone には読み取りだけ）。
preview の帳票は、Desktop では会話の中のプレビュー（MCP App）に表示される（2026-10-10 Takashi「MCP Apps で作る」。実装案 16 章。2026-10-10 の Mac の確認では表示の許可の確認は出なかった。Desktop の版によって出ることがある）。帳票の文書は結果の `_meta` で UI にだけ渡し、AI には渡さない（MCP Apps の仕様）。表示されなければ out/ の HTML を Chrome で開く。

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | 設定項目（入れたときの画面か、設定 → 拡張機能 → 印刷屋 設定オーサリング（Print craft）の設定）: 作業フォルダー（選ぶ画面で）、zip、kintone の接続のファイル（選ぶ画面で） | 設定に秘密の値の項目が無い | 2026-10-10 Mac（0.1.0）: **期待どおり**。作業フォルダー `~/pcraft-b1-desktop`、接続のファイルは kSQL MCP のものを Takashi がコピー（profile 4 つ、すべてログイン名とパスワード）。古い試作は表示名を「…試作）-old」（0.0.8）にした |
| 2 | 「印刷屋で見積書の帳票を作りたい」 | `pcraft_docs` → `pcraft_status`（版 0.1.5、`ready: true`） | 2026-10-10 Mac（0.1.0）: **期待どおり**（版 0.1.0、中核 2.0.0、`ready`、zip 版 7、profile 4 つと使えるか。秘密の値・環境変数の名前・パスは出ない）。ただし `pcraft_workspace_status` の `environmentsJson: { exists: false }` を見た AI が「environments.json を作る必要があるかもしれない」と案内した → 無いときは返さないように直した（9c537ba）。0.1.2: `pcraft_status` で版 0.1.2 を確かめた |
| 3 | アプリの番号か URL を伝える | `kintone_get_app` で名前（profile と接続先）、`pcraft_fields` で要約 | 2026-10-10 Mac（0.1.0）: **期待どおり**（アプリ 3740「見積書(印刷屋)」、項目 19、`kintone/dev/3740-見積書(印刷屋)/fields.json`）。詳細画面の URL（`…/k/3740/show#record=3`）は断られ、AI が番号で指定し直した → 詳細画面・編集画面の URL も受け付けるようにした（Takashi「OK」）。0.1.2: 詳細画面の URL を `kintone_get_app` が受け付けた（アプリ 3740、profile dev） |
| 4 | 代表のレコードを選ぶ | `kintone_list_records`（形だけ、5 件）→ `pcraft_record` | 2026-10-10 Mac（0.1.0）: URL のレコード 3 を使ったので `kintone_list_records` は呼ばず、`pcraft_record` で形だけ（値は出ない） |
| 5 | 帳票を書いて保存 → preview | `pcraft_save_settings` `ok` → `pcraft_preview` | 2026-10-10 Mac（0.1.0）: **期待どおり**（`kintone/dev/3740-見積書(印刷屋)/見積書.json`、fields を渡さず、警告は `formula.rawHtml` だけ。preview は 1 ページ・式の誤り 0、アプリのフォルダーの `out/`）。最初はツールごとに許可の確認が出る（上の説明を足した）。HTML は「…をプレビュー」と頼むとチャットに表示できた → 頼まなくても表示する（Takashi「プレビューは、チャットに無条件に表示して」）ために MCP App にした（0.1.2）。0.1.2: 帳票が会話の中のプレビューに表示された（表示の許可の確認は出なかった）、全画面に切り替えられた、AI に帳票の宛名を聞いても答えられない（値は AI の文脈に無い）。0.1.3（中核 tools 2.0.1。MCP App の CSP から Google Fonts を外し、preview は Web フォントを読まない）: AI が頼まれる前に preview を呼び、会話の中のプレビューに表示された。検査の指摘をそのまま伝え、帳票の説明にレコードの値を出さなかった。0.1.4: 全画面（会話の欄いっぱいに出て、返信の欄が下に浮く）で帳票が真ん中に来て、下の余白で最後まで隠れずに見られた。Claude Desktop は小窓（pip）に対応していない（ボタンは出ない。対応すれば出る） |
| 6 | 同じ名前でもう一度保存 | `conflict`（ツールを呼んで返った結果を伝える。推し量らない） | 2026-10-10 Mac（0.1.0）: **期待どおり**（呼んで `conflict`、ファイルは変わらないと伝えた）。ただし「いったん削除してから保存する（macOS のファイルの操作で）」も案内した → 指示・資料に「ほかのツールで消す・書き換える回り道をしない（直すなら pcraft_update_button、消すかは利用者）」を足した（0.1.1） |
| 7 | `env:` のトークンの profile（シェルの設定だけに変数を書いた）で `pcraft_workspace_status` | `tokenApps` の `ready: false`（Desktop にシェルの環境変数は届かない）。`pcraft_fields` は `env-missing` | 2026-10-10: 試していない（kSQL の接続のファイルの profile はすべてログイン名とパスワードで、`env:` が無い） |
| 8 | `main.log` | `[print-craft-mcp] print-craft MCP 0.1.5 …` の行。秘密の値、レコードの値（宛名など）、印刷屋のログ（`file name err`）、moment の警告（`Deprecation warning`）が無い（捨てたときは「console の出力を N 件捨てた」の行だけ） | 2026-10-10 Mac（0.1.0）: **期待どおり**（`print-craft MCP 0.1.0（中核 … 2.0.0、commit 705337e） node=v24.21.0 surface=desktop workspace=… pluginZip=設定済み`。秘密の値・レコードの値は無い）。同じ秒に 4 回起動していた（Desktop が 4 つのプロセスを立てた）。起動の行に接続のファイルの状態が無かった → `kintoneConfig=設定済み（<ファイルの名前>）` を足した（0.1.1）。0.1.2: `print-craft MCP 0.1.2 … kintoneConfig=設定済み（ksql.config.json）` の行（パスは出ない） |

リリースの候補 0.1.5（2026-10-10 Mac。`.mcpb` を入れ直して Desktop を起動し直した）: 版 0.1.5、2 は `ready`、5 は保存すると会話の中にプレビューが出た。8 は `print-craft MCP 0.1.5（中核 @rex0220/print-craft-authoring-tools 2.0.2、commit d70cacd） node=v24.21.0 surface=desktop … kintoneConfig=設定済み（ksql.config.json）` の行で、`file name err` と `Deprecation warning` は 0 件。

0.2.0（2026-10-12 Mac。リリースの候補 `716b14c` の `.mcpb` を入れ直して Desktop を起動し直した。印刷屋 Ver.8 の zip）: 2 は版 0.2.0・中核 2.1.0（c34059c）・zip は プラグイン v8 / authoring API 3 で `ready`。3 は関連レコード一覧のあるアプリ 4121「ガントチャート」（項目 49、関連レコード一覧 2 つとも参照先の項目定義あり。要約に `task_list$task_name` などと「1 行目・一覧用では使えない」の案内）。4 は `pcraft_record`（レコード 2780。`task_list` 13 行、`related_project` 0 行、形だけ）。5 は工程表の設定（作業フォルダーに手で置いた）を `pcraft_normalize`（`check` の差 0。警告は `formula.rawHtml` だけ）→ `pcraft_preview`（式の誤り 0、1 ページ。会話の中にプロジェクト情報 + タスク 13 行の工程表が出た）。8 は `print-craft MCP 0.2.0（中核 @rex0220/print-craft-authoring-tools 2.1.0、commit c34059c）` の行があり、レコードの値（プロジェクト名・タスク名・メンバー名）、秘密の値、印刷屋のログ、moment の警告は無し（MCP サーバーのログも同じ）。Claude Code の marketplace 経由は公開の後に確かめる。

0.2.1（2026-10-20 Mac。リリースの候補 `aafad40` の `.mcpb` を入れ直して Desktop を起動し直した。印刷屋 Ver.9 の zip）: 2 は版 0.2.1・中核 2.2.0（d37b918）・zip は `print-craft-plugin9.zip`（v9、authoring API 3、互換 OK）で `ready`、Node v24.21.0。5 は作業フォルダーの見積書の帳票に「元利均等返済の月額 R_PMT」の行を足す依頼で、保存 `ok` → `pcraft_preview`（レコード 3、1 ページ、式の誤り 0）。締めの反映方法は「一部置換」「追加」を設定画面の言葉のまま、ボタンの設定があるか分からないので両方の場合を書いた。気づいたこと（0.2.1 の不具合ではない。次の版の guide で）: AI が頼まれていない `list: true` にして一覧帳票に変え、仕様を読んで自分で `false` に戻した。反映方法に、印刷屋の設定がまだ無いアプリの「全置換」が無かった。Claude Code の marketplace 経由は公開の後に確かめる。

0.3.0（2026-10-20 Mac。リリースの候補 `021354a` の `.mcpb` を入れ直して Desktop を起動し直した。版が同じ 0.3.0 の入れ直しは、拡張機能を削除してから入れないと前の候補のまま動いた。印刷屋 Ver.9 の zip）: 2 は版 0.3.0・中核 2.3.2（0010b33）・資料 4d3a384・zip は `print-craft-plugin9.zip`（v9、authoring API 3、互換 OK）で `ready`、Node v24.21.0。`pcraft_try`（「見積書の形を試して」）は会話の中にレコード 1〜3 の見積書（共通 CSS の見た目。2 は長い文字と 3 行の備考、3 は空）。「複数行の備考はどう書く？」は `REPLACEALL(ESC_HTML(備考), NEWLINE(), "<br>")` とその理由（`REPLACE` は最初の 1 つだけ、改行は `NEWLINE()`）。使い方ナビ（「印刷屋で何が作れる？」）は最初の候補（`ee448f0`）で、帳票の種類・頼み方の例・今の帳票の変え方を答えた。8 は `print-craft MCP 0.3.0（中核 @rex0220/print-craft-authoring-tools 2.3.2、commit 0010b33）` の行があり、お試しアプリの値・秘密の値・`file name err`・`Deprecation warning` は 0 件（print-craft MCP のサーバーのログも同じ）。候補の確かめで直したこと: 複数行の差し込みの `REPLACE` → `REPLACEALL`（中核 2.3.1。0.2 までの資料の誤り。お試しアプリの見積書の備考で 2 つ目の改行が残った）、お試しの帳票に印刷屋の既定の共通 CSS（中核 2.3.2。見出しや左右の欄が崩れた）。Claude Code の marketplace 経由は公開の後に確かめる。

0.3.1（2026-10-21 Mac。リリースの候補 `66d1a8a` の `.mcpb` を、拡張機能を消してから入れ直して Desktop を起動し直した。印刷屋 Ver.9 の zip）: `pcraft_status` は版 0.3.1・中核 2.3.2（0010b33）で `ready`。「帳票の関数について QA を 10 題作って」は基本 4・応用 4・端の動き 2（FSIZE、TAG / ATTR、ADD_TAGS、ESC_HTML と引用符、FVAL の空と 0 など）で、最後に「確かめた」。「エスケープと文字列の差し込みに関して QA を 10 題作って。答えは最後にまとめて」は問いが先・答えが後で、確かめで `LEN` が無い関数と分かった問いを作り直していた。QA の答えのうち 11 題を CLI でも計算し直して一致。最初の候補（7957eb7）では、式だけの `pcraft_try` の枠に「プレビューのデータが届きませんでした。…out/ の HTML を Chrome で開いてください」と出た（0.3.0 から）→ 結果に式だけの印を付けて直し（66d1a8a）、「この試しは式だけなので、帳票はありません」になった。帳票の試し（見積書）は今までどおり。なお「ESC_HTML(…) の結果を試して」だけでは、両方の拡張機能が入った Desktop は計算式プラグインの `fml_try` で答えた（「印刷屋で」を付けると `pcraft_try`）。Claude Code の marketplace 経由は公開の後に確かめる。
