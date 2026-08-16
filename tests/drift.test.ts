// ドリフト検出と保存ロジックの回帰テスト（plan-h35 §8「管理画面」）。
//
//	npm test
//
// ⚠ テストランナーは入れていない（Node 標準の node:test ＋ tsc だけ）。理由は tsconfig.test.json。
//
// ここで固定しているのは、**設定事故の再発防止に直結する4点**:
//   1. 未知のリーフが「その他」に出る（サーバーが先に増えても触れる）
//   2. スキーマにあってサーバーに無いパスが警告される（＝効かないツマミ）
//   3. applyEdits が未知フィールドを保存で落とさない（既存設計の回帰固定）
//   4. 画面の既定値がサーバー内蔵デフォルトと一致している（2026-08-16 の事故そのもの）

import assert from "node:assert/strict";
import test from "node:test";

import { detectDrift, editableUnknown, exportFileName, flattenLeaves, parseImported } from "../lib/drift";
import { applyEdits, defaultParameters, getPath, type EditValue } from "../lib/params";
import { riskWarnings, validate } from "../lib/validate";

/** サーバーが返す JSON を模す（configHash 込み・GameParameters の完全な写し）。 */
function serverJson(): Record<string, unknown> {
  return {
    ...(structuredClone(defaultParameters) as unknown as Record<string, unknown>),
    configHash: "d0b875b9",
  };
}

test("既定値だけのサーバー応答ならドリフトは出ない", () => {
  const d = detectDrift(serverJson());
  assert.deepEqual(d.unknown, [], "未知リーフが出た");
  assert.deepEqual(d.missing, [], "欠落パスが出た");
});

test("configHash はドリフト扱いしない（GameParameters の外側のキー）", () => {
  const raw = serverJson();
  assert.ok(flattenLeaves(raw).has("configHash"));
  assert.equal(
    detectDrift(raw).unknown.filter((u) => u.path === "configHash").length,
    0,
  );
});

test("サーバーが先に増やしたキーは未知リーフとして検出され、型が分かる", () => {
  const raw = serverJson();
  // h31 で bot が増えた想定 ＋ 画面が知らないグループごと増えた想定。
  (raw.bot as Record<string, unknown>).individualSpread = 0.25;
  (raw.bot as Record<string, unknown>).tiersEnabled = true;
  raw.mystery = { alpha: 3, label: "なぞ" };

  const d = detectDrift(raw);
  const paths = d.unknown.map((u) => u.path);
  assert.deepEqual(paths, ["bot.individualSpread", "bot.tiersEnabled", "mystery.alpha", "mystery.label"]);
  assert.equal(d.unknown.find((u) => u.path === "bot.tiersEnabled")?.kind, "boolean");
  assert.equal(d.unknown.find((u) => u.path === "mystery.label")?.kind, "string");

  // 文字列は編集させない（型が分からないものを壊せないように）。
  assert.deepEqual(
    editableUnknown(d).map((u) => u.path),
    ["bot.individualSpread", "bot.tiersEnabled", "mystery.alpha"],
  );
});

test("サーバーが返さないパスは「効かないツマミ」として検出される", () => {
  const raw = serverJson();
  // 🔴 2026-08-16 の事故と同じ形（サーバーがまだ古く、新設キーを返さない）。
  delete (raw.heat as Record<string, unknown>).perElapsedSec;
  delete (raw.score as Record<string, unknown>).weightMiss;

  const d = detectDrift(raw);
  assert.deepEqual(d.missing, ["heat.perElapsedSec", "score.weightMiss"]);
  assert.deepEqual(d.unknown, []);
});

test("足切りステージが足りない応答も欠落として見える（ゼロ埋めの罠の入口）", () => {
  const raw = serverJson();
  (raw.cull as { stages: unknown[] }).stages.pop();
  const d = detectDrift(raw);
  assert.ok(d.missing.includes("cull.stages.5.atMs"));
  assert.ok(d.missing.includes("cull.stages.5.targetAliveCount"));
});

test("ドリフト検出は fillMissing 前の生JSONに掛ける前提（欠落が消えないこと）", () => {
  const raw = serverJson();
  delete (raw.odai as Record<string, unknown>).levelOffset;
  assert.deepEqual(detectDrift(raw).missing, ["odai.levelOffset"]);
});

test("applyEdits は未知フィールドを保存で落とさない（設計の肝の回帰固定）", () => {
  const raw = serverJson();
  (raw.bot as Record<string, unknown>).individualSpread = 0.25;
  raw.mystery = { alpha: 3, label: "なぞ" };

  const edits = new Map<string, EditValue>([
    ["score.weightMiss", 28],
    ["bot.individualSpread", 0.4], // 未知リーフも編集できる
  ]);
  const saved = applyEdits(raw, edits);

  assert.equal(getPath(saved, "score.weightMiss"), 28, "既知の編集が反映されていない");
  assert.equal(getPath(saved, "bot.individualSpread"), 0.4, "未知リーフの編集が反映されていない");
  assert.equal(getPath(saved, "mystery.label"), "なぞ", "未知フィールドが落ちた");
  assert.equal(getPath(saved, "customer.normal.attribute"), "Normal", "スキーマ外の文字列が落ちた");
  assert.equal(getPath(saved, "configHash"), "d0b875b9", "configHash が落ちた");
});

// 🔴 **これが 2026-08-16 の事故の再発防止テスト。**
// サーバー側 internal/game/params.go の DefaultParameters() を変えたら、ここも直す。
// DB に無いキーはこの既定値で補完されて**そのまま本番へ保存される**ので、
// 「画面の好みの値」を置いてはいけない。
test("画面の既定値がサーバー内蔵デフォルトの写しになっている", () => {
  const expected: Record<string, number | boolean> = {
    // h30: 1語を短くしたぶん語数で難度を持つ
    "customer.normal.orderCount": 3,
    "customer.bonus.orderCount": 3,
    "customer.claimer.orderCount": 2,
    "customer.buzz.orderCount": 6,
    "customer.total": 5000,
    // h30: 拮抗点が動いたので 25 → 30
    "score.weightTakoyaki": 100,
    "score.weightMiss": 30,
    // h32: 難度カーブの主軸。0.11 と書き間違えて本番が 0.11 で走った事故のキー
    "heat.perElapsedSec": 0.12,
    "heat.perAliveDrop": 0.03,
    "heat.phaseMid": 1,
    "heat.phaseLate": 2,
    "heat.maxLevel": 17,
    // h35: 既定は「現行と完全に同じ挙動」
    "odai.levelSpread": 0,
    "odai.levelOffset": 0,
    "cull.warnMaxIds": 24,
  };
  for (const [path, want] of Object.entries(expected)) {
    assert.equal(
      getPath(defaultParameters, path),
      want,
      `${path} がサーバーの既定値と違う。server internal/game/params.go と突き合わせること`,
    );
  }
});

test("既定値そのものは検証を通る", () => {
  assert.deepEqual(validate(defaultParameters), []);
});

test("odai.levelOffset は負値を許し、levelSpread は負値を弾く", () => {
  const p = structuredClone(defaultParameters);
  p.odai.levelOffset = -2;
  assert.deepEqual(validate(p), [], "levelOffset の負値は正常な使い方（お題だけやさしくする）");

  p.odai.levelOffset = 0;
  p.odai.levelSpread = -1;
  assert.ok(validate(p).length > 0, "levelSpread の負値はサーバーで panic する");
});

test("cull.warnMaxIds は 0 を許す（サーバーが未設定として既定24に読み替える）", () => {
  const p = structuredClone(defaultParameters);
  p.cull.warnMaxIds = 0;
  assert.deepEqual(validate(p), []);
  p.cull.warnMaxIds = -1;
  assert.ok(validate(p).length > 0);
});

test("warnMaxIds を既定から変えると保存前に警告が出る（クライアントと合意済みの値）", () => {
  const p = structuredClone(defaultParameters);
  p.cull.warnMaxIds = 8;
  const w = riskWarnings(p);
  assert.ok(w.some((m) => m.includes("合意済み")), `警告が出ていない: ${JSON.stringify(w)}`);
});

test("インポートは壊れたJSON・無関係なJSONを弾き、正しいものを受け取る", () => {
  assert.ok("error" in parseImported("{oops"));
  assert.ok("error" in parseImported('{"foo":1}'));
  assert.ok("error" in parseImported("[1,2,3]"));
  const ok = parseImported(JSON.stringify(serverJson()));
  assert.ok("params" in ok);
});

test("書き出しファイル名に日時と configHash が入る", () => {
  assert.equal(
    exportFileName("a69d02c9", new Date(2026, 7, 24, 9, 5)),
    "takoda99-params-20260824-0905-a69d02c9.json",
  );
});
