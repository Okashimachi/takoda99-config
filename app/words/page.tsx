"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banner, type Msg } from "@/components/Banner";
import { useToken } from "@/components/Chrome";
import { ApiError, deleteWord, getWords, saveWords, type WordEntry } from "@/lib/api";
import {
  buildPlan,
  emptyRow,
  parseBulk,
  planTotal,
  rowState,
  toRow,
  validateRows,
  type Row,
  type RowState,
} from "@/lib/words";

const STATE_STYLE: Record<RowState, { badge: string; tone: string; row: string }> = {
  new: {
    badge: "新規",
    tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    row: "bg-emerald-50/60 dark:bg-emerald-950/20",
  },
  renamed: {
    badge: "語/Lv変更",
    tone: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    row: "bg-amber-50/60 dark:bg-amber-950/20",
  },
  edited: {
    badge: "変更",
    tone: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    row: "bg-sky-50/60 dark:bg-sky-950/20",
  },
  deleted: {
    badge: "削除",
    tone: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
    row: "bg-rose-50/60 line-through opacity-60 dark:bg-rose-950/20",
  },
  clean: { badge: "", tone: "", row: "" },
};

export default function WordsPage() {
  const { token } = useToken();

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const [qText, setQText] = useState("");
  const [qLevel, setQLevel] = useState<string>("");
  const [qCategory, setQCategory] = useState<string>("");

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  const load = useCallback(async (announce: boolean) => {
    setLoading(true);
    try {
      const ws = await getWords();
      setRows(ws.map(toRow));
      if (announce) setMsg({ type: "ok", text: `お題を読み込みました（${ws.length}件）` });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ type: "err", text: `お題の取得に失敗しました。${err.message}`, detail: err.verboseDetail });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const plan = useMemo(() => buildPlan(rows), [rows]);
  const pending = planTotal(plan);
  const errors = useMemo(() => validateRows(rows), [rows]);

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  );
  const levels = useMemo(
    () => [...new Set(rows.map((r) => r.level))].sort((a, b) => a - b),
    [rows],
  );
  const levelCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of rows) if (!r.deleted) m.set(r.level, (m.get(r.level) ?? 0) + 1);
    return m;
  }, [rows]);

  const visible = useMemo(() => {
    const q = qText.trim().toLowerCase();
    return rows.filter((r) => {
      if (qLevel !== "" && r.level !== Number(qLevel)) return false;
      if (qCategory !== "" && r.category !== qCategory) return false;
      if (q && !r.text.toLowerCase().includes(q) && !r.reading.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, qText, qLevel, qCategory]);

  function patch(uid: string, p: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...p } : r)));
  }

  function addRow() {
    const level = qLevel !== "" ? Number(qLevel) : 0;
    const category = qCategory || "general";
    setRows((prev) => [emptyRow(level, category), ...prev]);
  }

  function toggleDelete(uid: string) {
    setRows((prev) =>
      prev.flatMap((r) => {
        if (r.uid !== uid) return [r];
        // 未保存の新規行は取り消し＝行ごと消す。
        if (!r.orig) return r.deleted ? [{ ...r, deleted: false }] : [];
        return [{ ...r, deleted: !r.deleted }];
      }),
    );
  }

  function onReload() {
    if (pending > 0 && !window.confirm("未保存の変更があります。破棄して読み直しますか？")) return;
    void load(true);
  }

  async function onSave() {
    if (errors.length) {
      setMsg({ type: "err", text: "入力エラーを直してください", detail: errors.map((e) => `・${e}`).join("\n") });
      return;
    }
    if (!token) {
      setMsg({ type: "err", text: "画面右上の「管理トークン」を入力してください" });
      return;
    }
    if (pending === 0) return;

    setSaving(true);
    setMsg(null);
    let upserted = false;
    try {
      // 1. 先に追加・更新。ここで (text, level) の新しい行ができる。
      if (plan.upserts.length) {
        await saveWords(plan.upserts, "upsert", token);
        upserted = true;
      }
      // 2. そのあと削除。順序が逆だと POST 失敗時に語が消える。
      for (const id of plan.deleteIds) {
        await deleteWord(id, token);
      }
      await load(false);
      setMsg({
        type: "ok",
        text:
          `保存しました（追加${plan.newCount} / 変更${plan.editedCount} / 語・Lv変更${plan.renamedCount} / 削除${plan.deletedCount}）。` +
          "次の試合から反映されます",
      });
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        type: "err",
        text: upserted
          ? `保存の途中で失敗しました。${err.message} 追加・変更は反映済みで、削除が終わっていない可能性があります。一覧を読み直して確認してください`
          : `保存に失敗しました。${err.message}`,
        detail: err.verboseDetail,
      });
      await load(false);
    } finally {
      setSaving(false);
    }
  }

  // --- 一括入力 -------------------------------------------------------------
  const bulkParsed = useMemo(() => parseBulk(bulkText), [bulkText]);

  function onBulkAdd() {
    if (!bulkParsed.rows.length) return;
    setRows((prev) => [...bulkParsed.rows, ...prev]);
    setBulkText("");
    setBulkOpen(false);
    setMsg({
      type: "info",
      text: `${bulkParsed.rows.length}件を追加リストに入れました。まだ保存していません（「保存」で反映）`,
    });
  }

  async function onBulkReplace() {
    if (!bulkParsed.rows.length) return;
    if (!token) {
      setMsg({ type: "err", text: "画面右上の「管理トークン」を入力してください" });
      return;
    }
    const answer = window.prompt(
      `⚠ 全置換です。\n\n現在の ${rows.filter((r) => !r.deleted).length} 件をすべて削除し、` +
        `貼り付けた ${bulkParsed.rows.length} 件だけにします。取り消せません。\n\n` +
        `実行するには REPLACE と入力してください。`,
    );
    if (answer !== "REPLACE") {
      setMsg({ type: "info", text: "全置換を中止しました" });
      return;
    }
    setSaving(true);
    try {
      await saveWords(
        bulkParsed.rows.map((r) => ({
          text: r.text,
          reading: r.reading,
          keystrokeCount: 0,
          level: r.level,
          category: r.category,
        })),
        "replace",
        token,
      );
      setBulkText("");
      setBulkOpen(false);
      await load(false);
      setMsg({ type: "ok", text: `全置換しました（${bulkParsed.rows.length}件）。次の試合から反映されます` });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ type: "err", text: `全置換に失敗しました。${err.message}`, detail: err.verboseDetail });
      await load(false);
    } finally {
      setSaving(false);
    }
  }

  const activeCount = rows.filter((r) => !r.deleted).length;

  return (
    <div>
      <Banner msg={msg} onClose={() => setMsg(null)} />

      <details className="card mb-4 p-4 text-sm">
        <summary className="cursor-pointer font-semibold">お題の編集について</summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-stone-700 dark:text-stone-300">
          <p>
            お題は<b>レベル（難度）</b>ごとに分かれていて、試合中の「火力」が上がるほど高いレベルの語が出ます。
            該当レベルに語がないと下のレベルから出るので、<b>レベルを飛ばして空にしない</b>のがコツです。
          </p>
          <p>
            <b>打鍵数</b>は空欄のままでかまいません（サーバーが読みから自動計算します）。
            <b>読み</b>を空にすると、お題の文字列がそのまま読みとして使われます。
          </p>
          <p className="text-amber-700 dark:text-amber-500">
            ⚠ <b>お題の文字列かレベルを変更した行</b>は、サーバーの仕組み上「新しい語を追加してから古い語を削除」する
            2段階の操作になります（オレンジの「語/Lv変更」マーク）。読み・分類・打鍵数だけの変更は1回で済みます。
          </p>
          <p>変更は「保存」を押すまでサーバーに送られません。反映は次の試合からです。</p>
        </div>
      </details>

      {/* ツールバー */}
      <div className="card mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={qText}
            onChange={(e) => setQText(e.target.value)}
            placeholder="🔍 お題・読みで絞り込み"
            className="min-w-[12rem] flex-1 rounded-lg border border-stone-300 px-3 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-950 dark:focus:ring-amber-900"
          />
          <select
            value={qLevel}
            onChange={(e) => setQLevel(e.target.value)}
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950"
            aria-label="レベルで絞り込み"
          >
            <option value="">全レベル</option>
            {levels.map((l) => (
              <option key={l} value={l}>
                Lv {l}（{levelCounts.get(l) ?? 0}）
              </option>
            ))}
          </select>
          <select
            value={qCategory}
            onChange={(e) => setQCategory(e.target.value)}
            className="rounded-lg border border-stone-300 px-2 py-1.5 text-sm dark:border-stone-700 dark:bg-stone-950"
            aria-label="分類で絞り込み"
          >
            <option value="">全分類</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={addRow} className="btn-ghost">
              ＋ 1件追加
            </button>
            <button onClick={() => setBulkOpen((v) => !v)} className="btn-ghost">
              一括入力
            </button>
            <button onClick={onReload} className="btn-ghost">
              再読込
            </button>
            <button onClick={onSave} disabled={saving || pending === 0 || errors.length > 0} className="btn-primary">
              {saving ? "保存中…" : pending > 0 ? `保存（${pending}件）` : "保存"}
            </button>
          </div>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
          <span>
            全 <b className="text-stone-700 dark:text-stone-200">{activeCount}</b> 件
            {visible.length !== rows.length ? `（表示 ${visible.length} 件）` : ""}
          </span>
          <span className="flex flex-wrap items-center gap-1">
            レベル分布:
            {levels.map((l) => (
              <span key={l} className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[10px] dark:bg-stone-800">
                {l}:{levelCounts.get(l) ?? 0}
              </span>
            ))}
          </span>
          {pending > 0 ? (
            <span className="text-amber-700 dark:text-amber-500">
              未保存 {pending}件（追加{plan.newCount} / 変更{plan.editedCount} / 語・Lv変更{plan.renamedCount} / 削除
              {plan.deletedCount}）
            </span>
          ) : null}
        </div>

        {errors.length > 0 ? (
          <ul className="mt-2 space-y-0.5 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-800 dark:bg-rose-950 dark:text-rose-200">
            {errors.map((e, i) => (
              <li key={i}>・{e}</li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* 一括入力 */}
      {bulkOpen ? (
        <div className="card mb-4 p-4">
          <h2 className="text-sm font-semibold">一括入力（CSV / TSV）</h2>
          <p className="mt-1 text-xs text-stone-500 dark:text-stone-400">
            1行1語で <code className="rounded bg-stone-100 px-1 dark:bg-stone-800">お題,読み,レベル,分類</code>{" "}
            の順。スプレッドシートからそのまま貼り付けられます（タブ区切りも可）。読みを省くとお題がそのまま読みになります。
          </p>
          <textarea
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
            rows={6}
            placeholder={"たこやき,たこやき,1,general\nなんでやねん,なんでやねん,3,general"}
            className="mt-2 w-full rounded-lg border border-stone-300 p-2 font-mono text-xs outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-950 dark:focus:ring-amber-900"
          />
          {bulkParsed.errors.length > 0 ? (
            <ul className="mt-2 space-y-0.5 rounded-lg bg-rose-50 p-2 text-[11px] text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {bulkParsed.errors.map((e, i) => (
                <li key={i}>・{e}</li>
              ))}
            </ul>
          ) : null}
          {bulkParsed.rows.length > 0 ? (
            <div className="mt-2">
              <p className="text-xs text-stone-500">解析結果 {bulkParsed.rows.length}件（先頭5件）:</p>
              <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-stone-600 dark:text-stone-300">
                {bulkParsed.rows.slice(0, 5).map((r) => (
                  <li key={r.uid}>
                    Lv{r.level} / {r.text}（{r.reading}）/ {r.category}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={onBulkAdd} disabled={!bulkParsed.rows.length} className="btn-primary">
              追加リストに入れる（{bulkParsed.rows.length}件）
            </button>
            <button
              onClick={onBulkReplace}
              disabled={!bulkParsed.rows.length || saving}
              className="btn-danger"
              title="既存のお題をすべて削除して、貼り付けた内容だけにする"
            >
              全置換して保存
            </button>
            <button onClick={() => setBulkOpen(false)} className="btn-ghost">
              閉じる
            </button>
          </div>
          <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-400">
            ⚠「全置換」は既存のお題をすべて削除します。取り消せません。
          </p>
        </div>
      ) : null}

      {/* 一覧 */}
      <div className="card overflow-hidden">
        {loading && rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-500">読み込み中…</div>
        ) : visible.length === 0 ? (
          <div className="p-10 text-center text-sm text-stone-500">
            {rows.length === 0 ? "お題がありません" : "条件に一致するお題がありません"}
          </div>
        ) : (
          // 見出しを固定するため、表そのものをスクロール領域にする（max-h + overflow-auto）。
          // ページ全体を基準に sticky させると、上部バーの高さ次第で見出しの位置がずれる。
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead className="sticky top-0 z-10 bg-stone-50 text-left text-[11px] text-stone-500 dark:bg-stone-800">
                <tr>
                  <th className="w-14 px-2 py-2 font-medium">Lv</th>
                  <th className="px-2 py-2 font-medium">お題（text）</th>
                  <th className="px-2 py-2 font-medium">読み（reading）</th>
                  <th className="w-20 px-2 py-2 font-medium">打鍵数</th>
                  <th className="w-32 px-2 py-2 font-medium">分類</th>
                  <th className="w-24 px-2 py-2 font-medium">状態</th>
                  <th className="w-16 px-2 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((r) => {
                  const st = rowState(r);
                  const style = STATE_STYLE[st];
                  const disabled = !!r.deleted;
                  return (
                    <tr
                      key={r.uid}
                      className={`border-t border-stone-200 dark:border-stone-800 ${style.row}`}
                    >
                      <td className="px-2 py-1.5">
                        <input
                          type="number"
                          min={0}
                          value={r.level}
                          disabled={disabled}
                          onChange={(e) => patch(r.uid, { level: e.target.valueAsNumber })}
                          aria-label="レベル"
                          className="w-full rounded border border-stone-300 px-1.5 py-1 text-right font-mono text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.text}
                          disabled={disabled}
                          onChange={(e) => patch(r.uid, { text: e.target.value })}
                          aria-label="お題"
                          className="w-full rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.reading}
                          disabled={disabled}
                          onChange={(e) => patch(r.uid, { reading: e.target.value })}
                          aria-label="読み"
                          placeholder="空欄ならお題と同じ"
                          className="w-full rounded border border-stone-300 px-2 py-1 text-sm disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.keystrokeCount}
                          disabled={disabled}
                          onChange={(e) => patch(r.uid, { keystrokeCount: e.target.value })}
                          aria-label="打鍵数"
                          placeholder="自動"
                          className="w-full rounded border border-stone-300 px-1.5 py-1 text-right font-mono text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <input
                          value={r.category}
                          disabled={disabled}
                          onChange={(e) => patch(r.uid, { category: e.target.value })}
                          aria-label="分類"
                          placeholder="general"
                          className="w-full rounded border border-stone-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        {style.badge ? (
                          <span
                            className={`badge ${style.tone}`}
                            title={
                              st === "renamed"
                                ? "追加してから古い語を削除する2段階の操作になります"
                                : undefined
                            }
                          >
                            {style.badge}
                          </span>
                        ) : (
                          <span className="text-[11px] text-stone-400">—</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <button
                          onClick={() => toggleDelete(r.uid)}
                          className={`text-xs hover:underline ${
                            r.deleted
                              ? "text-stone-500"
                              : "text-rose-600 dark:text-rose-400"
                          }`}
                        >
                          {r.deleted ? "戻す" : "削除"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
