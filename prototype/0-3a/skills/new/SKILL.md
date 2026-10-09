---
name: new
description: 印刷屋プラグイン（rex0220 Print craft）の新しい帳票・ボタンの設定 JSON を作るときに使う（段階 0-3a の試作。見積書・請求書・納品書などの帳票の設定を作る依頼）
---

# 印刷屋の新しい設定を作る（試作）

この試作では、帳票の中身はまだ作らない。次の順に print-craft MCP のツールを呼び、結果をそのまま利用者に見せる。

1. `pcraft_docs`（引数なし）で目次と版を見る
2. `pcraft_status` で、サーバーが受け取った作業フォルダー（`--roots`）の形を見る
3. `pcraft_workspace_status` を呼ぶ（`workspaceId` は何を渡してもよい。フックが書き換える）。未登録なら確認の画面が出るので、利用者に答えてもらう
4. `pcraft_save_settings` を `{ path: "settings/proto.json", content: "{}", expectedAbsent: true }` で呼ぶ（試作なので書き込まない）

`settings/` や `kintone/` のファイルを Write / Edit で直接書かない（フックが拒否する）。
