// ミラーのズレ（ドリフト）検出。
//
// 設定は3層のミラーになっている:
//
//	① server internal/game/params.go（正典）
//	   ↓ JSON
//	② /api/params
//	   ↓ HTTP
//	③ この画面の lib/params.ts（手で写している）
//
// ①③は**手動同期**なので必ずいつかズレる。ズレを画面上で可視化するのがこのファイル。
//
// 🔴 **これは実際に起きた事故への対策**（2026-08-16）。
// サーバー側で `heat.perElapsedSec` の既定値を 0.12 にしたのに、この画面側の既定値を
// 0.11 のまま直し忘れた。perElapsedSec は新設キーで DB に存在しなかったため、
// **画面を開いた瞬間に画面側の既定値 0.11 で補完されて本番DBへ保存**され、
// 誰も気付かないまま本番が意図と違う値で走っていた。
//
// 🔴 **両方向を検出する。** 片方向だけでは足りない:
//
//	サーバーが返すのに画面が知らない → 「触れない項目」。h30〜h34 でフィールドが増えると即これ
//	画面が持つのにサーバーが返さない → 「**効かないツマミ**」。h24 が最も警戒していた事故。
//	                                    さらに保存すると画面側の既定値がDBへ書き込まれる
//
// このファイルは React に依存しない純関数だけを置く（テストしやすさのため）。

import { ATTRIBUTE_KEYS, allBoolPaths, allFieldPaths, allReadonlyPaths, type GameParameters } from "./params";

/** サーバーが GameParameters の外側に足しているキー。ドリフトではない（plan-h23 §3 案B）。 */
export const NON_PARAM_KEYS = new Set(["configHash"]);

export type LeafKind = "number" | "boolean" | "string" | "other";

export type UnknownLeaf = {
  path: string;
  kind: LeafKind;
  value: unknown;
};

export type Drift = {
  /** サーバーが返しているが、この画面のスキーマが知らないリーフ。 */
  unknown: UnknownLeaf[];
  /** スキーマは持っているが、サーバーの応答に無いパス（＝効かないツマミの疑い）。 */
  missing: string[];
};

/**
 * flattenLeaves はオブジェクトを「ドット区切りパス → 値」のリーフ一覧へ平坦化する。
 * 配列は添字をパス要素にする（cull.stages.0.atMs）。null は値（リーフ）として扱う。
 */
export function flattenLeaves(obj: unknown, prefix = ""): Map<string, unknown> {
  const out = new Map<string, unknown>();
  if (typeof obj !== "object" || obj === null) {
    if (prefix) out.set(prefix, obj);
    return out;
  }
  const entries = Array.isArray(obj)
    ? obj.map((v, i) => [String(i), v] as const)
    : Object.entries(obj as Record<string, unknown>);

  // 空のオブジェクト/配列はリーフが無いので、その存在自体を1件として残す
  // （サーバーが空の cull.stages を返した、のような異常を握り潰さないため）。
  if (entries.length === 0) {
    if (prefix) out.set(prefix, obj);
    return out;
  }

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    for (const [p, v] of flattenLeaves(value, path)) out.set(p, v);
  }
  return out;
}

/**
 * schemaKnownPaths はこの画面が「知っている」パスの集合。
 *
 * 編集可能な数値・真偽値・表示のみの列に加え、**スキーマには載らないが承知している**
 * `customer.*.attribute`（文字列・サーバーが決める）も含める。
 * ここに入っていないものが「未対応の項目」になる。
 */
export function schemaKnownPaths(): Set<string> {
  const s = new Set<string>([...allFieldPaths(), ...allBoolPaths(), ...allReadonlyPaths()]);
  // 属性行の attribute（"Normal" 等）は編集させないが未知でもない。
  for (const a of ATTRIBUTE_KEYS) s.add(`customer.${a.key}.attribute`);
  return s;
}

function kindOf(v: unknown): LeafKind {
  if (typeof v === "number") return "number";
  if (typeof v === "boolean") return "boolean";
  if (typeof v === "string") return "string";
  return "other";
}

/**
 * detectDrift はサーバーの生 JSON とこの画面のスキーマを突き合わせ、両方向のズレを返す。
 *
 * ⚠ 引数は **fillMissing を通す前の生 JSON**。fillMissing 後の値を渡すと
 * 欠けたパスが画面側の既定値で埋まってしまい、**いちばん危ない「サーバーが返さない」
 * 側が検出できなくなる**（それこそが 2026-08-16 の事故の形）。
 */
export function detectDrift(serverRaw: unknown): Drift {
  const known = schemaKnownPaths();
  const leaves = flattenLeaves(serverRaw);

  const unknown: UnknownLeaf[] = [];
  for (const [path, value] of leaves) {
    if (NON_PARAM_KEYS.has(path)) continue;
    if (known.has(path)) continue;
    unknown.push({ path, kind: kindOf(value), value });
  }
  unknown.sort((a, b) => a.path.localeCompare(b.path));

  const missing: string[] = [];
  for (const path of known) {
    if (!leaves.has(path)) missing.push(path);
  }
  missing.sort();

  return { unknown, missing };
}

/** 未対応リーフのうち、この画面で編集できる型（数値・真偽値）だけを返す。 */
export function editableUnknown(d: Drift): UnknownLeaf[] {
  return d.unknown.filter((u) => u.kind === "number" || u.kind === "boolean");
}

/**
 * exportFileName は書き出す JSON のファイル名。日時を入れて上書き事故を防ぐ。
 * configHash を入れておくと「どの設定を配ったか」が名前だけで照合できる。
 */
export function exportFileName(configHash: string | undefined, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}`;
  return `takoda99-params-${stamp}${configHash ? `-${configHash}` : ""}.json`;
}

/**
 * parseImported は読み込んだ JSON テキストを検査して返す。
 * 形が違うものを黙って受け入れると、当日「読み込んだのに何も変わらない」になる。
 */
export function parseImported(text: string): { params: GameParameters } | { error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { error: `JSON として読めませんでした: ${String(e)}` };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "JSON のトップレベルがオブジェクトではありません" };
  }
  // 最低限、パラメータらしさを確認する（別のファイルを読ませてしまった時の保険）。
  const leaves = flattenLeaves(parsed);
  const known = schemaKnownPaths();
  let hit = 0;
  for (const path of known) if (leaves.has(path)) hit++;
  if (hit < known.size / 2) {
    return {
      error: `パラメータのファイルに見えません（既知の項目 ${known.size} 件のうち ${hit} 件しか一致しません）`,
    };
  }
  return { params: parsed as GameParameters };
}
