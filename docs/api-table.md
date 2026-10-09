# kintone の API の表（段階 0-1 ②）

2026-10-09 作成。print-craft MCP と中核が呼ぶ kintone の API ごとに、認証、入力、受け取る量の上限、AI に返すもの・量の上限を決める。承認: Takashi（2026-10-09）。

出典: kintone の公式の資料（kintone docs MCP、2026-10-09 に読んだ。url_path は表の右端）。今の tools の実装（`tools/src/kintone-rest.ts`、`commands/`）。

## 1. 共通の決まり（今の tools と同じ。中核に残す）

- **GET だけ**。メソッドは中核で固定（他のメソッドを送る口が無い）
- **許可した API だけ**（`ALLOWED_APIS`）。URL・メソッド・本文を AI から受け取らない
- **送信先の検証**: 接続先（`kintoneBaseUrl` / `KINTONE_BASE_URL`）は `*.cybozu.com` / `*.kintone.com` / `*.cybozu.cn` だけ。送る直前にオリジンが同じか確かめる
- **エラーの文**: HTTP の状態と kintone のエラーコードと固定のヒントだけ（kintone のサーバーの message は出さない）
- **受け取る量の上限**（新規。実装案 5.4）: `Content-Length` が上限を超えれば本文を読まずに拒否。`Content-Length` が無い・偽りでも、読みながら上限 + 1 バイトで止める。JSON にするのは上限の確認の後だけ。上限は API ごと（下の表）。CLI でも同じ上限が効くので、大きなアプリで引っかからない値にする（実装案 12.8）
- **AI に返す量の上限**（新規）: 受け取る量とは別に持つ。超えたら打ち切り、`findings` に `truncated` を出す

## 2. API ごとの表

認証: **P** = パスワード認証、**T** = API トークン認証、**S** = セッション認証、**O** = OAuth 認証（資料の「認証」の行）。print-craft MCP（Desktop の最初の版）は API トークンだけを使う（実装案 6.1）。

| API（`/k/v1/…`。ゲストスペースは `/k/guest/<スペース>/v1/…`） | 認証 | 必要な権限 | 使う所 | 入力（print-craft MCP が決める） | 受け取る量の上限（案） | AI に返すもの | AI に返す量の上限（案） | 個人の情報 | 出典 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `app.json`（1 件のアプリの情報） | P T S O | レコード閲覧かレコード追加のどちらか | `kintone_get_app`（Desktop）、`fields`（アプリ名） | `id`（番号。URL は中核で番号とゲストスペースに直す。実装案 5.4） | 64 KiB | `appId`、`name`、`code`、`spaceId`、`threadId` だけ | 4 KiB（`name` は 200 文字まで） | 応答に `creator` / `modifier`（コードと氏名）→ **返さない** | `/ja/kintone/docs/rest-api/apps/get-app/` |
| `apps.json`（複数のアプリの情報） | P S O（**T は無い**） | — | **使わない** | — | — | — | — | — | `/ja/kintone/docs/rest-api/apps/get-apps/` |
| `app/form/fields.json`（項目定義）。`preview/…` は動作テスト環境 | P T S O | 運用: レコード閲覧かレコード追加。動作テスト: アプリ管理 | `pcraft_fields`、`fields` | `app`、`lang`（既定のまま） | 8 MiB | 要約（1 項目 1 行。`fields --summary`）。保存は作業フォルダーの `fields.json` | 256 KiB | `entities[].code`（選択肢のユーザー・組織・グループ）、ユーザー選択の `defaultValue[].code` → ファイルには保存するが**要約に出さない**（今の `fields --summary` も出していない） | `/ja/kintone/docs/rest-api/apps/form/get-form-fields/` |
| `app/form/layout.json`（レイアウト）。`preview/…` は動作テスト環境 | P T S O | 項目定義と同じ | `pcraft_fields`、`fields`（要約の順に使う） | `app` | 8 MiB | 返さない（要約の並びに使うだけ） | — | 無し | `/ja/kintone/docs/rest-api/apps/form/get-form-layout/` |
| `record.json`（1 件のレコード） | P T S O | アプリのレコード閲覧、そのレコードの閲覧、フィールドの閲覧 | `pcraft_record`、`record` | `app`、`id`（`fields` の指定は無い。`fieldsFrom` は中核が保存の前に絞る） | 8 MiB | 形の要約だけ（`record --summary`）。保存は作業フォルダーの `records/` | 64 KiB | **すべての値**（作成者・更新者・作業者・ユーザー / 組織 / グループ選択の `code` と `name`、添付の `name`、自由入力の値）→ **返さない**（保存するだけ。`records/` はコミットしない） | `/ja/kintone/docs/rest-api/records/get-record/` |
| `records.json`（複数のレコード）。**新しく足す** | P T S O | `record.json` と同じ | `kintone_list_records`（Desktop） | `app`、`query`（条件と並べ替えだけ。500 文字まで。`limit` / `offset` を含めば拒否）+ サーバーが `limit 5` を付ける。`fields` は指定しない（形の要約に全部の項目が要る）。`totalCount` は付けない | 8 MiB | 1 件ごとの形の要約だけ（`$id`、文字数・行数、数値の桁、テーブルの行数、添付の件数と種類） | 64 KiB | `record.json` と同じ → **返さない**（保存もしない） | `/ja/kintone/docs/rest-api/records/get-records/` |
| `app/plugin/config.json`（プラグインの設定情報。**API ラボ**）。`preview/…` は動作テスト環境 | **資料に認証の行が無い**。API トークンで使える API の一覧に**載っていない** | 運用: レコード閲覧とレコード追加。動作テスト: アプリ管理 | `pcraft_pull`、`pull` | `app`、`id`（印刷屋のプラグイン ID。中核が zip から決める） | 2 MiB（プラグインの設定の保存値は 256 KB まで） | 返さない（封筒の形で作業フォルダーに保存。中身は `pcraft_buttons` で見る） | — | 印刷屋の設定の中身（帳票の HTML、社印の data: の URL、権限のユーザー / 組織 / グループのコードがありうる）→ `pcraft_buttons` の決まり（data: の URL は先頭と長さだけ）に従う | `/ja/kintone/docs/api-lab/rest-api/apps/get-app-plugin-config/` |

上限の値は案。大きなアプリ（項目 500 前後、テーブルが多い）でも引っかからない値として置き、0-2 の試験と実際のアプリで確かめて決める。AI に返す量の上限は、超えたら打ち切って `findings` に出す（拒否はしない）。受け取る量の上限は、超えたら `failed`（`LimitError`）。

## 3. 認証についての注意

- **`apps.json` は API トークンで使えない**。Desktop の最初の版（API トークンだけ）では、アプリを名前で探さず、番号か URL をもらう（実装案 5.4）。Claude Code では公式の kintone MCP が受け持つ（パスワード認証なら名前で探せる）
- **プラグインの設定情報の API（`pull`）は API ラボ**。「検討中の新機能」で有効にした環境だけで、仕様の変更や中止がありうる（資料はテスト環境での利用を勧めている）。認証の行が資料に無く、API トークンで使える API の一覧にも載っていない。今の tools は API トークンが設定されていればそれを送る（`kintone-rest.ts`）ので、API トークンだけの環境では失敗する見込み（要確認）
  - 決めたこと: Desktop の最初の版では `pcraft_pull` を出すが、失敗したら「印刷屋の設定画面で設定をダウンロードし、作業フォルダーの `inbox/` に置いて `pcraft_take`」と案内する（今の CLAUDE.md の流れと同じ）。API トークンで使えるかは 0-4 で確かめる（使えなければ Desktop では `pcraft_pull` を出さない）
- **API トークンでの操作は Administrator の操作として扱われる**。返る言語は Administrator の表示言語（項目のラベルが利用者の言語と違うことがある）
- API トークンは 1 回のリクエストに 9 個まで（カンマ区切り）。1 つのアプリに 20 個まで作れる。Desktop の設定項目は 1 つの文字列（カンマ区切りで複数のアプリのトークンを入れられる）
- ゲストユーザーはセッション認証しか使えない（print-craft MCP では使えない）

## 4. 共通の制限（kintone の共通仕様）

- 同時接続は 1 ドメイン 100 まで。1 日のリクエストは 1 アプリにつきスタンダードコース 10,000 件（ワイドコース 100,000 件）。print-craft MCP は 1 回の操作で数回しか呼ばないので、上限に近づかない。並べて呼ばない（1 つずつ）
- URL が 8 KB を超えると Request URL Too Large。`query` を 500 文字に限るので超えない
- `records.json` は 1 回に 500 件まで、`offset` は 10,000 まで。print-craft MCP は `limit 5` 固定、`offset` を使わない
- 応答の大きさの上限は資料に無い → 受け取る量の上限は自分で持つ（1 章）

## 5. 未決

無し。要確認は次のとおり。

| 要確認 | 段階 | 決め方 |
| --- | --- | --- |
| プラグインの設定情報の API（`pull`）が API トークンで使えるか | 0-4 | 使えなければ Desktop では `pcraft_pull` を出さず、ダウンロード + `pcraft_take` だけにする（決定済み） |
| 受け取る量の上限の値（2 章の案） | 0-2 | 実際の大きなアプリで、案の値に収まるかを確かめる。収まらなければ値を上げる（上限を持つことは決定済み） |
