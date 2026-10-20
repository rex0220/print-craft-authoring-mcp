/**
 * 作業フォルダーのファイルの扱い（CLI の folderDefaults / fieldsFileOf / trustedBaseUrl / writeText と同じ決まりを、中核の関数で組む）。
 *   - 読むファイルは作業フォルダーの中だけ（resolveRead。.env・node_modules・.git は読まない）
 *   - 設定ファイルは印刷屋の封筒（pluginID）のものだけを読む（レコードのファイルなどを設定として読ませない）
 *   - アプリのフォルダー（kintone/<profile>/<番号>-…/）の中の設定は、同じフォルダーの fields.json と、その profile の接続先を使う（中核 2.0.0。実装案 15 章）
 *   - kintone/** の中のファイルは、profile の形で、接続のファイルにある profile、印が今の接続のこのアプリのものときだけ読む（15.5）
 *   - 書く直前に、書ける場所と、kintone/ の下なら操作 × 場所・印・接続の許可（接続のファイルを読み直す）を確かめ直す
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { WorkspaceError as BindingError } from "../binding.ts";
import {
  ButtonNotFoundError,
  ConnectionError,
  FileExistsError,
  InputError,
  KINTONE_ROOT,
  LockBusyError,
  MAX_INPUT_BYTES,
  PathError,
  PermissionError,
  QueryError,
  WorkspaceError as CoreWorkspaceError,
  appFolderOfFile,
  assertAppMark,
  assertChangeAllowed,
  assertUsableInKintone,
  connectionStatusOf,
  digestOf,
  findAppDir,
  isInside,
  pickProfile,
  profileDirOf,
  resolveRead,
  resolveWrite,
  EvalError,
  type ChangeOp,
  type ProfileDef,
  type WorkspaceMode
} from "../core.ts";
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

/** 動く形を、要るときだけ作る（kintone/** の中のファイルを読むときだけ接続のファイルを読む） */
export type ModeSource = WorkspaceMode | (() => WorkspaceMode);
const modeOfSource = (m: ModeSource): WorkspaceMode => (typeof m === "function" ? m() : m);

const inKintone = (root: string, file: string): boolean => isInside(path.resolve(root, file), path.join(root, KINTONE_ROOT));

/** kintone/** の中のファイルなら、読む前に確かめる（profile の形、接続のファイルにある profile、印。中核の assertUsableInKintone。15.5） */
export function assertReadable(root: string, file: string, mode: ModeSource): void {
  if (inKintone(root, file)) assertUsableInKintone(root, file, modeOfSource(mode));
}

/**
 * profile のアプリのフォルダー（kintone/<profile>/<番号>-…）。無ければ null。kintone/ と profile のフォルダーの実体は中核の findAppDir が確かめ、
 * 印が今の接続のこのアプリのものでなければ ConnectionError（conflict）。records / out の実体は一覧のとき（listAppFolder に root を渡す）に確かめる
 */
export function appDirIn(root: string, def: ProfileDef, appId: number): string | null {
  const dir = findAppDir(root, def.profile, appId);
  if (!dir) return null;
  assertAppMark(dir, def, appId);
  return insideDir(root, dir);
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

/**
 * JSON.parse の誤りの位置（行と列）だけ。誤りの文そのものは返さない（Node 20 から読んだファイルの中身の一部が入る。
 * 各 JSON の読み込みの境で決まった文にする。Codex の B1 3 回目 MINOR 2）
 */
export function jsonErrorWhere(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const m = /in JSON at position (\d+)(?: \(line (\d+) column (\d+)\))?/.exec(msg);
  if (m) return m[2] ? `（${m[2]} 行 ${m[3]} 列）` : `（位置 ${m[1]}）`;
  // 中核（tools 2.0.0）の readJsonLimited は、生の誤りの文でなく位置だけを同じ形で入れる
  const c = /（(\d+) 行 (\d+) 列）|（位置 (\d+)）/.exec(msg);
  if (c) return c[1] ? `（${c[1]} 行 ${c[2]} 列）` : `（位置 ${c[3]}）`;
  return "";
}

/** JSON のファイルを中核で読む関数を呼び、JSON として読めないときの文を決まった文に（what は「レコードのファイル」など） */
export async function withJsonError<T>(root: string, file: string, what: string, read: () => T | Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (e) {
    if (e instanceof InputError && /を JSON として読めない/.test(e.message)) throw new InputError(`${what}を JSON として読めない: ${rel(root, file)}${jsonErrorWhere(e)}（中身は返さない）`);
    throw e;
  }
}

/** 設定ファイルを 1 回だけ読み、同じ中身から JSON と digest を作る（読み直すと、その間に変わったときにずれる）。kintone/** の中なら先に確かめる */
export function readSettingsFile(root: string, p: string, mode: ModeSource): SettingsFile {
  const file = resolveRead(p, root);
  if (!existsSync(file)) throw new InputError(`ファイルが無い: ${rel(root, file)}`);
  assertReadable(root, file, mode);
  const bytes = readFileSync(file);
  if (bytes.length > MAX_INPUT_BYTES) throw new InputError(`${rel(root, file)} が大きすぎる（${bytes.length.toLocaleString()} バイト。上限 ${MAX_INPUT_BYTES.toLocaleString()}）`);
  const text = bytes.toString("utf8");
  let settings: unknown;
  try {
    settings = JSON.parse(text);
  } catch (e) {
    throw new InputError(`${rel(root, file)} を JSON として読めない${jsonErrorWhere(e)}（中身は返さない）`);
  }
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) throw new InputError(`${rel(root, file)} の最上位はオブジェクト`);
  if ((settings as Record<string, unknown>).pluginID !== SETTINGS_PLUGIN_ID) throw new InputError(`${rel(root, file)} は印刷屋の設定のファイルではない（封筒の pluginID が "${SETTINGS_PLUGIN_ID}" でない）`);
  return { file, relPath: rel(root, file), bytes, text, settings: settings as Record<string, unknown>, digest: digestOf(bytes) };
}

/** アプリのフォルダーの中の設定か（場所で決める。保存の中核と同じ）。返り値は { dir, profile, appId } */
export function folderOf(root: string, file: string) {
  return appFolderOfFile(root, file);
}

/**
 * 項目定義のファイル。アプリのフォルダーの中の設定は、いつも同じフォルダーの fields.json（fields はそれと同じときだけ。別のアプリ・profile・settings/ の
 * 項目定義で検査しない。保存の中核と同じく denied。Codex の実装レビュー MAJOR 3）。ほかは引数の fields が要る。kintone/** の中なら先に確かめる
 */
export function fieldsFileFor(root: string, file: string, fields: string | undefined, mode: ModeSource): string {
  const folder = folderOf(root, file);
  if (folder) {
    const own = path.join(folder.dir, "fields.json");
    if (!existsSync(own)) throw new InputError(`アプリのフォルダーに fields.json が無い: ${rel(root, own)}（pcraft_fields か fields コマンドで取る）`);
    const f = resolveRead(own, root);
    if (fields !== undefined && resolveRead(fields, root) !== f) throw new PermissionError(`アプリのフォルダーの中の設定は、同じフォルダーの fields.json で検査する（fields は渡さないか、${rel(root, f)} にする）`);
    assertReadable(root, f, mode);
    return f;
  }
  if (!fields) throw new InputError("fields（項目定義のファイル）が要る（アプリのフォルダー kintone/<profile>/<番号>-…/ の中の設定なら同じフォルダーの fields.json を使う）");
  const f = resolveRead(fields, root);
  if (!existsSync(f)) throw new InputError(`項目定義のファイルが無い: ${rel(root, f)}（pcraft_fields か fields コマンドで取る）`);
  assertReadable(root, f, mode);
  return f;
}

/** iframe の同一オリジンの判定に使う接続先（15.8）。origin が null なら iframe を使わない（reason に理由） */
export interface TrustedOrigin {
  baseUrl?: string;
  origin: string | null;
  reason?: string;
}

/**
 * iframe の同一オリジンの判定に使う接続先（フォルダー名は AI が作れるので、フォルダー名そのものは信用しない。接続のファイルの profile の baseUrl）。
 * アプリのフォルダーのファイルはその profile（引数の profile と違えば InputError）、ほかは引数の profile、無ければ 15.2 の選び方。決まらなければ iframe を使わない
 */
export function trustedOrigin(mode: WorkspaceMode, root: string, file: string, profile: string | undefined): TrustedOrigin {
  const folder = folderOf(root, file);
  if (folder && profile !== undefined && profile !== folder.profile) throw new InputError(`profile「${profile}」とファイルのフォルダーの profile（${folder.profile}）が違う`);
  if (mode.kind !== "profiles") return { origin: null, reason: mode.kind === "legacy-blocked" ? "environments.json が残っている（接続のファイルに移す）" : "kintone の接続のファイルが設定されていない" };
  const set = mode.connections.set;
  if (folder) {
    const def = set.profiles.get(folder.profile);
    return def ? { baseUrl: def.baseUrl, origin: def.host } : { origin: null, reason: `profile「${folder.profile}」は接続のファイルに無い` };
  }
  try {
    const def = pickProfile(set, profile);
    return { baseUrl: def.baseUrl, origin: def.host };
  } catch (e) {
    if (e instanceof ConnectionError && profile === undefined) return { origin: null, reason: "既定の profile が決まらない（profile を付けると iframe を使える）" };
    throw e;
  }
}

/** 応答に足す iframe の接続先（ホストか null と、null の理由。15.8） */
export function originFields(t: TrustedOrigin): Record<string, unknown> {
  return { trustedOrigin: t.origin, ...(t.reason ? { trustedOriginReason: t.reason } : {}) };
}

/** アプリのフォルダーのファイルなら、そのフォルダーの out/。それ以外は作業フォルダーの out/ */
export function previewDirFor(root: string, file: string): string {
  const folder = folderOf(root, file);
  return folder ? path.join(folder.dir, "out") : path.join(root, "out");
}

/** 書ける場所と許可を確かめる（書かない）。書く先の実際のパスを返す */
export function checkWritable(root: string, target: string, roots: readonly string[], op: ChangeOp, mode: WorkspaceMode): string {
  const real = resolveWrite(rel(root, target), roots, root);
  assertChangeAllowed(root, real, op, mode);
  return real;
}

/**
 * kintone に送る前に、保存先（アプリのフォルダー。無ければ作る場所）に書けるかを確かめる（送ってから断らない。Codex の B1 レビュー BLOCKER 1）。
 * 今あるフォルダーは印も確かめる。返り値は今あるフォルダー（無ければ null。作るのは取った後で、名前はアプリ名で決まる）
 */
export function precheckAppWrite(root: string, def: ProfileDef, appId: number, name: string, op: ChangeOp, mode: WorkspaceMode): string | null {
  const existing = appDirIn(root, def, appId);
  checkWritable(root, path.join(existing ?? path.join(profileDirOf(root, def.profile), String(appId)), name), [KINTONE_ROOT], op, mode);
  return existing;
}

/** 書く直前に、書ける場所と許可を確かめ直してから書く（CLI の writeText と同じ。書く先のパスが途中で変われば書かない） */
export function writeChecked(root: string, target: string, text: string, roots: readonly string[], op: ChangeOp, mode: WorkspaceMode): string {
  const real = checkWritable(root, target, roots, op, mode);
  mkdirSync(path.dirname(real), { recursive: true });
  if (resolveWrite(rel(root, real), roots, root) !== real) throw new PermissionError(`書く先のフォルダーが途中で変わった（symlink など）: ${rel(root, real)}`);
  assertChangeAllowed(root, real, op, mode);
  writeFileSync(real, text, "utf8");
  return real;
}

/**
 * 書く（お試しアプリの out/try/。0.3.0。print-craft の docs/authoring-try-plan.md 4.2、Codex r2 M4）: 同じフォルダーの一時ファイルに書き、書く先を検査し直してから
 * rename で置き換える（別の MCP のプロセスや CLI と同時でも、最後の 1 つが壊れていない HTML として残る）
 */
export function writeAtomicChecked(root: string, target: string, text: string, roots: readonly string[], op: ChangeOp, mode: WorkspaceMode): string {
  const real = checkWritable(root, target, roots, op, mode);
  mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.${process.pid}.${Date.now().toString(36)}.tmp`;
  writeFileSync(tmp, text, "utf8");
  try {
    if (resolveWrite(rel(root, real), roots, root) !== real) throw new PermissionError(`書く先のフォルダーが途中で変わった（symlink など）: ${rel(root, real)}`);
    assertChangeAllowed(root, real, op, mode);
    renameSync(tmp, real);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return real;
}

/** 前の結果のファイルを消す（お試しアプリで描けなかった対象。書く先と同じ検査）。消したら true */
export function removeChecked(root: string, target: string, roots: readonly string[], op: ChangeOp, mode: WorkspaceMode): boolean {
  const real = checkWritable(root, target, roots, op, mode);
  if (!existsSync(real)) return false;
  assertChangeAllowed(root, real, op, mode);
  rmSync(real, { force: true });
  return true;
}

/** 中核の誤りを応答に分ける（5.2）。分からない誤りは failed */
export function fromError(e: unknown): ToolResult {
  const message = e instanceof Error ? e.message : String(e);
  if (e instanceof BindingError) return failure("denied", "WorkspaceError", message);
  // kintone の接続のファイル・アプリのフォルダーの印の誤り（15.10 の表）
  if (e instanceof ConnectionError) return failure(connectionStatusOf(e), e.code, message);
  // 作業フォルダーの形の食い違い（同じ番号のアプリのフォルダーが 2 つ。利用者が 1 つにする）。呼び出しの引数の誤りではない
  if (e instanceof CoreWorkspaceError) return failure("conflict", "WorkspaceError", message);
  if (e instanceof PathError) return failure("denied", "PathError", message);
  if (e instanceof PermissionError) return failure("denied", "PermissionError", message);
  if (e instanceof FileExistsError || e instanceof LockBusyError) return failure("conflict", "ConflictError", message);
  if (e instanceof ButtonNotFoundError) return failure("invalid", "ButtonNotFoundError", message);
  if (e instanceof QueryError) return failure("invalid", "QueryError", message);
  if (e instanceof InputError || e instanceof SyntaxError) return failure("invalid", "InputError", message);
  // 評価の子プロセスの誤り（0.3.0）: 入力の誤りは invalid。zip は決まった文（子プロセスの文は zip のパスを含みうる）。other の文は中核が決まった文にしている
  if (e instanceof EvalError) {
    if (e.kind === "input") return failure("invalid", "InputError", message);
    if (e.kind === "zip") return failure("failed", "PluginZipError", "評価の子プロセスで印刷屋の zip を読めない（zip を置き換えたら /mcp で再接続。Desktop は再起動）");
    return failure("failed", e.kind === "other" ? "EvalError" : e.innerName, message);
  }
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
