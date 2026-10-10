/**
 * 作業フォルダーのファイルを扱うツール（実装案 5.1 の最後の行、15.8。今の CLI の files / take / edit / diff）。
 *   - pcraft_files: app を付ければ profile のそのアプリのフォルダーの一覧（ダウンロード / pull は新しい順、-edit.json、新しい帳票、records、out）。
 *     無ければ profile ごとのアプリのフォルダーの名前と印の状態、使われていない profile のフォルダーの名前、settings/ temp/ fields/ records/ の JSON の名前、inbox/ の件数
 *     （Desktop の AI はファイルの一覧を見る手段が無い）。名前だけ（中身は返さない。印の合わないフォルダーの中は一覧しない。15.5）
 *   - pcraft_take: inbox/ のダウンロードを、名前のまま profile のアプリのフォルダーへ移す（上書きしない）
 *   - pcraft_edit: アプリのフォルダーのダウンロード / pull を -edit.json に写す（ダウンロードは書き換えない。既にあればそのまま）
 *   - pcraft_diff: 2 つの設定の差（ボタン単位。data: の URL は短く）
 * アプリのフォルダー（kintone/**）を使うのは、kintone の接続のファイルがあるときだけ（profile の形。15.4）
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
  appFoldersOf,
  assertChangeAllowed,
  diffSettings,
  editNameOf,
  listAppFolder,
  pickProfile,
  requireProfiles,
  resolveRead,
  resolveWrite,
  takeInbox,
  unusedProfileDirs,
  writeNewFile,
  type WorkspaceMode
} from "../core.ts";
import type { ServerContext } from "../context.ts";
import { ok, sanitizeMessage, type Finding } from "../result.ts";
import { incompatibleResult, lazyMode, workspaceIdSchema } from "./common.ts";
import { appDirIn, checkRelPaths, fromError, insideDir, readSettingsFile, redactPersonal, rel } from "./files.ts";
import { appSchema, profileSchema } from "./kintone.ts";

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

/** 作業フォルダーの直下の、アプリのフォルダーの外のファイル（settings/ など。どの形でも使える） */
function localFiles(root: string): { files: Record<string, string[]>; truncated: boolean } {
  const files: Record<string, string[]> = {};
  for (const d of ["settings", "temp", "fields", "records"]) files[d] = namesUnder(root, d);
  const truncated = Object.values(files).some((l) => l.length > MAX_LIST);
  for (const d of Object.keys(files)) files[d] = files[d].slice(0, MAX_LIST);
  return { files, truncated };
}

/** profile ごとのアプリのフォルダーの名前と印の状態（中は一覧しない）と、使われていない profile のフォルダー（使えない profile か、接続のファイルに無い profile） */
function profileFolders(root: string, mode: Extract<WorkspaceMode, { kind: "profiles" }>, only: string | undefined) {
  const set = mode.connections.set;
  const defs = only !== undefined ? [pickProfile(set, only)] : [...set.profiles.values()];
  const profiles = defs.map((def) => ({
    name: def.profile,
    host: def.host,
    ...(def.guestSpaceId ? { guestSpaceId: def.guestSpaceId } : {}),
    folders: appFoldersOf(root, def).slice(0, MAX_LIST)
  }));
  const invalid = new Set(set.invalid.map((p) => p.name));
  const unused = only !== undefined ? [] : unusedProfileDirs(root, set).map((name) => ({ name, reason: invalid.has(name) ? "profile-invalid" : "unknown-profile" }));
  return { profiles, unused };
}

export function registerWorkspaceFiles(server: McpServer, ctx: ServerContext): void {
  server.registerTool(
    "pcraft_files",
    {
      title: "印刷屋の作業フォルダーのファイルの一覧",
      description:
        "印刷屋プラグイン（rex0220 Print craft）の作業フォルダーのファイルの名前の一覧（中身は返さない）。app を付けると、kintone の接続のファイルの profile のそのアプリのフォルダー（ダウンロード / pull は新しい順で先頭が今の設定、-edit.json、新しい帳票、records、out）。" +
        "省くと、profile ごとのアプリのフォルダーの名前と状態、settings/ temp/ fields/ records/ の JSON、inbox/ の件数。読み取りだけ",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface), app: appSchema.optional(), profile: profileSchema }).strict(),
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const mode = ctx.mode(root);
        if (input.app !== undefined) {
          const set = requireProfiles(mode, "pcraft_files の app").set;
          const def = pickProfile(set, input.profile);
          const dir = appDirIn(root, def, input.app);
          if (!dir) throw new InputError(`アプリ ${input.app} のフォルダー（kintone/${def.profile}/${input.app}-…）が無い。先に pcraft_fields（か pcraft_pull）でアプリのフォルダーを作る`);
          const l = listAppFolder(dir, root);
          return ok({
            workspace: { name: path.basename(root) },
            profile: { name: def.profile, host: def.host, ...(def.guestSpaceId ? { guestSpaceId: def.guestSpaceId } : {}) },
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
        }
        if (input.profile !== undefined) requireProfiles(mode, "pcraft_files の profile");
        const local = localFiles(root);
        const folders = mode.kind === "profiles" ? profileFolders(root, mode, input.profile) : undefined;
        return ok(
          {
            workspace: { name: path.basename(root) },
            mode: mode.kind,
            ...(folders ? { profiles: folders.profiles, ...(folders.unused.length ? { unusedFolders: folders.unused } : {}) } : {}),
            files: local.files,
            inbox: namesUnder(root, INBOX, 1).length,
            ...(mode.kind === "profiles" ? {} : { note: "kintone の接続のファイルが無いので、アプリのフォルダー（kintone/）は使わない。診断は pcraft_workspace_status" })
          },
          local.truncated ? { findings: [{ level: "info", rule: "truncated", message: `一覧を ${MAX_LIST} 件で打ち切った` }] } : {}
        );
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
        "印刷屋プラグイン（rex0220 Print craft）の設定画面でダウンロードしたファイル（rex0220-print-craft-app<番号>-<日時>.json）を、利用者が置いた inbox/ から、名前のまま アプリのフォルダー（kintone/<profile>/<番号>-…/）へ移す。" +
        "profile は引数、無ければ接続のファイルの defaultProfile、無ければ dev（ダウンロードにはドメインが無いので推し量らない）。上書きはしない。結果を推し量らず、返った moved / skipped をそのまま伝える",
      inputSchema: z.object({ workspaceId: workspaceIdSchema(ctx.surface), profile: profileSchema }).strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        // inbox の実体が作業フォルダーの中か（symlink で外を指していれば、一覧を作る前に断る。Codex の B1 レビュー BLOCKER 1）。kintone/ と profile のフォルダーは中核が確かめる
        if (existsSync(path.join(root, INBOX))) insideDir(root, path.join(root, INBOX));
        // 印の合わないフォルダー・接続の変化は中核が ConnectionError で止める（conflict。fromError）。理由の文は中核が決まった文にする。ここでも念のため除く（Codex の実装レビュー BLOCKER 1）
        const r = takeInbox(root, ctx.mode(root), input.profile);
        const skipped = r.skipped.map((s) => ({ file: s.file, reason: sanitizeMessage(s.reason) }));
        const warnings = r.warnings.map(sanitizeMessage);
        const findings: Finding[] = [
          ...skipped.map((s) => ({ level: "warning", rule: "take.skipped", message: `${s.file}: ${s.reason}` })),
          ...warnings.map((w) => ({ level: "warning", rule: "take.warning", message: w }))
        ];
        return ok({ moved: r.moved, skipped, ...(r.moved.length || skipped.length ? {} : { note: `${INBOX}/ に設定のファイルが無い` }) }, { findings });
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
        "path を省くと app の一番新しいダウンロード / pull（今の設定）。kintone の接続のファイルがあるときだけ。結果を推し量らず、このツールで確かめる",
      inputSchema: z
        .object({
          workspaceId: workspaceIdSchema(ctx.surface),
          path: z.string().min(1).max(512).optional().describe("ダウンロード / pull のファイル（作業フォルダーからの相対パス）"),
          app: appSchema.optional(),
          profile: profileSchema
        })
        .strict(),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async (input) => {
      try {
        checkRelPaths({ path: input.path });
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        const mode = ctx.mode(root);
        const set = requireProfiles(mode, "pcraft_edit").set;
        let src = input.path;
        if (!src) {
          if (input.app === undefined) throw new InputError("path か app が要る");
          const def = pickProfile(set, input.profile);
          const dir = appDirIn(root, def, input.app);
          if (!dir) throw new InputError(`アプリ ${input.app} のフォルダー（kintone/${def.profile}/${input.app}-…）が無い。先に pcraft_fields（か pcraft_pull）`);
          const l = listAppFolder(dir, root);
          if (!l.snapshots.length) throw new InputError(`${rel(root, dir)} にダウンロード / pull のファイルが無い（設定画面でダウンロードして inbox/ に置き pcraft_take、または pcraft_pull）`);
          src = rel(root, path.join(dir, l.snapshots[0]));
        }
        const folder = appFolderOfFile(root, path.resolve(root, src));
        if (!SNAPSHOT_RE.test(path.basename(src)) || !folder) throw new InputError(`写すのはアプリのフォルダーのダウンロード / pull のファイル（rex0220-print-craft-app<番号>-<日時>.json）: ${src}`);
        if (input.profile !== undefined && input.profile !== folder.profile) throw new InputError(`profile「${input.profile}」とファイルのフォルダーの profile（${folder.profile}）が違う`);
        const f = readSettingsFile(root, src, mode);
        const dest = resolveWrite(rel(root, editNameOf(f.file)), WRITE_ROOTS.kintone, root);
        if (existsSync(dest)) return ok({ path: rel(root, dest), from: f.relPath, existed: true, next: "既にある -edit.json を続けて直す（pcraft_buttons → pcraft_update_button）" });
        assertChangeAllowed(root, dest, "settings", mode);
        try {
          writeNewFile(dest, f.text, () => {
            if (resolveWrite(rel(root, dest), WRITE_ROOTS.kintone, root) !== dest) throw new InputError("書く先のフォルダーが途中で変わった");
            assertChangeAllowed(root, dest, "settings", mode);
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
        checkRelPaths({ before: input.before, after: input.after });
        const root = ctx.binding.resolve(input.workspaceId);
        const incompatible = incompatibleResult();
        if (incompatible) return incompatible;
        // 接続のファイルは kintone/** の中のファイルのときだけ読む（15.9 の表）
        const mode = lazyMode(ctx, root);
        const a = readSettingsFile(root, input.before, mode);
        const b = readSettingsFile(root, input.after, mode);
        // 権限のユーザー・組織・グループ・ゲストの値は伏せる（件数と digest。変わったかは分かる。Codex の B1 レビュー MAJOR 1）
        let text = diffSettings(redactPersonal(a.settings), redactPersonal(b.settings), { derived: input.derived === true });
        const truncated = text.length > MAX_DIFF_CHARS;
        if (truncated) text = `${text.slice(0, MAX_DIFF_CHARS)}\n…（打ち切った）`;
        return ok({ before: a.relPath, after: b.relPath, text }, truncated ? { findings: [{ level: "info", rule: "truncated", message: "差を打ち切った" }] } : {});
      } catch (e) {
        return fromError(e);
      }
    }
  );
}
