# 操作 × `role` × 対象のパスの許可の表（段階 0-1 ④）

2026-10-09 作成。実装案の 4.2、5.3、13.3 を、操作と対象のパスごとの許可にした表。承認: Takashi（2026-10-09）。

- 強制するのは中核（print-craft MCP と CLI が共有）。直接の Write / Edit は Claude Code のプラグインのフック（4.2）
- パスは作業フォルダーからの相対で、存在する一番深い親を realpath に直してから判定する（`safe-path.ts` と同じ規則。symlink / junction を解く。Windows は大文字小文字をそろえる）
- `<アプリのフォルダー>` = `kintone/<ホスト名>/<番号>-<アプリ名>/`（`environments.json` があるときの形）
- ○ = 許す、× = 拒否（`status: "denied"`）、— = その操作の対象にならない

## 1. 環境の状態

| 状態 | 条件 | 意味 |
| --- | --- | --- |
| **環境なし** | 作業フォルダーに `environments.json` が無い | 今の 1 環境の使い方（`settings/`、`fields/`、`records/`、`out/`）。`kintone/` は使わない |
| **開発** | `environments.json` のその環境の `role` が `development` | 作る・直す |
| **本番** | `role` が `production` | 今の設定を見るだけ（pull / ダウンロード） |
| **未分類** | `environments.json` があり `role` が無い環境。または `environments.json` が無いのに `kintone/` の下を触る | 読み取りと診断だけ（内部だけの状態。JSON に `"unclassified"` とは書けない） |

`<アプリのフォルダー>` がどの環境のものかは、ホスト名とアプリの番号を `environments.json` の環境と `apps` に照らして決める（今の `workspace.ts`）。どの環境にも合わなければ**未分類**。状態は、`kintone/` の下を変える操作の直前に `environments.json` を読み直して決める（起動のときの値を使い続けない）。

## 2. 対象のパス

| ID | 対象のパス | 説明 |
| --- | --- | --- |
| P1 | `settings/**`、`temp/**` | 新しい設定、控え（環境なしの使い方） |
| P2 | `fields/**`、`records/**` | 項目定義、レコード（環境なし） |
| P3 | `out/**` | preview の出力（環境なし。本番の preview の出力先もここ） |
| P4 | `<アプリのフォルダー>/rex0220-print-craft-app<番号>-<日時>.json` | ダウンロード / pull のファイル（今の設定の控え） |
| P5 | `<アプリのフォルダー>/*-edit.json` | 直すためのファイル |
| P6 | `<アプリのフォルダー>/` のその他の `*.json` | 新しい帳票（1 ファイル 1 帳票） |
| P7 | `<アプリのフォルダー>/fields.json` | 項目定義 |
| P8 | `<アプリのフォルダー>/records/**` | レコード |
| P9 | `<アプリのフォルダー>/out/**` | preview の出力 |
| P10 | `inbox/**` | 利用者が置いたダウンロード（`take` が読んで消す） |
| P11 | `policy/**`、`.env`、`env/**`、`environments.json` | 承認、認証、環境の定義 |
| P12 | 作業フォルダーの外 | — |
| P13 | 作業フォルダーの中のその他（`requirements/` など） | — |

## 3. 操作と書く先

| 操作 | print-craft MCP のツール | CLI | 書く先（変更） |
| --- | --- | --- | --- |
| 読む・診断 | `pcraft_buttons`、`pcraft_files`、`pcraft_diff`、`pcraft_normalize`、`pcraft_workspace_status`、`pcraft_status`、`pcraft_docs` | `buttons`、`files`、`diff`、`normalize --dry-run` / `--check`、`fields --summary`、`record --summary`、`version` | 無し |
| 新しい設定の保存 | `pcraft_save_settings` | （`normalize` の書き戻しで代わり） | P1、P6 |
| ボタンの差し替え | `pcraft_update_button` | （AI が直接編集 → `normalize` の書き戻し） | P1、P5 |
| normalize の書き戻し | （無し。保存のツールの中で行う） | `normalize`（書き戻し） | P1、P5、P6 |
| preview | `pcraft_preview` | `preview` | P3、P9 |
| 項目定義の保存 | `pcraft_fields` | `fields` | P2、P7 |
| レコードの保存 | `pcraft_record` | `record` | P2、P8 |
| pull（新しいファイル） | `pcraft_pull` | `pull` | P1（環境なし）、P4（新しい名前で増やす） |
| pull で上書き | （受け付けない） | `pull --force` | P1、P4 |
| take | `pcraft_take` | `take` | P4（新しい名前）、P10 を消す |
| edit | `pcraft_edit` | `edit` | P5（P4 を写す） |

## 4. 許可の表（中核が強制）

### 4.1 `kintone/` の外（環境の状態に依らない）

| 対象 | 読む | 書く・変える | 備考 |
| --- | --- | --- | --- |
| P1 `settings/`、`temp/` | ○ | ○（保存の約束 5.3 を通す。`pcraft_save_settings` は新しいファイルだけ、`pcraft_update_button` は digest の照合） | |
| P2 `fields/`、`records/` | ○ | ○ | |
| P3 `out/` | ○ | ○ | 本番のアプリの preview もここに出す |
| P10 `inbox/` | ○ | `take` が消すだけ | |
| P11 `policy/` など | 中核は固定の場所を読むだけ（`.env`、`policy/authoring-policy.json`、`environments.json`） | **×**（どのツールの対象にもしない） | Claude Code の Write / Edit は `.claude/settings.json` で拒否（今のまま） |
| P12 作業フォルダーの外 | **×** | **×** | 印刷屋の zip だけは設定項目 / `.env` の固定の場所から読む |
| P13 その他 | ○（Claude Code の Read。print-craft MCP には読む口が無い） | print-craft MCP は書かない | |

### 4.2 `<アプリのフォルダー>`（`kintone/` の下）

| 対象 | 開発 | 本番 | 未分類 |
| --- | --- | --- | --- |
| P4 ダウンロード / pull のファイル | 読む ○。新しい名前で増やす（pull、take）○。**書き換え ×**（`pull --force` も ×） | 読む ○。新しい名前で増やす（pull、take）○。書き換え × | 読む ○。**増やすのも ×** |
| P5 `*-edit.json` | 作る（edit）○。差し替え（`pcraft_update_button`、normalize の書き戻し）○ | **×** | **×** |
| P6 新しい帳票 | 保存（`pcraft_save_settings`）○ | **×** | **×** |
| P7 `fields.json` | ○ | **×**（本番の項目定義は開発の環境で取る） | **×** |
| P8 `records/` | ○ | **×** | **×** |
| P9 `out/` | ○ | **×**（本番の preview は P3 `out/` に出す） | **×** |
| 診断・読み取り（buttons、files、diff、normalize の確認） | ○ | ○ | ○ |

拒否するときの文（固定）:

- 本番: 「環境『<名前>』は本番（`role: production`）なので変更できない。開発の環境で作る・直す」
- 未分類: 「環境『<名前>』に `role` が無い（または `environments.json` が無い）ので `kintone/` の下を変更できない。`environments.json` の環境に `role` を書く（利用者が書く）」
- ダウンロードのファイル: 「ダウンロード / pull のファイルは書き換えない。`pcraft_edit` で `-edit.json` に写して直す」

## 5. 直接の Write / Edit（Claude Code のプラグインのフック。4.2）

プラグインを使う人だけ。**登録の状態と関係なく**、セッションのフォルダー（またはその祖先の登録済みの作業フォルダー 1 つ）を起点に判定する。

| 対象 | 直接の Write / Edit |
| --- | --- |
| `settings/**/*.json` | **×**（`pcraft_save_settings` / `pcraft_update_button` を使う） |
| `kintone/**` | **×**（環境の状態に依らず。中身の変更はすべて print-craft MCP） |
| `temp/**`、`requirements/**` などその他の作業フォルダーの中 | ○（フックは止めない） |
| `policy/**`、`.env`、`env/**`、`environments.json` | ×（`.claude/settings.json` の拒否。今のまま） |
| 起点のフォルダーの外 | フックは止めない（印刷屋と関係のないファイル） |
| 解決できない・リンク切れ・起点が 1 つに決まらない | **×** |

Read / Bash / PowerShell での設定ファイル（`settings/**/*.json`、`kintone/**/*.json`）の丸ごとの表示も ×（4 章。`pcraft_buttons` を使う）。

## 6. プラグインなしの CLI（今の使い方）

- 4 章の許可（`role`、未分類、ダウンロードのファイルの書き換え ×）は中核が強制するので、CLI にも効く（実装案 12.8 の影響）
- **AI の直接の Edit は止まらない**。テンプレートの `.claude/settings.json` は `Edit(kintone/**)` を許可していて、変えない決定（2026-10-09 Takashi）。AI が本番のフォルダーの `*-edit.json` などを直接 Edit することは、今と同じく CLAUDE.md の文章（「本番のフォルダーは見るだけ」）に頼る。直した後の `normalize` の書き戻しは中核が拒否するので、本番の設定が normalize を通った形で確定することは無い
- `pull --force` は、開発では P4 の書き換えになるので ×、環境なし（`settings/`）では今のまま ○

## 7. 未決

無し。
