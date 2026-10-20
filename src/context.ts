/**
 * サーバーの文脈: 出し分け（--surface）、作業フォルダーの結び付け、設定項目の値（環境変数）、印刷屋のエンジン、ツールを 1 つずつ動かす仕組み。
 * 設定項目の値は起動時に一度だけ受け取り、中核に引数で渡す（中核は process.env を読まない）
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expandHome, isUnset, type Surface, type WorkspaceBinding } from "./binding.ts";
import { quietly } from "./console-gate.ts";
import { loadEngine, modeOf, pluginZipPath, unquote, type Engine, type Evaluator, type WorkspaceMode } from "./core.ts";

/**
 * 評価の子プロセスの入口（束ねた本体 dist/server/print-craft-mcp.cjs の隣の eval-worker.cjs。build-mcp.mjs が中核の dist/eval-worker.mjs を束ねる。
 * print-craft の docs/authoring-try-plan.md 4.6）
 */
export const EVAL_WORKER_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "eval-worker.cjs");

export type Env = Readonly<Record<string, string | undefined>>;

export interface ServerContext {
  surface: Surface;
  binding: WorkspaceBinding;
  /** 設定項目の値（空と、置き換えられずに ${user_config.…} の字のまま届いたものは除いてある） */
  env: Env;
  log: (line: string) => void;
  /**
   * 印刷屋のエンジン（中核が 1 プロセスに 1 つだけ読む）。zip のコードを動かす前の失敗（無い・読めない・別のプラグイン・版）は次の呼び出しでやり直すが、
   * 動かし始めた後の失敗は、再接続（Desktop は再起動）まで PluginZipError（restart-required）。読み込んだ後に別の zip（別の作業フォルダーの .env など）や
   * 変わった zip を渡すと、中核が PluginZipError（zip-changed）で止める（前はここで最初のエンジンを返していた。Codex の B1 再レビュー MAJOR 2、3 回目 MAJOR 1）
   */
  engine(zip: string): Promise<Engine>;
  /**
   * zip の式を評価する口（子プロセス。時間とメモリの上限。tools 2.3.0、計画 4.6）。normalize・保存の検査はこれを通す（親のエンジンで評価しない）。
   * 子プロセスに渡す環境変数は設定項目の値のうち動くのに要るもの（TZ など）だけ（中核の childEnv）
   */
  evaluator(zip: string): Evaluator;
  /** 中核のエンジンを使うツールは 1 つずつ動かす（エンジンは 1 つで setContext を挟むので重ねない）。動かしている間の console の出力は捨てる */
  serial<T>(fn: () => Promise<T>): Promise<T>;
  /** kintone の接続のファイル（設定項目 kintoneConfig = PCRAFT_KINTONE_CONFIG。~ を展開し両端の引用符を外したもの。無ければ undefined） */
  connectionFile: string | undefined;
  /**
   * 動く形（実装案 15.4）: 接続のファイルがあれば profiles（読めなければ ConnectionError）、無くて environments.json があれば legacy-blocked、
   * 無ければ not-configured。呼び出しの初めに 1 回（接続のファイルはツールを呼ぶたびに読む。書き換えは再接続なしで効く）
   */
  mode(root: string): WorkspaceMode;
}

/** 未設定の値を除く（設定項目が空のとき、Claude Code は空の文字、ホストによっては ${user_config.…} の字のまま渡す） */
export function sanitizeEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && !isUnset(v)) out[k] = v;
  return out;
}

export function createServerContext(surface: Surface, binding: WorkspaceBinding, env: Env, log: (line: string) => void): ServerContext {
  let tail: Promise<unknown> = Promise.resolve();
  const clean = sanitizeEnv(env);
  const connectionFile = clean.PCRAFT_KINTONE_CONFIG !== undefined ? expandHome(unquote(clean.PCRAFT_KINTONE_CONFIG)) : undefined;
  return {
    surface,
    binding,
    env: clean,
    log,
    connectionFile,
    mode(root) {
      // 今の作業フォルダーも必ず入れる（接続のファイルがこの中にあれば使わない。15.3）
      const roots = [...new Set([root, ...binding.knownRoots()])];
      return modeOf(root, { configFile: connectionFile, workspaceRoots: roots, env: clean, surface: "mcp" });
    },
    engine(zip) {
      return quietly(() => loadEngine({ pluginZip: zip }));
    },
    evaluator(zip) {
      return { pluginZip: zip, run: { workerFile: EVAL_WORKER_FILE, env: clean } };
    },
    serial(fn) {
      const quiet = () => quietly(fn);
      const run = tail.then(quiet, quiet);
      tail = run.catch(() => undefined);
      return run;
    }
  };
}

export interface ZipChoice {
  zip?: string;
  source: "設定項目" | "作業フォルダーの .env" | "無し";
  problem?: string;
}

/** 印刷屋の zip の場所: 設定項目（環境変数 PCRAFT_PLUGIN_ZIP。絶対パスだけ）か、作業フォルダーの .env（今の CLI と同じ） */
export function zipOf(ctx: ServerContext, root: string | undefined): ZipChoice {
  const fromConfig = ctx.env.PCRAFT_PLUGIN_ZIP !== undefined;
  try {
    const zip = fromConfig ? pluginZipPath({ cwd: root ?? "/", env: ctx.env, envFile: "/nonexistent-print-craft/.env" }) : root ? pluginZipPath({ cwd: root, env: {} }) : undefined;
    if (zip) return { zip, source: fromConfig ? "設定項目" : "作業フォルダーの .env" };
    return { source: "無し" };
  } catch (e) {
    return { source: fromConfig ? "設定項目" : "作業フォルダーの .env", problem: (e as Error).message };
  }
}

export function zipGuide(surface: Surface): string {
  return surface === "desktop"
    ? "拡張機能の設定で「印刷屋プラグインの zip」を選ぶ（アプリに入れたものと同じ版）"
    : "/config で print-craft の「印刷屋プラグインの zip」に絶対パスを入れて /mcp で再接続する（作業フォルダーの .env の PCRAFT_PLUGIN_ZIP でもよい）";
}
