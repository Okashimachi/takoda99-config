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
  // 将来 bot にフィールドが増えた想定 ＋ 画面が知らないグループごと増えた想定。
  // （h31 の individualSpread / tiers はもうスキーマ側にあるので、未知の例には使えない）
  (raw.bot as Record<string, unknown>).fatigueRate = 0.25;
  (raw.bot as Record<string, unknown>).learningEnabled = true;
  raw.mystery = { alpha: 3, label: "なぞ" };

  const d = detectDrift(raw);
  const paths = d.unknown.map((u) => u.path);
  assert.deepEqual(paths, ["bot.fatigueRate", "bot.learningEnabled", "mystery.alpha", "mystery.label"]);
  assert.equal(d.unknown.find((u) => u.path === "bot.learningEnabled")?.kind, "boolean");
  assert.equal(d.unknown.find((u) => u.path === "mystery.label")?.kind, "string");

  // 文字列は編集させない（型が分からないものを壊せないように）。
  assert.deepEqual(
    editableUnknown(d).map((u) => u.path),
    ["bot.fatigueRate", "bot.learningEnabled", "mystery.alpha"],
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
  (raw.bot as Record<string, unknown>).fatigueRate = 0.25;
  raw.mystery = { alpha: 3, label: "なぞ" };

  const edits = new Map<string, EditValue>([
    ["score.weightMiss", 28],
    ["bot.fatigueRate", 0.4], // 未知リーフも編集できる
  ]);
  const saved = applyEdits(raw, edits);

  assert.equal(getPath(saved, "score.weightMiss"), 28, "既知の編集が反映されていない");
  assert.equal(getPath(saved, "bot.fatigueRate"), 0.4, "未知リーフの編集が反映されていない");
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
    "score.weightMiss": 22,
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
    // h31: Bot の tier。🔴 tiers も individualSpread も**本番DBに無いキー**なので、
    // ここがサーバーとズレていると画面を開いて保存した瞬間にズレた値が本番へ入る
    // （2026-08-16 の heat.perElapsedSec とまったく同じ経路）。
    "bot.tiers.0.weight": 25,
    "bot.tiers.0.msPerKey": 150,
    "bot.tiers.0.missRate": 0.02,
    "bot.tiers.0.heatPenalty": 0.01,
    "bot.tiers.1.weight": 50,
    "bot.tiers.1.msPerKey": 200,
    "bot.tiers.1.missRate": 0.05,
    "bot.tiers.1.heatPenalty": 0.02,
    "bot.tiers.2.weight": 25,
    "bot.tiers.2.msPerKey": 400,
    "bot.tiers.2.missRate": 0.1,
    "bot.tiers.2.heatPenalty": 0.04,
    "bot.individualSpread": 0.2,
    "bot.elapsedJitterMs": 500,
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

// ── Bot の階層（plan-h31）─────────────────────────────────────────

// 🔴 サーバーは 0 を「未設定」として既定へ読み替えるので、**画面側も 0 を弾いてはいけない**。
// 弾く設計にすると「サーバーでも弾く」に揃えたくなり、本番DBに tiers が無い状態で
// Load が落ちて設定が丸ごと内蔵デフォルトへ巻き戻る（#124 と同じ経路）。
test("bot.tiers はゼロを許し、ミス率>1 と個体差>=1 を弾く", () => {
  const p = structuredClone(defaultParameters);
  p.bot.tiers[2] = { weight: 0, msPerKey: 0, missRate: 0, heatPenalty: 0 };
  p.bot.individualSpread = 0;
  assert.deepEqual(validate(p), [], "ゼロは「未設定」なので保存できるべき");

  const q = structuredClone(defaultParameters);
  q.bot.tiers[1].missRate = 1.5;
  assert.ok(validate(q).length > 0, "ミス率 1.5 は確率として成立しない");

  const r = structuredClone(defaultParameters);
  r.bot.individualSpread = 1;
  assert.ok(validate(r).length > 0, "個体差 1 以上は個体係数が 0 以下になりうる");

  const s = structuredClone(defaultParameters);
  s.bot.tiers[0].msPerKey = -1;
  assert.ok(validate(s).length > 0, "負値は弾く");
});

test("bot.tiers の段階数が 3 でないと弾く（ゼロ埋めの罠の入口）", () => {
  const p = structuredClone(defaultParameters);
  p.bot.tiers.pop();
  assert.ok(validate(p).length > 0);
});

test("bot.tiers のミス率・難度への弱さは小数を受け付ける", () => {
  // matrix の列に float を付け忘れると「整数で入力してください」が出て
  // そのマスが**編集できないツマミ**になる。既定値そのものが小数なので、
  // 既定が検証を通ることでこれを固定できる。
  const p = structuredClone(defaultParameters);
  p.bot.tiers[1].missRate = 0.035;
  p.bot.tiers[1].heatPenalty = 0.025;
  assert.deepEqual(validate(p), []);
});

test("Bot が全階層とも人間より速い／遅い設定は保存前に警告する", () => {
  const fast = structuredClone(defaultParameters);
  fast.bot.tiers.forEach((t) => (t.msPerKey = 60));
  assert.ok(
    riskWarnings(fast).some((m) => m.includes("人間より強い")),
    `速すぎ警告が出ていない: ${JSON.stringify(riskWarnings(fast))}`,
  );

  const slow = structuredClone(defaultParameters);
  slow.bot.tiers.forEach((t) => (t.msPerKey = 400));
  assert.ok(
    slow.bot.tiers.length === 3 && riskWarnings(slow).some((m) => m.includes("上位を独占")),
    `遅すぎ警告が出ていない: ${JSON.stringify(riskWarnings(slow))}`,
  );

  // 「強→中→弱」の順に遅くなっていないと階層の意味が消える。
  const inverted = structuredClone(defaultParameters);
  inverted.bot.tiers[0].msPerKey = 300;
  assert.ok(riskWarnings(inverted).some((m) => m.includes("強→中→弱")));

  // 個体差 0 は「未設定」であることを保存前に伝える。
  const flat = structuredClone(defaultParameters);
  flat.bot.individualSpread = 0;
  assert.ok(riskWarnings(flat).some((m) => m.includes("未設定")));

  // 既定値では余計な警告を出さない（当日ダイアログがうるさくならないこと）。
  assert.deepEqual(
    riskWarnings(defaultParameters).filter((m) => m.includes("Bot")),
    [],
  );
});
