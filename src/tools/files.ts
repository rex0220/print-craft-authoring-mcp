/**
 * 作業フォルダーのファイルの扱い（CLI の folderDefaults / fieldsFileOf / trustedBaseUrl / writeText と同じ決まりを、中核の関数で組む）。
 *   - 読むファイルは作業フォルダーの中だけ（resolveRead。.env・node_modules・.git は読まない）
 *   - 設定ファイルは印刷屋の封筒（pluginID）のものだけを読む（レコードのファイルなどを設定として読ませない）
 *   - アプリのフォルダー（kintone/<ホスト名>/<番号>-…/）の中の設定は、同じフォルダーの fields.json と、その環境の接続先を使う
 *   - 書く直前に、書ける場所と、kintone/ の下なら操作 × 場所の許可（environments.json を読み直す）を確かめ直す
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorkspaceError as BindingError } from "../binding.ts";
import {
  ButtonNotFoundError,
  FileExistsError,
  InputError,
  LockBusyError,
  MAX_INPUT_BYTES,
  PathError,
  PermissionError,
  QueryError,
  WorkspaceError as CoreWorkspaceError,
  appFolderOfFile,
  assertChangeAllowed,
  baseUrlFromEnv,
  digestOf,
  envOfAppFolder,
  findAppDir,
  loadWorkspace,
  resolveRead,
  resolveWrite,
  roleOfTarget,
  type ChangeOp,
  type EnvironmentDef
} from "../core.ts";
import type { ServerContext } from "../context.ts";
import { failure, type ToolResult } from "../result.ts";

/** 印刷屋の設定の封筒の pluginID（印刷屋の PLUGIN_ID_NAME。中核の take.ts と同じ値） */
export const SETTINGS_PLUGIN_ID = "rex0220 Print craft plugin";

export const rel = (root: string, abs: string): string => path.relative(root, abs).replace(/\\/g, "/");

/**
 * ツールの引数のパスは作業フォルダーからの相対パスだけ（実装案 5.1「..・絶対パス・ドライブ名・cwd を受け付けない」）。
 * 中核の resolveRead / resolveWrite は作業フォルダーの中を指す絶対パスや settings/../x.json も受け付けるので、入口で断る（Codex の B1 レビュー MAJOR 4）。
 * \\ も断る（Windows では区切り。区切りは / にそろえる）
 */
export function checkRelPath(p: string, what = "パス"): void {
  if (p.includes("\0")) throw new PathError(`${what}に使えない文字がある`);
  if (path.isAbsolute(p) || path.win32.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith("~")) throw new PathError(`${what}は作業フォルダーからの相対パスで書く（絶対パス・ドライブ名・~ は使わない）: ${p}`);
  if (p.includes("\\")) throw new PathError(`${what}の区切りは / にする（\\ は使わない）: ${p}`);
  if (p.split("/").some((seg) => seg === "..")) throw new PathError(`${what}に .. は使わない: ${p}`);
  if (p.split("/").some((seg) => seg === "" || seg === ".")) throw new InputError(`${what}はファイルの相対パスで書く（例 settings/a.json。先頭の ./、末尾の /、// は使わない）: ${p}`);
}

/** ツールの引数のパスをまとめて確かめる（undefined は飛ばす） */
export function checkRelPaths(paths: Record<string, string | undefined>): void {
  for (const [what, p] of Object.entries(paths)) if (p !== undefined) checkRelPath(p, what);
}

/** フォルダーの実体が作業フォルダーの中か（symlink で外を指していれば PathError）。一覧を作る前に確かめる（Codex の B1 レビュー BLOCKER 1） */
export function insideDir(root: string, dir: string): string {
  return resolveRead(rel(root, dir), root);
}

/** kintone/ と kintone/<ホスト名> の実体が作業フォルダーの中か（中核の findAppDir / appDirFor がその中を一覧する前に。無ければ何もしない） */
export function checkHostDir(root: string, env: EnvironmentDef): void {
  for (const d of [path.join(root, "kintone"), path.join(root, "kintone", env.host)]) if (existsSync(d)) insideDir(root, d);
}

/** アプリのフォルダー（kintone/<ホスト名>/<番号>-…）。ホストのフォルダーとアプリのフォルダーの実体が作業フォルダーの中のときだけ返す */
export function appDirIn(root: string, env: EnvironmentDef, appId: number): string | null {
  const hostDir = path.join(root, "kintone", env.host);
  if (!existsSync(hostDir)) return null;
  checkHostDir(root, env);
  const dir = findAppDir(root, env, appId);
  if (!dir) return null;
  const real = insideDir(root, dir);
  for (const sub of ["records", "out"]) if (existsSync(path.join(real, sub))) insideDir(root, path.join(real, sub));
  return real;
}

export interface SettingsFile {
  /** 実際のパス */
  file: string;
  /** 作業フォルダーからの相対（区切りは /） */
  relPath: string;
  bytes: Buffer;
  text: string;
  settings: Record<string, unknown>;
  /** ファイルのバイト列の sha256（pcraft_update_button の expectedDigest に渡す） */
  digest: string;
}

/** 設定ファイルを 1 回だけ読み、同じ中身から JSON と digest を作る（読み直すと、その間に変わったときにずれる） */
export function readSettingsFile(root: string, p: string): SettingsFile {
  const file = resolveRead(p, root);
  if (!existsSync(file)) throw new InputError(`ファイルが無い: ${rel(root, file)}`);
  const bytes = readFileSync(file);
  if (bytes.length > MAX_INPUT_BYTES) throw new InputError(`${rel(root, file)} が大きすぎる（${bytes.length.toLocaleString()} バイト。上限 ${MAX_INPUT_BYTES.toLocaleString()}）`);
  const text = bytes.toString("utf8");
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch (e) {
    throw new InputError(`${rel(root, file)} を JSON として読めない: ${(e as Error).message}`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new InputError(`${rel(root, file)} の最上位はオブジェクト`);
  if ((settings as Record<string, unknown>).pluginID !== SETTINGS_PLUGIN_ID) throw new InputError(`${rel(root, file)} は印刷屋の設定のファイルではない（封筒の pluginID が "${SETTINGS_PLUGIN_ID}" でない）`);
  return { file, relPath: rel(root, file), bytes, text, settings: settings as Record<string, unknown>, digest: digestOf(bytes) };
}

/** アプリのフォルダーの中の設定か（environments.json の有無に関わらず、場所で決める。保存の中核と同じ） */
export function folderOf(root: string, file: string) {
  return appFolderOfFile(root, file);
}

/** 項目定義のファイル: 引数の fields、無ければアプリのフォルダーの fields.json */
export function fieldsFileFor(root: string, file: string, fields: string | undefined): string {
  if (fields) {
    const f = resolveRead(fields, root);
    if (!existsSync(f)) throw new InputError(`項目定義のファイルが無い: ${rel(root, f)}（pcraft_fields か fields コマンドで取る）`);
    return f;
  }
  const folder = folderOf(root, file);
  if (!folder) throw new InputError("fields（項目定義のファイル）が要る（アプリのフォルダー kintone/<ホスト名>/<番号>-…/ の中の設定なら同じフォルダーの fields.json を使う）");
  const own = path.join(folder.dir, "fields.json");
  if (!existsSync(own)) throw new InputError(`アプリのフォルダーに fields.json が無い: ${rel(root, own)}（pcraft_fields か fields コマンドで取る）`);
  return resolveRead(own, root);
}

/**
 * iframe の同一オリジンの判定に使う接続先。アプリのフォルダーの中の設定なら environments.json のその環境の baseUrl
 * （フォルダー名は AI が作れるので、フォルダー名そのものは信用しない）、それ以外は設定項目か作業フォルダーの .env
 */
export function trustedBaseUrl(ctx: ServerContext, root: string, file: string): string | undefined {
  try {
    const folder = folderOf(root, file);
    const ws = loadWorkspace(root);
    if (ws && folder) return envOfAppFolder(ws, folder.host, folder.appId)?.baseUrl;
    return baseUrlFromEnv({ cwd: root, env: ctx.env });
  } catch {
    return undefined; // 接続先は preview の iframe の判定にだけ使う。読めなければ使わない
  }
}

/** 開発の環境のアプリのフォルダーなら、そのフォルダーの out/。それ以外（本番・未分類・アプリのフォルダーの外）は作業フォルダーの out/（4.2 の P9） */
export function previewDirFor(root: string, file: string): string {
  const folder = folderOf(root, file);
  if (folder && roleOfTarget(root, path.join(folder.dir, "out", "x.html"))?.role === "development") return path.join(folder.dir, "out");
  return path.join(root, "out");
}

/** 書く直前に、書ける場所と許可を確かめ直してから書く（CLI の writeText と同じ。書く先のパスが途中で変われば書かない） */
export function writeChecked(root: string, target: string, text: string, roots: readonly string[], op: ChangeOp): string {
  const real = resolveWrite(rel(root, target), roots, root);
  assertChangeAllowed(root, real, op);
  mkdirSync(path.dirname(real), { recursive: true });
  if (resolveWrite(rel(root, real), roots, root) !== real) throw new PermissionError(`書く先のフォルダーが途中で変わった（symlink など）: ${rel(root, real)}`);
  assertChangeAllowed(root, real, op);
  writeFileSync(real, text, "utf8");
  return real;
}

/** 中核の誤りを応答に分ける（5.2）。分からない誤りは failed */
export function fromError(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof BindingError) return failure("denied", "WorkspaceError", message);
  // environments.json の誤り・知らない環境の名前・apps に無いアプリの名前は入力の誤り（Codex の B1 レビュー MINOR 1）
  if (e instanceof CoreWorkspaceError) return failure("invalid", "WorkspaceError", message);
  if (e instanceof PathError) return failure("denied", "PathError", message);
  if (e instanceof PermissionError) return failure("denied", "PermissionError", message);
  if (e instanceof FileExistsError || e instanceof LockBusyError) return failure("conflict", "ConflictError", message);
  if (e instanceof ButtonNotFoundError) return failure("invalid", "ButtonNotFoundError", message);
  if (e instanceof QueryError) return failure("invalid", "QueryError", message);
  if (e instanceof InputError || e instanceof SyntaxError) return failure("invalid", "InputError", message);
  const err = e instanceof Error ? e : new Error(message);
  return failure("failed", err.name && err.name !== "Error" ? err.name : err.constructor?.name ?? "Error", message);
}

const shortHash = (v: unknown): string => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 8);
const csvCount = (v: unknown): number => (typeof v === "string" ? v.split(",").map((x) => x.trim()).filter(Boolean).length : 0);

/**
 * AI に返す前に、設定の中の個人を指す値を伏せる（ボタンの権限のユーザー・組織・グループ・ゲストの CSV、ルートの guestsInfo）。
 * 件数と短い digest にする（変わったかは分かるように。pcraft_diff）。設定ファイルそのものは変えない（Codex の B1 レビュー MAJOR 1）
 */
export function redactPersonal(settings: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...settings };
  if (Array.isArray(settings.pluginInfos)) {
    out.pluginInfos = (settings.pluginInfos as Array<Record<string, unknown>>).map((row) => {
      if (!row || typeof row !== "object") return row;
      const r: Record<string, unknown> = { ...row };
      for (const [k, label] of [["users", "ユーザー"], ["organizations", "組織"], ["groups", "グループ"], ["guest", "ゲスト"]] as const) {
        if (typeof r[k] === "string" && r[k]) r[k] = `（${label} ${csvCount(r[k])} 件。値は出さない #${shortHash(r[k])}）`;
      }
      return r;
    });
  }
  if (Array.isArray(settings.guestsInfo)) {
    out.guestsInfo = (settings.guestsInfo as unknown[]).map((g) => `（ゲスト。値は出さない #${shortHash(g)}）`);
  }
  return out;
}
