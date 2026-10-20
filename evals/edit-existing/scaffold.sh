#!/bin/bash
# 作業フォルダー（実行の一時フォルダー）に、既存の設定・項目定義・レコードを置く（架空の値の試験用の fixture。build-eval-plugin.mjs が evals/_fixtures/ に写す）
set -eu
fx="$(cd "$(dirname "$0")/../_fixtures" && pwd)"
mkdir -p settings fields records
cp "$fx/settings-mitsumori.json" "settings/見積書.json"
cp "$fx/fields-3740.json" "fields/3740.json"
cp "$fx/record-3740-3.json" "records/3740-3.json"
