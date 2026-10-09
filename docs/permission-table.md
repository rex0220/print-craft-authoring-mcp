# 操作 × 動く形 × 対象のパスの許可の表（段階 0-1 ④）

2026-10-09 作成（実装案の 4.2、5.3、13.3 を、操作と対象のパスごとの許可にした表。承認: Takashi）。2026-10-10、実装案 15 章（kintone の接続のファイル。本番の保護 `role` をやめる。2026-10-10 Takashi）に合わせて、`role` の代わりに、動く形（15.4）と、アプリのフォルダーの profile と印（15.5）で決める表に直した。

- 強制するのは中核（print-craft MCP と CLI が共有。`permission.ts` の `assertChangeAllowed`、`workspace.ts` の `assertUsableInKintone` と `ensureAppFolder`）。直接の Write / Edit は Claude Code のプラグインのフック（4.2）
- パスは作業フォルダーからの相対で、存在する一番深い親を realpath に直してから判定する（`safe-path.ts` と同じ規則。symlink / junction を解く。Windows は大文字小文字をそろえる）
- `<アプリのフォルダー>` = `kintone/<profile>/<番号>-<アプリ名>/`（印 `.pcraft-app.json` を持つ）
- ○ = 許す、× = 拒否、— = その操作の対象にならない

## 1. 動く形（15.4）

| 形 | 条件 | `kintone/` の下 |
| --- | --- | --- |
| **profiles** | kintone の接続のファイルが設定されていて読める | 2 章と 5.2 の決まりで使う |
| **single**（CLI だけ） | 接続のファイルも `environments.json` も無い | 使わない（読む・一覧する・書く ×）。今の 1 接続の使い方（`.env` の `KINTONE_*`、`settings/`、`fields/`、`records/`、`out/`） |
| **not-configured**（print-craft MCP だけ） | 接続のファイルが無い | 使わない。kintone を使う操作は failed（not-configured）。`settings/` などの作業は動く |
| **legacy-blocked** | 接続のファイルが無く、作業フォルダーに `environments.json` がある（有無だけ。中身は読まない） | 使わない。kintone を使う操作も failed（legacy-config-present）。`settings/` などの作業は動く |
| （誤り） | 接続のファイルが設定されていて、空・読めない・形が違う・作業フォルダーの中 | 形を決める操作はすべて止める（1 接続の形に戻らない）。読むだけの `buttons` / `diff` は `kintone/` の外なら動く |

## 2. アプリのフォルダーの状態（profiles のとき。15.5）

| 状態 | 条件 | 読む・一覧する・書く |
| --- | --- | --- |
| **使える** | profile が接続のファイルの使える profile にあり、印が今の接続のこのアプリのもの（profile、接続先、ゲストスペース、アプリ ID が全部合う） | 5.2 の表 |
| 接続のファイルに無い profile | `kintone/<名前>/` の名前が、接続のファイルの使える profile に無い（profile の名前を変えた、使えない profile） | ×（denied）。診断はフォルダーの名前だけ |
| 印が無い・壊れている・別の接続 | app-marker-missing / app-marker-invalid / app-identity-conflict | ×（conflict）。診断は名前と印の状態だけ。利用者が名前を変えて退け、fields か pull で作り直す |
| まだ無い | — | 作れるのは fields・pull・take だけ（同じ親の一時フォルダーに印を置いてから名前を付け替える） |
| 同じ番号が 2 つ | `<番号>-…` のフォルダーが 2 つ | ×（conflict。利用者が 1 つにする） |

`kintone/<profile>/…` を変える確定の直前に、接続のファイルを読み直し、選んだ profile の意味の digest（接続先、ゲストスペース、認証の種類、資格情報の指紋、アプリ）が呼び出しの初めと同じかを確かめる（違えば conflict、connection-changed。ほかの profile だけの書き換えでは止めない。15.6）。

## 3. 対象のパス

| ID | 対象のパス | 説明 |
| --- | --- | --- |
| P1 | `settings/**`、`temp/**` | 新しい設定、控え |
| P2 | `fields/**`、`records/**` | 項目定義、レコード（CLI の 1 接続の形と、パスを明示した normalize / preview） |
| P3 | `out/**` | preview の出力（アプリのフォルダーの外の設定） |
| P4 | `<アプリのフォルダー>/rex0220-print-craft-app<番号>-<日時>.json` | ダウンロード / pull のファイル（今の設定の控え） |
| P5 | `<アプリのフォルダー>/*-edit.json` | 直すためのファイル |
| P6 | `<アプリのフォルダー>/` のその他の `*.json` | 新しい帳票（1 ファイル 1 帳票） |
| P7 | `<アプリのフォルダー>/fields.json` | 項目定義 |
| P8 | `<アプリのフォルダー>/records/<番号>.json` | レコード |
| P9 | `<アプリのフォルダー>/out/**` | preview の出力 |
| P10 | `inbox/**` | 利用者が置いたダウンロード（`take` が読んで消す） |
| P11 | `policy/**`、`.env`、`env/**`、`environments.json` | 承認、認証（1 接続の形）、tools 1.x の環境の定義（有無だけを見る） |
| P12 | 作業フォルダーの外 | — |
| P13 | 作業フォルダーの中のその他（`requirements/` など） | — |
| P14 | `<アプリのフォルダー>/.*`（印 `.pcraft-app.json` など `.` で始まるもの）、`<アプリのフォルダー>` のサブフォルダー（`records/` の下のフォルダーなど） | 中核の予約 |
| P15 | kintone の接続のファイル（作業フォルダーの外） | 接続先と秘密の値。中核が読むだけ |

## 4. 操作と書く先

| 操作 | print-craft MCP のツール | CLI | 書く先（変更） |
| --- | --- | --- | --- |
| 読む・診断 | `pcraft_buttons`、`pcraft_files`、`pcraft_diff`、`pcraft_normalize`、`pcraft_workspace_status`、`pcraft_status`、`pcraft_docs` | `buttons`、`files`、`diff`、`normalize --dry-run` / `--check`、`fields --summary`、`record --summary`、`version` | 無し |
| 新しい設定の保存 | `pcraft_save_settings` | （`normalize` の書き戻しで代わり） | P1、P6 |
| ボタンの差し替え | `pcraft_update_button` | （AI が直接編集 → `normalize` の書き戻し） | P1、P5、P6 |
| normalize の書き戻し | （無し。保存のツールの中で行う） | `normalize`（書き戻し） | P1、P5、P6 |
| preview | `pcraft_preview` | `preview` | P3、P9 |
| 項目定義の保存 | `pcraft_fields` | `fields` | P7（profiles）、P2（CLI の single） |
| レコードの保存 | `pcraft_record` | `record` | P8（profiles）、P2（CLI の single） |
| pull（新しいファイル） | `pcraft_pull` | `pull` | P4（profiles。新しい名前で増やす）、P1（CLI の single） |
| pull で上書き | （受け付けない） | `pull --force`（CLI の single だけ） | P1 |
| take | `pcraft_take` | `take` | P4（新しい名前）、P10 を消す |
| edit | `pcraft_edit` | `edit` | P5（P4 を写す） |

## 5. 許可の表（中核が強制）

### 5.1 `kintone/` の外（形に依らない）

| 対象 | 読む | 書く・変える | 備考 |
| --- | --- | --- | --- |
| P1 `settings/`、`temp/` | ○ | ○（保存の約束 5.3 を通す。`pcraft_save_settings` は新しいファイルだけ、`pcraft_update_button` は digest の照合。ダウンロード / pull の名前は ×） | |
| P2 `fields/`、`records/` | ○ | ○ | |
| P3 `out/` | ○ | ○ | |
| P10 `inbox/` | ○ | `take` が消すだけ | |
| P11 `policy/` など | 中核は固定の場所を読むだけ（`.env`、`policy/authoring-policy.json`）。`environments.json` は有無だけ（lstat） | **×**（どのツールの対象にもしない） | Claude Code の Write / Edit は `.claude/settings.json` で拒否（今のまま） |
| P12 作業フォルダーの外 | **×** | **×** | 印刷屋の zip と接続のファイルだけは、設定の固定の場所から中核が読む |
| P13 その他 | ○（Claude Code の Read。print-craft MCP には読む口が無い） | print-craft MCP は書かない | |
| P15 接続のファイル | 中核が読むだけ（作業フォルダーの外のときだけ。ツールの引数で指定できない） | **×** | Claude Code の AI は Read / Bash で読める（受け入れた危険。threat-model.md M21） |

### 5.2 `<アプリのフォルダー>`（profiles の形で、2 章の「使える」もの）

| 対象 | 読む | 書く・変える |
| --- | --- | --- |
| P4 ダウンロード / pull のファイル | ○ | 新しい名前で増やす（pull、take）○。**書き換え ×** |
| P5 `*-edit.json` | ○ | 作る（edit）○。差し替え（`pcraft_update_button`、normalize の書き戻し）○ |
| P6 新しい帳票 | ○ | 保存（`pcraft_save_settings`）○、差し替え ○ |
| P7 `fields.json` | ○ | ○（fields だけ。フォルダーが無ければ作る） |
| P8 `records/<番号>.json` | ○ | ○（record だけ） |
| P9 `out/` | ○ | ○（preview だけ） |
| P14 印など | —（一覧に出さない） | **×**（中核がフォルダーを作るときだけ） |
| 診断・読み取り（buttons、files、diff、normalize の確認） | ○ | — |

本番のアプリのフォルダーも同じ（読み取りだけにする守りは無い。作るのも直すのも開発のアプリ、は文書の案内）。2 章の「使える」でないフォルダー、1 章で `kintone/` を使わない形では、5.2 のすべての操作が ×。

拒否するときの文（固定。値・パス・秘密を入れない。profile の名前、アプリの番号、フォルダーの名前、接続のファイルの名前まで）:

- 接続のファイルに無い profile: 「profile「<名前>」は接続のファイル（<ファイル名>）に無い（使われていないフォルダーは変えない）」
- 印: 「kintone/<profile>/<フォルダー> に印（.pcraft-app.json）が無い。…名前を変えて退け、fields か pull で作り直す」（壊れている・別の接続も同じ形）
- 接続が変わった: 「profile「<名前>」の接続が途中で変わった。もう一度やり直す」
- `kintone/` を使わない形: 「kintone/ の下は、kintone の接続のファイルがあるときだけ変える（今の形では settings/ などを使う）」（読むときは「…だけ使う」）
- ダウンロードのファイル: 「ダウンロード / pull のファイルは書き換えない。`pcraft_edit` で `-edit.json` に写して直す」

## 6. 直接の Write / Edit（Claude Code のプラグインのフック。4.2）

プラグインを使う人だけ。**登録の状態と関係なく**、セッションのフォルダー（またはその祖先の登録済みの作業フォルダー 1 つ）を起点に判定する。

| 対象 | 直接の Write / Edit |
| --- | --- |
| `settings/**/*.json` | **×**（`pcraft_save_settings` / `pcraft_update_button` を使う） |
| `kintone/**` | **×**（形や印に依らず。中身の変更はすべて print-craft MCP） |
| `temp/**`、`requirements/**` などその他の作業フォルダーの中 | ○（フックは止めない） |
| `policy/**`、`.env`、`env/**`、`environments.json` | ×（`.claude/settings.json` の拒否。今のまま） |
| 起点のフォルダーの外 | フックは止めない（印刷屋と関係のないファイル。接続のファイルの Read / Bash を断るのは B2。15.13） |
| 解決できない・リンク切れ・起点が 1 つに決まらない | **×** |

Read / Bash / PowerShell での設定ファイル（`settings/**/*.json`、`kintone/**/*.json`）の丸ごとの表示も ×（4 章。`pcraft_buttons` を使う）。

## 7. プラグインなしの CLI（テンプレート）

- 1〜5 章の許可は中核が強制するので、CLI にも効く（`PCRAFT_KINTONE_CONFIG` があれば profiles の形。15.9）
- **AI の直接の Edit は止まらない**。テンプレートの `.claude/settings.json` は `Edit(kintone/**)` を許可していて、変えない決定（2026-10-09 Takashi）。印のファイルを AI が直接書き換えることは文書（CLAUDE.md「印は消さない・書かない」）に頼る。書き換えても、使えるのは今の接続のそのアプリのフォルダーとしてだけ（threat-model.md M9）
- `pull --force` は CLI の 1 接続の形（`settings/`）だけ。profiles の形では ×（ダウンロード / pull のファイルは書き換えない）

## 8. 未決

無し。
