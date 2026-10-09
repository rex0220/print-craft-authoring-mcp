/**
 * 共通の中核（print-craft-authoring の tools/src。tools 1.2.0 で切り出した。段階 0-2）。
 * 段階 0-3b の試作では、隣のリポジトリのソースを esbuild で束ねる（中核の配り方は B1 の前に決める。実装案 2 章、12.3）。
 * 中核への参照はこのファイルだけにする（配り方が決まったら、ここだけを npm のパッケージに向け直す）
 */
export { MAX_SAVE_INPUT_BYTES, digestOf, saveNewSettings, type SaveResult } from "../../../../print-craft-authoring/tools/src/commands/save.ts";
export { loadEngine, type Engine } from "../../../../print-craft-authoring/tools/src/engine.ts";
export { loadPolicy } from "../../../../print-craft-authoring/tools/src/normalize/policy.ts";
export { baseUrlFromEnv, pluginZipPath, unquote } from "../../../../print-craft-authoring/tools/src/env.ts";
export { toolsMeta } from "../../../../print-craft-authoring/tools/src/meta.ts";
