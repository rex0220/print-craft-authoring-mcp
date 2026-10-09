/**
 * サーバーの文脈: 出し分け（--surface）、作業フォルダーの結び付け、設定項目の値（環境変数）、印刷屋のエンジン、ツールを 1 つずつ動かす仕組み。
 * 設定項目の値は起動時に一度だけ受け取り、中核に引数で渡す（中核は process.env を読まない）
 */
import { isUnset, type Surface, type WorkspaceBinding } from "./binding.ts";
import { quietly } from "./console-gate.ts";
import { loadEngine, pluginZipPath, type Engine } from "./core.ts";

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
  /** 中核のエンジンを使うツールは 1 つずつ動かす（エンジンは 1 つで setContext を挟むので重ねない）。動かしている間の console の出力は捨てる */
  serial<T>(fn: () => Promise<T>): Promise<T>;
}

/** 未設定の値を除く（設定項目が空のとき、Claude Code は空の文字、ホストによっては ${user_config.…} の字のまま渡す） */
export function sanitizeEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (typeof v === "string" && !isUnset(v)) out[k] = v;
  return out;
}

export function createServerContext(surface: Surface, binding: WorkspaceBinding, env: Env, log: (line: string) => void): ServerContext {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    surface,
    binding,
    env: sanitizeEnv(env),
    log,
    engine(zip) {
      return quietly(() => loadEngine({ pluginZip: zip }));
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
