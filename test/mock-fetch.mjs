// 試験のときだけ、サーバーのプロセスに Node の --import で読み込ませる kintone の偽物（本体のコードには試験の仕掛けを入れない）。
// globalThis.fetch を差し替え、x.cybozu.com / dev-x.cybozu.com のアプリ 3740 / 101 に決まった応答を返す。
// 送られた要求（メソッド、URL、認証のヘッダーがあるか）を PCRAFT_TEST_FETCH_LOG のファイルに 1 行ずつ書く（ヘッダーの値は書かない）
import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIELDS = JSON.parse(readFileSync(path.join(here, "fixtures", "fields-3740.json"), "utf8"));
const RECORD = JSON.parse(readFileSync(path.join(here, "fixtures", "record-3740-3.json"), "utf8")).record;
const LOG = process.env.PCRAFT_TEST_FETCH_LOG;
/** 印刷屋が保存した形のプラグインの設定（試験が中核の writeConfig で作ってファイルに置く） */
const PLUGIN_CONFIG = process.env.PCRAFT_TEST_PLUGIN_CONFIG;
const PRINT_CRAFT_PLUGIN_ID = "lcapkanpjdabgphknkabojmcfhonhkhp";
const HOSTS = new Set(["x.cybozu.com", "dev-x.cybozu.com"]);
const APPS = new Set(["3740", "101"]);

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const notFound = () => json(404, { code: "GAIA_AP01", id: "x", message: "SERVER-SECRET-MESSAGE 指定したアプリは存在しません" });

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = init.headers ?? {};
  const hasToken = Object.keys(headers).some((k) => /^x-cybozu-(api-token|authorization)$/i.test(k));
  if (LOG) appendFileSync(LOG, `${JSON.stringify({ method: init.method ?? "GET", host: url.host, path: url.pathname, query: Object.fromEntries(url.searchParams), hasToken })}\n`);
  if (!HOSTS.has(url.host)) return notFound();
  if (!hasToken) return json(401, { code: "CB_AU01", id: "x", message: "SERVER-SECRET-MESSAGE ログインしてください" });
  const m = url.pathname.match(/^\/k\/(?:guest\/(\d+)\/)?v1\/(.+)\.json$/);
  if (!m) return notFound();
  const api = m[2];
  const q = url.searchParams;
  const appOf = (k) => (APPS.has(q.get(k) ?? "") ? q.get(k) : null);
  if (api === "app" && appOf("id")) {
    return json(200, { appId: q.get("id"), code: "", name: "見積書(印刷屋)", description: "<b>説明の全文 DESCRIPTION-SECRET</b>", spaceId: m[1] ? "11" : null, threadId: m[1] ? "12" : null, creator: { code: "taro", name: "山田太郎" }, modifier: { code: "taro", name: "山田太郎" } });
  }
  if ((api === "app/form/fields" || api === "preview/app/form/fields") && appOf("app")) return json(200, { properties: FIELDS.properties, revision: "5" });
  if ((api === "app/form/layout" || api === "preview/app/form/layout") && appOf("app")) return json(200, { layout: FIELDS.layout, revision: "5" });
  if (api === "record" && appOf("app") && q.get("id") === "3") return json(200, { record: RECORD });
  if ((api === "app/plugin/config" || api === "preview/app/plugin/config") && appOf("app")) {
    if (q.get("id") !== PRINT_CRAFT_PLUGIN_ID || !PLUGIN_CONFIG) return json(404, { code: "GAIA_PL18", id: "x", message: "SERVER-SECRET-MESSAGE プラグインが追加されていません" });
    return json(200, { config: JSON.parse(readFileSync(PLUGIN_CONFIG, "utf8")), revision: "12" });
  }
  if (api === "records" && appOf("app")) {
    const rec = (id) => ({ ...RECORD, $id: { type: "__ID__", value: String(id) } });
    return json(200, { records: [rec(3), rec(4), rec(5), rec(6), rec(7), rec(8)], totalCount: null });
  }
  return notFound();
};
