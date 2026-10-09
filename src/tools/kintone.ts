/**
 * kintone への接続（GET だけ。中核の createRestClient: 許可した API だけ、送信先は接続先だけ、受け取る量に上限）。
 *   - environments.json が無いとき: 設定項目（環境変数 KINTONE_*）か作業フォルダーの .env（今の CLI と同じ。loadAuth）
 *   - environments.json があるとき: その環境の envFile だけ（OS の環境変数・設定項目は読まない。開発と本番の取り違えを防ぐ。実装案 6.4）
 *   - アプリは番号、environments.json があれば apps の名前も。Desktop のツールはアプリの URL も（オリジンが接続先と同じときだけ。5.4）
 * 秘密の値は応答に入れない（中核の誤りの文も、HTTP の状態と kintone のエラーコードと決まったヒントだけ）
 */
import { z } from "zod";
import { InputError, createRestClient, describeAuth, loadAuth, loadAuthForEnv, loadWorkspace, pickEnv, resolveApp, type EnvironmentDef, type RestClient, type Workspace } from "../core.ts";
import type { ServerContext } from "../context.ts";

export interface KintoneTarget {
  client: RestClient;
  authLabel: string;
  ws: Workspace | null;
  env?: EnvironmentDef;
}

/** 接続先と認証を決める（environments.json があればその環境の envFile だけ） */
export function kintoneFor(ctx: ServerContext, root: string, envName: string | undefined): KintoneTarget {
  const ws = loadWorkspace(root);
  if (envName !== undefined && !ws) throw new InputError("env は作業フォルダーに environments.json があるときだけ使える");
  const env = ws ? pickEnv(ws, envName) : undefined;
  const auth = ws && env ? loadAuthForEnv(env, root) : loadAuth({ cwd: root, env: ctx.env });
  return { client: createRestClient(auth), authLabel: describeAuth(auth), ws, env };
}

/** アプリの指定: 番号、または environments.json の apps の名前 */
export const appSchema = z
  .union([z.number().int().positive(), z.string().min(1).max(200)])
  .describe("アプリの番号（environments.json があれば apps の名前も）");

export const envSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,40}$/)
  .optional()
  .describe("environments.json の環境の名前（省略すると既定の環境。environments.json があるときだけ）");

/** アプリの番号に直す（名前は environments.json の apps から。無ければ番号だけ） */
export function appIdOf(target: KintoneTarget, app: number | string): number {
  if (typeof app === "number") return app;
  if (target.ws && target.env) return resolveApp(target.ws, target.env, app).appId;
  if (/^\d+$/.test(app) && Number(app) > 0 && Number.isSafeInteger(Number(app))) return Number(app);
  throw new InputError(`アプリは番号で指定する（environments.json があれば apps の名前も）: ${app}`);
}

export interface AppRef {
  appId: number;
  guestSpaceId?: number;
}

/**
 * Desktop のツールのアプリの指定: 番号か、アプリの URL（https、オリジンが接続先と同じ、/k/<番号>/ か /k/guest/<スペース>/<番号>/。
 * ユーザー名・パスワードの部分があれば断る。query と fragment は見ない。実装案 5.4）
 */
export function appRefOf(app: number | string, baseUrl: string): AppRef {
  if (typeof app === "number") return { appId: app };
  if (/^\d+$/.test(app)) {
    const n = Number(app);
    if (n > 0 && Number.isSafeInteger(n)) return { appId: n };
  }
  let u: URL;
  try {
    u = new URL(app);
  } catch {
    throw new InputError("アプリは番号か、アプリの URL（https://<サブドメイン>.cybozu.com/k/<番号>/）で指定する");
  }
  if (u.username || u.password) throw new InputError("アプリの URL にユーザー名・パスワードの部分は書かない");
  if (u.protocol !== "https:" || u.origin !== new URL(baseUrl).origin) throw new InputError(`アプリの URL が接続先（${new URL(baseUrl).origin}）のものでない（別の環境の URL から番号だけを使わない）`);
  const m = u.pathname.match(/^\/k\/(?:guest\/(\d+)\/)?(\d+)\/?$/);
  if (!m) throw new InputError("アプリの URL は /k/<番号>/ か /k/guest/<スペース>/<番号>/ の形");
  const appId = Number(m[2]);
  const guestSpaceId = m[1] ? Number(m[1]) : undefined;
  if (!Number.isSafeInteger(appId) || appId <= 0 || (guestSpaceId !== undefined && (!Number.isSafeInteger(guestSpaceId) || guestSpaceId <= 0))) throw new InputError("アプリの URL の番号が正の整数でない");
  return guestSpaceId ? { appId, guestSpaceId } : { appId };
}
