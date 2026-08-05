// お題(words)画面の編集モデル。UI から切り離してあるのは、サーバー API の制約を
// 吸収する部分がいちばん間違えやすいから。
//
// ⚠ words テーブルの一意キーは (text, level) で、id は upsert に使われない。
//   つまり POST では既存行の text / level を変更できず、別の行が増える。
//   → text か level を変えた行は「新しい語を upsert してから、古い id を DELETE」に分解する。
//   順序が重要：先に DELETE すると POST 失敗時に語が消えるが、先に upsert すれば
//   最悪でも重複が残るだけで復旧できる。

import type { WordEntry } from "./api";

export type Row = {
  /** 画面内で行を識別するキー。サーバーの id とは別（新規行には id がない）。 */
  uid: string;
  id?: number;
  text: string;
  reading: string;
  /** 空文字ならサーバーが reading から算出する。 */
  keystrokeCount: string;
  level: number;
  category: string;
  /** 取得時の値。未取得（新規行）なら undefined。 */
  orig?: WordEntry;
  deleted?: boolean;
};

let uidSeq = 0;
export function newUid(): string {
  uidSeq += 1;
  return `r${uidSeq}`;
}

export function toRow(w: WordEntry): Row {
  return {
    uid: newUid(),
    id: w.id,
    text: w.text,
    reading: w.reading,
    keystrokeCount: String(w.keystrokeCount ?? ""),
    level: w.level,
    category: w.category,
    orig: w,
  };
}

export function emptyRow(level = 0, category = "general"): Row {
  return { uid: newUid(), text: "", reading: "", keystrokeCount: "", level, category };
}

export function toEntry(r: Row): WordEntry {
  const ks = Number.parseInt(r.keystrokeCount, 10);
  return {
    text: r.text.trim(),
    // reading が空ならサーバーが text で埋める。ここでは送らないだけにしておく。
    reading: r.reading.trim(),
    keystrokeCount: Number.isFinite(ks) && ks > 0 ? ks : 0,
    level: r.level,
    category: r.category.trim() || "general",
  };
}

export type RowState = "new" | "renamed" | "edited" | "deleted" | "clean";

/** rowState は行の変更種別を返す。renamed＝text か level が変わった＝2段操作が要る行。 */
export function rowState(r: Row): RowState {
  if (r.deleted) return "deleted";
  if (!r.orig) return "new";
  const o = r.orig;
  if (r.text.trim() !== o.text || r.level !== o.level) return "renamed";
  const ks = Number.parseInt(r.keystrokeCount, 10);
  const ksNow = Number.isFinite(ks) && ks > 0 ? ks : 0;
  const ksWas = o.keystrokeCount ?? 0;
  if (
    r.reading.trim() !== o.reading ||
    (r.category.trim() || "general") !== o.category ||
    (ksNow !== 0 && ksNow !== ksWas)
  ) {
    return "edited";
  }
  return "clean";
}

export type Plan = {
  /** POST /api/words {mode:"upsert"} に載せる語。 */
  upserts: WordEntry[];
  /** DELETE /api/words/{id} する id。 */
  deleteIds: number[];
  /** text/level を変えた行の数（2段操作になる＝失敗時の説明に使う）。 */
  renamedCount: number;
  newCount: number;
  editedCount: number;
  deletedCount: number;
};

export function buildPlan(rows: Row[]): Plan {
  const plan: Plan = {
    upserts: [],
    deleteIds: [],
    renamedCount: 0,
    newCount: 0,
    editedCount: 0,
    deletedCount: 0,
  };

  for (const r of rows) {
    switch (rowState(r)) {
      case "deleted":
        if (r.id !== undefined) plan.deleteIds.push(r.id);
        plan.deletedCount += 1;
        break;
      case "new":
        plan.upserts.push(toEntry(r));
        plan.newCount += 1;
        break;
      case "renamed":
        // 新しい (text, level) を作ってから、古い行を消す。
        plan.upserts.push(toEntry(r));
        if (r.id !== undefined) plan.deleteIds.push(r.id);
        plan.renamedCount += 1;
        break;
      case "edited":
        plan.upserts.push(toEntry(r));
        plan.editedCount += 1;
        break;
      case "clean":
        break;
    }
  }
  return plan;
}

export function planTotal(p: Plan): number {
  return p.newCount + p.renamedCount + p.editedCount + p.deletedCount;
}

/** validateRows は保存前に弾く条件。サーバーは text 空を 400 にするので先回りする。 */
export function validateRows(rows: Row[]): string[] {
  const errs: string[] = [];
  // 重複判定は (text, level) の組。区切り文字で連結すると、お題自体がその文字を
  // 含んだ時に誤判定するので、キーは JSON 化して復元は値側から行う。
  const seen = new Map<string, { text: string; level: number; count: number }>();

  for (const r of rows) {
    if (r.deleted) continue;
    const text = r.text.trim();
    if (!text) {
      errs.push("お題（text）が空の行があります");
      continue;
    }
    if (!Number.isInteger(r.level) || r.level < 0) {
      errs.push(`「${text}」: レベルは 0 以上の整数にしてください`);
    }
    const ks = r.keystrokeCount.trim();
    if (ks && !/^\d+$/.test(ks)) {
      errs.push(`「${text}」: 打鍵数は空欄か0以上の整数にしてください（空欄ならサーバーが算出）`);
    }
    const key = JSON.stringify([text, r.level]);
    const hit = seen.get(key);
    if (hit) hit.count += 1;
    else seen.set(key, { text, level: r.level, count: 1 });
  }

  for (const { text, level, count } of seen.values()) {
    if (count > 1) {
      errs.push(`「${text}」(レベル${level}) が重複しています。同じ語は同じレベルに1つだけ置けます`);
    }
  }
  return [...new Set(errs)];
}

/**
 * parseBulk は CSV / TSV を Row に変換する。列は text, reading, level, category の順。
 * ヘッダ行（1列目が "text"）は読み飛ばす。区切りはタブ優先（スプレッドシートからの貼付を想定）。
 */
export function parseBulk(
  input: string,
  fallbackCategory = "general",
): { rows: Row[]; errors: string[] } {
  const rows: Row[] = [];
  const errors: string[] = [];

  input.split(/\r?\n/).forEach((line, i) => {
    if (!line.trim()) return;
    const cols = (line.includes("\t") ? line.split("\t") : line.split(",")).map((c) => c.trim());
    if (i === 0 && cols[0]?.toLowerCase() === "text") return; // ヘッダ行

    const [text, reading, levelStr, category] = cols;
    if (!text) {
      errors.push(`${i + 1}行目: お題が空です`);
      return;
    }
    const level = levelStr ? Number.parseInt(levelStr, 10) : 0;
    if (!Number.isInteger(level) || level < 0) {
      errors.push(`${i + 1}行目: レベル "${levelStr}" が不正です`);
      return;
    }
    rows.push({
      uid: newUid(),
      text,
      reading: reading || text,
      keystrokeCount: "",
      level,
      category: category || fallbackCategory,
    });
  });

  return { rows, errors };
}
