# 段階 0-3a の試作（Claude Code の API）

> 2026-10-09（B1）: リポジトリの直下に本番のプラグイン（`print-craft`）を置いたので、`claude plugin test` が直下から流すとき試作の試験を拾わないよう、試作のフックの試験の名前を `hooks/register.proto-test.ts` に変えた。試作の試験を流すときは、名前を `register.test.ts` に戻してこのフォルダーで `claude plugin test` を実行する

実装案（[../../docs/プラグイン化の実装案.md](../../docs/プラグイン化の実装案.md)）の 9 章 0-3a。秘密の値は使わない。書き込みもしない（`pcraft_save_settings` は確定する先を返すだけ）。

| ファイル | 中身 |
| --- | --- |
| `.claude-plugin/plugin.json` | プラグイン `print-craft-proto`。設定項目 `workspaceRoots`（文字列の配列） |
| `.mcp.json` | hello の print-craft MCP を `--surface claude-code --roots ${user_config.workspaceRoots}` で起動 |
| `server/hello.mjs` | hello の MCP サーバー（依存なし）。ツール ① `pcraft_save_settings`、② `pcraft_docs` / `pcraft_status`、③ `pcraft_workspace_status` |
| `hooks/register.ts` | フック: `workspaceId` の書き換えと登録の確認（4.1）、直接の Write / Edit の拒否（4.2）、起動の知らせ。どれも fail-closed |
| `hooks/register.test.ts` | 自動の試験 13 件（`claude plugin test`） |
| `skills/new/SKILL.md` | スキル `print-craft-proto:new` |

## 自動で確かめたこと（2026-10-09）

- `claude plugin validate`: 通った。`userConfig` の `"multiple": true` は受け付けられた
- `claude plugin test`: 13 件すべて通った
  - 4.2: 登録の前でも `settings/*.json` への Write を拒否、`..` を含む Edit、symlink を通した Write、セッションが作業フォルダーの下のとき、`temp/` は通す、作業フォルダーの外（まだ無いフォルダーの下）は止めない、フックの失敗は拒否
  - 4.1: ① と ③ の `workspaceId` を登録済みの作業フォルダーに書き換え、② は書き換えない、未登録で確認に答えられないときは拒否、フックの失敗は拒否
- hello の MCP サーバーを単体で（stdio）: 3 種類のツールの応答、登録済みでない `workspaceId` と `..` を `denied`、`--roots` の相対パス・存在しないパスを捨てる
- 分かったこと: 試験で `$` の呼び出し（`session.root`、`fs.stat`、`config.list` など）を差し替えるフックは `{ value }` か `{ deny }` で答える。Write の拒否のパスの判定は「存在する一番深い親」までさかのぼる必要がある（すぐ上のフォルダーだけだと、まだ無いフォルダーへの関係のない Write まで止める）

## 0.0.2 で直したこと（2026-10-09。手での確認の 5 の失敗から）

- 設定項目 `workspaceRoots` を、文字列の配列（`"multiple": true`）から**文字列 1 つ**（中身は JSON の配列 `["/Users/…"]`）にした。サーバーは JSON の形も読める
- 登録先の行があるかの確認を、確認の画面（`$.ui.ask`）の**前**に移した。行が無ければ、確認の画面を出さずに、見つかった行の名前（値は出さない）を付けて拒否する
- 確認の画面に答えが無かった（閉じた・出せない実行）と、「登録しない」を選んだ、の文を分けた
- `claude plugin test`: 14 件すべて通った（「行が無ければ確認の画面を出す前に拒否する」を足した）

設定項目の形を変えたので、試すときは Claude Code を終えて起動し直す（`/reload-plugins` では設定項目の形が変わらないことがある）。

## 手での確認で分かったこと（2026-10-09）

- **配列の設定項目（`"multiple": true`）は `/config` の行にならない** → 文字列 1 つ（JSON の配列）にした（0.0.2）
- **設定を変えても、プラグインの MCP サーバーは起動し直さない**。`/mcp` の再接続で新しい値が届く。フックから起動し直す手段: `$.mcp.connect` はつながっているサーバーにはそのまま答えるので使えない。`$.command.run`（`/reload-plugins` などのスラッシュコマンド）は未確認。別の案は、フックが登録の一覧をファイルに書き（`$.fs.write`）、サーバーが呼び出しのたびに読む形（AI が Write / Bash でそのファイルを書き換えないよう守る要あり）。関門で決める
- → **再接続は利用者に頼む形に決めた（2026-10-09 Takashi）**。登録は作業フォルダーごとに最初の 1 回だけなので、そのときだけの手間にする。0.0.2 のフックで、登録した直後の文に「`/mcp` で print-craft を再接続（Reconnect）するか、Claude Code を起動し直してから、もう一度実行してください」を入れ、再接続を忘れたとき（フックでは登録済みなのにサーバーが「登録済みの作業フォルダーでない」と断る）も同じ案内に置き換える。`claude plugin test` 15 件通過
- **確認の画面の「登録する」が灰色で押せないように見えた**（選ばれていない項目の見え方と見られる）→ 本番では項目に説明を付ける、先頭を「登録する（おすすめ）」にするなど

## 手で確かめること（Takashi）

`claude` は VS Code 拡張の中にある（端末の PATH に無い）:

```sh
CLAUDE=~/.vscode/extensions/anthropic.claude-code-2.1.292-darwin-arm64/resources/native-binary/claude
mkdir -p ~/pcraft-proto-ws/settings ~/pcraft-proto-ws/kintone ~/pcraft-proto-ws/temp
cd ~/pcraft-proto-ws
"$CLAUDE" --plugin-dir ~/Projects/kintone-plugin/print-craft-authoring-mcp/prototype/0-3a
```

作業用のフォルダー（`~/pcraft-proto-ws`）は試作のためだけのもの。テンプレートのフォルダーでは試さない。

| # | すること | 期待 | 結果 |
| --- | --- | --- | --- |
| 1 | 起動する | 「print-craft（試作）: 登録済みの作業フォルダー 0 件」の知らせ（toast）が出る | |
| 2 | `/mcp` を開く | `print-craft` のサーバーとツール 4 つが見える。**ツールの完全な名前**（`mcp__…__pcraft_status` の `…` の部分）を書き留める | 2026-10-09 Mac: サーバーは `plugin:print-craft-proto:print-craft`（ツール 4 つ、`readOnlyHint` は「read-only」と出る）。**完全な名前は `mcp__plugin_print-craft-proto_print-craft__pcraft_status`**（`mcp__plugin_<プラグイン名>_<.mcp.json のサーバー名>__<ツール名>`） |
| 3 | 「印刷屋の見積書の設定を作って（試作）」と頼む | スキル `print-craft-proto:new` が呼ばれる（日本語の依頼でスキルが呼ばれるか） | 2026-10-09 Mac: **呼ばれた**（`Skill(print-craft-proto:new)`）。スキルの手順で print-craft のツールを 4 回呼んだ |
| 4 | （3 の流れで）`pcraft_status` | `rootsRaw` に何が届いたか（未設定のとき空か、`${user_config.workspaceRoots}` のままか）を書き留める | 2026-10-09 Mac: `rootsRaw: [""]`、`roots: []`。設定が無いとき `${user_config.workspaceRoots}` は文字のまま残らず、**空の文字列**で届く |
| 5 | （3 の流れで）`pcraft_workspace_status` | **確認の画面**が出る →「登録する」→「作業フォルダーを登録しました。もう一度実行してください」 | 2026-10-09 Mac（0.0.1）: **失敗**。「登録する」が返った後、`/config` の行 `print-craft-proto.workspaceRoots` が見つからず拒否された。文字列の配列（`"multiple": true`）の設定項目は validate を通るが `/config` の行にならないと見られる（行の種類は boolean / choice / text / number だけ）。行の確認が確認の画面の後にあった（選ばせてから断る）のも誤り → 0.0.2 で直した（下） ／ 2026-10-09 Mac（0.0.2）: **確認の画面が出た**。「登録する」が灰色で押せないように見え、1 回目は「登録しない」を選んだ（使い勝手の気付き）。2 回目に「登録する」→「作業フォルダーを登録しました。もう一度実行してください」 |
| 6 | `/config` を開く | `print-craft-proto` の行に `~/pcraft-proto-ws` の実際のパスがある | 2026-10-09 Mac（0.0.2）: 「印刷屋の作業フォルダー · print-craft-proto」の行が出た（0.0.1 の `"multiple": true` では出なかった） |
| 7 | もう一度 `pcraft_status` | `rootsRaw` に登録したパスが届いているか（**設定を変えた後に MCP サーバーが新しい引数で起動し直したか**。届いていなければ `/reload-plugins` か再起動で届くか） | 2026-10-09 Mac（0.0.2）: **設定を変えても MCP サーバーは起動し直さない**。登録の直後、フックは作業フォルダーを見つけて `workspaceId` を入れたが、サーバーは起動時の引数（空）のままで「登録済みの作業フォルダーでない」と拒否した。`/mcp` →「Reconnect」で新しい値が届いた（`rootsRaw` に JSON の文字列、`roots` に `/Users/rex0220/pcraft-proto-ws`） |
| 8 | もう一度 `pcraft_workspace_status` と `pcraft_save_settings` | 確認の画面が出ずに通り、`workspaceId` が登録したパスになっている（AI が別の値を渡しても） | 2026-10-09 Mac（0.0.1）: 登録できていないので `pcraft_save_settings` も拒否された（期待どおりの止まり方） ／ 2026-10-09 Mac（0.0.2、再接続の後）: **OK**。AI が `workspaceId: /tmp` と渡しても、`wouldWrite` は `/Users/rex0220/pcraft-proto-ws/settings/proto.json`（フックが登録済みの作業フォルダーに書き換え、サーバーが受け付けた） |
| 9 | 「settings/test.json を Write で作って」と頼む | フックが拒否し「pcraft_save_settings を使う」と出る | 2026-10-09 Mac: **OK**。「print-craft: settings/test.json は直接書き換えない。print-craft MCP の保存のツール（pcraft_save_settings / pcraft_update_button）を使う」で止まった。AI は Bash などで回り込まなかった（AI の判断。フックは Bash を止めきれない） |
| 10 | 「temp/test.txt を Write で作って」と頼む | 通る | 2026-10-09 Mac: **OK**。`temp/test.txt` は作れた |
| 11 | 「kintone/a/b.json を Write で作って」と頼む | 拒否される | 2026-10-09 Mac: **OK**。`kintone/a/b.json` は同じ文で止まった |
| 12 | 別の端末で `cd ~/pcraft-proto-ws/temp && "$CLAUDE" --plugin-dir … -p "pcraft_workspace_status を呼んで結果を書いて"`（作業フォルダーの登録を `/config` で外してから） | 確認の画面を出せないので拒否される | |
| 13 | プラグインから許可の規則を配れるか（`plugin.json` に `settings` を書けるか） | `claude plugin validate` が受け付けるか、効くか（試すときは `plugin.json` を写した別のフォルダーで） | |

結果を書いたら、関門（9 章）で 4.1・4.2・5.1 の決まりを確定する。

## 後片付け

```sh
rm -rf ~/pcraft-proto-ws
```

`/config` の `print-craft-proto` の値は、`--plugin-dir` を付けずに起動すれば使われない（settings の `pluginConfigs` に残る。消すなら `/config` で消してから終える）。
