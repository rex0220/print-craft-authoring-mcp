# 段階 0-3a の試作（Claude Code の API）

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
| 2 | `/mcp` を開く | `print-craft` のサーバーとツール 4 つが見える。**ツールの完全な名前**（`mcp__…__pcraft_status` の `…` の部分）を書き留める | |
| 3 | 「印刷屋の見積書の設定を作って（試作）」と頼む | スキル `print-craft-proto:new` が呼ばれる（日本語の依頼でスキルが呼ばれるか） | |
| 4 | （3 の流れで）`pcraft_status` | `rootsRaw` に何が届いたか（未設定のとき空か、`${user_config.workspaceRoots}` のままか）を書き留める | |
| 5 | （3 の流れで）`pcraft_workspace_status` | **確認の画面**が出る →「登録する」→「作業フォルダーを登録しました。もう一度実行してください」 | |
| 6 | `/config` を開く | `print-craft-proto` の行に `~/pcraft-proto-ws` の実際のパスがある | |
| 7 | もう一度 `pcraft_status` | `rootsRaw` に登録したパスが届いているか（**設定を変えた後に MCP サーバーが新しい引数で起動し直したか**。届いていなければ `/reload-plugins` か再起動で届くか） | |
| 8 | もう一度 `pcraft_workspace_status` と `pcraft_save_settings` | 確認の画面が出ずに通り、`workspaceId` が登録したパスになっている（AI が別の値を渡しても） | |
| 9 | 「settings/test.json を Write で作って」と頼む | フックが拒否し「pcraft_save_settings を使う」と出る | |
| 10 | 「temp/test.txt を Write で作って」と頼む | 通る | |
| 11 | 「kintone/a/b.json を Write で作って」と頼む | 拒否される | |
| 12 | 別の端末で `cd ~/pcraft-proto-ws/temp && "$CLAUDE" --plugin-dir … -p "pcraft_workspace_status を呼んで結果を書いて"`（作業フォルダーの登録を `/config` で外してから） | 確認の画面を出せないので拒否される | |
| 13 | プラグインから許可の規則を配れるか（`plugin.json` に `settings` を書けるか） | `claude plugin validate` が受け付けるか、効くか（試すときは `plugin.json` を写した別のフォルダーで） | |

結果を書いたら、関門（9 章）で 4.1・4.2・5.1 の決まりを確定する。

## 後片付け

```sh
rm -rf ~/pcraft-proto-ws
```

`/config` の `print-craft-proto` の値は、`--plugin-dir` を付けずに起動すれば使われない（settings の `pluginConfigs` に残る。消すなら `/config` で消してから終える）。
