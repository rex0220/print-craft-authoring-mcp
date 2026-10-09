/**
 * console の出力の行き先（標準出力は JSON-RPC だけ）。中核・SDK・印刷屋の zip のコードの console の出力は標準エラーへ回すが、
 * 印刷屋のエンジンを動かしている間（ctx.serial と ctx.engine の中）は捨てる。印刷屋の fileNameOf は $fname の評価の失敗を例外ごと
 * console.log し、印刷屋が使う moment は日付として読めない値を警告（console.warn）に入れる。どちらもレコードの値を含みうる
 * （Desktop の main.log などに残さない。Codex の B1 再レビュー BLOCKER 1）。捨てたときは件数だけを 1 行で残す。
 * サーバー自身の記録（log）は process.stderr に直接書くので、ここを通らない
 */
import { Console } from "node:console";
import { Writable } from "node:stream";

let quiet = 0;
let dropped = 0;
let report: (line: string) => void = () => undefined;

/** console のすべての出力（log・warn・dir・table など）を、標準エラーか捨てる先に向ける。起動のときに 1 回 */
export function installConsoleGate(log: (line: string) => void): void {
  report = log;
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      if (quiet > 0) dropped++;
      else process.stderr.write(chunk);
      callback();
    }
  });
  const gated = new Console({ stdout: sink, stderr: sink });
  const target = console as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(gated as unknown as Record<string, unknown>)) if (typeof v === "function") target[k] = v;
}

/** fn の間の console の出力を捨てる（重ねてよい。一番外が終わったら捨てた件数を記録する） */
export async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  quiet++;
  try {
    return await fn();
  } finally {
    quiet--;
    if (quiet === 0 && dropped > 0) {
      report(`印刷屋のコードなどの console の出力を ${dropped} 件捨てた（レコードの値を含みうるので出さない）`);
      dropped = 0;
    }
  }
}
