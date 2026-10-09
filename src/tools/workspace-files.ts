/**
 * 作業フォルダーのファイルを扱うツール（実装案 5.1 の最後の行。今の CLI の files / take / edit / diff）。
 *   - pcraft_files: environments.json があればアプリのフォルダーの一覧（ダウンロード / pull は新しい順、-edit.json、新しい帳票、records、out）、
 *     無ければ settings/ temp/ fields/ records/ の設定などのファイルの名前（Desktop の AI はファイルの一覧を見る手段が無い）。名前だけ（中身は返さない）
 *   - pcraft_take: inbox/ のダウンロードを、名前のまま アプリのフォルダーへ移す（本番も新しい名前で足すことはできる。上書きしない）
 *   - pcraft_edit: アプリのフォルダーのダウンロード / pull を -edit.json に写す（ダウンロードは書き換えない。既にあればそのまま）
 *   - pcraft_diff: 2 つの設定の差（ボタン単位。data: の URL は短く）
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  FileExistsError,
  INBOX,
  InputError,
  SNAPSHOT_RE,
  WRITE_ROOTS,
  appFolderOfFile,
  assertChangeAllowed,
  diffSettings,
  editNameOf,
  findAppDir,
  listAppFolder,
  loadWorkspace,
  pickEnv,
  resolveApp,
  resolveRead,
  resolveWrite,
  takeInbox,
  writeNewFile
} from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok, type Finding } from "../result.ts";
import { incompatibleResult, workspaceIdSchema } from "./common.ts";
import { fromError, readSettingsFile, rel } from "./files.ts";
import { appSchema, envSchema } from "./kintone.ts";

/** 一覧の上限（AI に返す量） */
const MAX_LIST = 200;
/** 差の上限（AI に返す量） */
const MAX_DIFF_CHARS = 64 * 1024;

function namesUnder(root: string, dir: string, depth = 2): string[] {
  const abs = path.join(root, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  const walk = (d: string, left: number): void => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (e.name.startsWith(".")) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory() && left > 1) walk(p, left - 1);
      else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) out.push(rel(root, p));
      if (out.length > MAX_LIST) return;
    }
  };
  walk(resolveRead(dir, root), depth);
  return out;
}

const workspaceRequired = (what: string): InputError => new InputError(`${what} は作業フォルダーに environments.json があるときだけ使える（今の形では settings/ のファイルをそのまま使う）`);

export function registerWorkspaceFiles(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_files",
    {
      title: "印刷屋の作業フォルダーのファイルの一覧",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の作業フォルダーのファイルの名前の一覧（中身は返さない）。environments.json があれば app のアプリのフォルダー（ダウンロード / pull は新しい順で先頭が今の設定、-edit.json、新しい帳票、records、out）、" +
        "無ければ settings/ temp/ fields/ records/ の JSON と inbox/ の件数。読み取りだけ",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface), app: appSchema.optional(), env: envSchema }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const ws = loadWorkspace(root);
        if (!ws) {
          if (input.env !== undefined || input.app !== undefined) throw workspaceRequired("app / env");
          const list: Record<string, string[]> = {};
          for (const d of ["settings", "temp", "fields", "records"]) list[d] = namesUnder(root, d);
          const truncated = Object.values(list).some((l) => l.length > MAX_LIST);
          for (const d of Object.keys(list)) list[d] = list[d].slice(0, MAX_LIST);
          return ok({ workspace: root, environmentsJson: false, files: list, inbox: namesUnder(root, INBOX, 1).length }, truncated ? { findings: [{ level: "info", rule: "truncated", message: `一覧を ${MAX_LIST} 件で打ち切った` }] } : {});
        }
        if (input.app === undefined) throw new InputError("environments.json があるときは app（番号か apps の名前）が要る");
        const env = pickEnv(ws, input.env);
        const appId = typeof input.app === "number" ? input.app : resolveApp(ws, env, input.app).appId;
        const dir = findAppDir(root, env, appId);
        if (!dir) throw new InputError(`アプリ ${appId} のフォルダー（kintone/${env.host}/${appId}-…）が無い。先に pcraft_fields で項目定義を取る`);
        const l = listAppFolder(dir);
        return ok({
          workspace: root,
          environmentsJson: true,
          env: { name: env.name, role: env.role, host: env.host },
          folder: rel(root, dir),
          fields: l.hasFields,
          snapshots: l.snapshots,
          current: l.snapshots[0] ?? null,
          edits: l.edits,
          reports: l.reports,
          records: l.records,
          outs: l.outs,
          inbox: namesUnder(root, INBOX, 1).length
        });
      } catch (e) {
        return fromError(e);
      }
    }
  );

  server.registerTool(
    "pcraft_take",
    {
      title: "inbox のダウンロードをアプリのフォルダーへ",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の設定画面でダウンロードしたファイル（rex0220-print-craft-app<番号>-<日時>.json）を、利用者が置いた inbox/ から、名前のまま アプリのフォルダーへ移す（environments.json があるときだけ）。" +
        "上書きはしない。結果を推し量らず、返った moved / skipped をそのまま伝える",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface), env: envSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const ws = loadWorkspace(root);
        if (!ws) throw workspaceRequired("pcraft_take");
        if (input.env !== undefined) pickEnv(ws, input.env);
        const r = takeInbox(root, ws, input.env);
        const findings: Finding[] = [
          ...r.skipped.map((s) => ({ level: "warning", rule: "take.skipped", message: `${s.file}: ${s.reason}` })),
          ...r.warnings.map((w) => ({ level: "warning", rule: "take.warning", message: w }))
        ];
        return ok({ moved: r.moved, skipped: r.skipped, ...(r.moved.length || r.skipped.length ? {} : { note: `${INBOX}/ に設定のファイルが無い` }) }, { findings });
      } catch (e) {
        return fromError(e);
      }
    }
  );

  server.registerTool(
    "pcraft_edit",
    {
      title: "ダウンロードを -edit.json に写す",
      description:
        "印刷屋プラグイン（rex0220 Print craft）のアプリのフォルダーのダウンロード / pull のファイルを、直すための -edit.json に写す（ダウンロードのファイルは書き換えない。-edit.json が既にあればそのまま）。" +
        "path を省くと app の一番新しいダウンロード / pull（今の設定）。environments.json があるときだけ。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).optional().describe("ダウンロード / pull のファイル（作業フォルダーからの相対パス）"),
          app: appSchema.optional(),
          env: envSchema
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const ws = loadWorkspace(root);
        if (!ws) throw workspaceRequired("pcraft_edit");
        let src = input.path;
        if (!src) {
          if (input.app === undefined) throw new InputError("path か app が要る");
          const env = pickEnv(ws, input.env);
          const appId = typeof input.app === "number" ? input.app : resolveApp(ws, env, input.app).appId;
          const dir = findAppDir(root, env, appId);
          if (!dir) throw new InputError(`アプリ ${appId} のフォルダーが無い。先に pcraft_fields`);
          const l = listAppFolder(dir);
          if (!l.snapshots.length) throw new InputError(`${rel(root, dir)} にダウンロード / pull のファイルが無い（設定画面でダウンロードして inbox/ に置き pcraft_take、または pcraft_pull）`);
          src = rel(root, path.join(dir, l.snapshots[0]));
        }
        const f = readSettingsFile(root, src);
        if (!SNAPSHOT_RE.test(path.basename(f.file)) || !appFolderOfFile(root, f.file)) throw new InputError(`写すのはアプリのフォルダーのダウンロード / pull のファイル（rex0220-print-craft-app<番号>-<日時>.json）: ${f.relPath}`);
        const dest = resolveWrite(rel(root, editNameOf(f.file)), WRITE_ROOTS.kintone, root);
        if (existsSync(dest)) return ok({ path: rel(root, dest), from: f.relPath, existed: true, next: "既にある -edit.json を続けて直す（pcraft_buttons → pcraft_update_button）" });
        assertChangeAllowed(root, dest, "settings");
        try {
          writeNewFile(dest, f.text, () => {
            if (resolveWrite(rel(root, dest), WRITE_ROOTS.kintone, root) !== dest) throw new InputError("書く先のフォルダーが途中で変わった");
            assertChangeAllowed(root, dest, "settings");
          });
        } catch (e) {
          if (e instanceof FileExistsError) return ok({ path: rel(root, dest), from: f.relPath, existed: true, next: "既にある -edit.json を続けて直す" });
          throw e;
        }
        return ok({ path: rel(root, dest), from: f.relPath, existed: false, next: "直す: pcraft_buttons → pcraft_update_button。差は pcraft_diff" });
      } catch (e) {
        return fromError(e);
      }
    }
  );

  server.registerTool(
    "pcraft_diff",
    {
      title: "2 つの印刷屋の設定の差",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の 2 つの設定 JSON の差（ボタン単位。HTML / CSS / 計算式は行の差、更新項目、共通 CSS、Web フォント、ルートの値。data: の URL は短く）。" +
        "直した設定を取り込む前に利用者に見せる。derived: true で派生値の差も。読み取りだけ",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          before: z.string().min(1).max(512).describe("前の設定（作業フォルダーからの相対パス。ダウンロードなど）"),
          after: z.string().min(1).max(512).describe("後の設定（作業フォルダーからの相対パス。-edit.json など）"),
          derived: z.boolean().optional().describe("派生値（formula / usedFields / id / views / pluginUOG）の差も出す")
        })
        .strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const a = readSettingsFile(root, input.before);
        const b = readSettingsFile(root, input.after);
        let text = diffSettings(a.settings, b.settings, { derived: input.derived === true });
        const truncated = text.length > MAX_DIFF_CHARS;
        if (truncated) text = `${text.slice(0, MAX_DIFF_CHARS)}\n…（打ち切った）`;
        return ok({ before: a.relPath, after: b.relPath, text }, truncated ? { findings: [{ level: "info", rule: "truncated", message: "差を打ち切った" }] } : {});
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
