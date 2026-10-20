# 自動の確かめ（claude plugin eval）

決まった依頼文で、print-craft のプラグインを入れた Claude Code を動かし、使ったツール・書いたファイル・最後の答えを採点する（Claude Code 2.1.269 以降。文書は https://code.claude.com/docs/en/plugin-evals.md ）。
本物の print-craft MCP サーバーを動かす（作り物の答え = mock は使わない）。kintone は使わない（お試しアプリ `pcraft_try` と、作業フォルダーに置いた試験用の fixture だけ）。

## 動かし方

```sh
npm run build
node scripts/build-eval-plugin.mjs
claude plugin eval .tmp/eval-plugin --runs 1 --ablation none --mocks off \
  --allow-tools "mcp__plugin_print-craft_print-craft__*" --scaffold --trust-plugin --no-publish -j 3 --max-cost-usd 5
```

- `build-eval-plugin.mjs` が `.tmp/eval-plugin/` に eval 専用の写しを作る（コミットしない）。中身は公開のプラグインと同じで、eval の実行の一時フォルダーを作業フォルダーにするための 2 つだけが違う（eval の実行は一時の設定で動き、プラグインの設定項目が空。作業フォルダーの登録の確認の画面にも答えられない）: サーバーは起動のファイル `eval-launch.cjs`（作業フォルダー = サーバーの作業フォルダー）、フックは登録済みの作業フォルダーの代わりにセッションのフォルダー。印刷屋の zip は `PCRAFT_EVAL_PLUGIN_ZIP`（既定 `../print-craft/dist/print-craft-plugin9.zip`）
- 1 つのケースだけ: `--case quote`（`--case` は 1 つ。複数なら `--tag`）。様子を見るなら `--keep-temp`（実行の記録 trace.jsonl が残る）
- `--scaffold` は `edit-existing` が作業フォルダーに fixture を置くのに要る（このリポジトリのケースだけで使う）
- 費用は実行ごとにかかる（利用者の利用枠）。1 回ずつで 5 ケース 1〜2 ドル、1〜2 分（2026-10-20）
- 結果は `.tmp/eval-plugin/evals/results/<日時>/`（HTML の報告と JSON）。`--no-publish` で claude.ai に上げない

## ケース

| ケース | 確かめること |
| --- | --- |
| `probe` | 準備: 作業フォルダーが登録済み、印刷屋の zip を読める |
| `quote` | アプリが無いとき、見積書の形を `pcraft_try`（quote、button）で試す。保存しない。帳票に宛名と「2026年2月24日」（日付が epoch 秒の数で出ない） |
| `invoice` | 発行日を和暦、支払期限を翌月末日に。資料（patterns）を読み、`pcraft_try` の値に 令和8年2月24日・3月31日・2月28日 |
| `list` | 一覧帳票（list、count 25）。帳票に架空の値 |
| `gantt-limit` | 関連レコード一覧 1,001 件は作らない（`related.tooMany`）と説明する |
| `edit-existing` | 既存の設定のボタンの見積日を和暦に。`pcraft_buttons` → `pcraft_update_button`、`list` / `viewsCsv` を変えない（警告が出ない）、反映方法を設定画面の言葉で |

採点の書き方: trace（実行の記録。1 行 1 つの JSON）を正規表現で見るときは、ツールが返した JSON の中のキー（`\"text\":`、`\"code\":`、`\"rule\":`）に合わせる（資料の文に同じ言葉があっても合わないように）。最後の答えは AI の採点者（`type: llm`）で、言語の決まりは「説明の文は日本語（式・関数名・変数名は英字でよい）」と書く。
