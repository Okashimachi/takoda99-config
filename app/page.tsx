"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Banner, type Msg } from "@/components/Banner";
import { BoolField, NumberField } from "@/components/NumberField";
import { useToken } from "@/components/Chrome";
import { ApiError, getParams, getWords, saveParams } from "@/lib/api";
import {
  detectDrift,
  editableUnknown,
  exportFileName,
  parseImported,
  type Drift,
  type UnknownLeaf,
} from "@/lib/drift";
import {
  MAX_WORD_LEVEL,
  TIMING_LABEL,
  allBoolPaths,
  allFieldPaths,
  allFieldSpecs,
  applyEdits,
  defaultParameters,
  fillMissing,
  getNumber,
  getPath,
  schema,
  type EditValue,
  type FieldSpec,
  type GameParameters,
  type GroupSpec,
} from "@/lib/params";
import { riskWarnings, validate } from "@/lib/validate";
import {
  deletePreset,
  getHistory,
  getPresets,
  pushHistory,
  savePreset,
  type HistoryEntry,
  type Preset,
} from "@/lib/storage";

export default function ParamsPage() {
  const { token } = useToken();

  // サーバーから取った生JSON。保存時はこれを土台にするので、型を付けずに持つ
  // （customer.*.attribute の文字列やサーバー独自の未知フィールドを落とさないため）。
  const [serverRaw, setServerRaw] = useState<unknown>(null);
  const [edits, setEdits] = useState<Map<string, EditValue>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [presetName, setPresetName] = useState("");
  const [query, setQuery] = useState("");
  const [showHelp, setShowHelp] = useState(true);
  const [showJson, setShowJson] = useState(false);
  // お題辞書の実際の最大 level。heat.maxLevel の警告に使う（取れなければ既定値）。
  const [maxWordLevel, setMaxWordLevel] = useState(MAX_WORD_LEVEL);

  const fileInput = useRef<HTMLInputElement>(null);

  const serverParams = useMemo(() => fillMissing(serverRaw), [serverRaw]);
  const current = useMemo(() => applyEdits(serverParams, edits), [serverParams, edits]);

  // 🔴 ドリフト検出は **fillMissing を通す前の生JSON** に対してやる。
  // fillMissing 後だと欠けたパスが画面側の既定値で埋まってしまい、いちばん危ない
  // 「サーバーが返さない＝効かないツマミ」が検出できなくなる（lib/drift.ts 参照）。
  //
  // ⚠ **取得できていない間は検出しない。** serverRaw が null（読み込み中・取得失敗）のときに
  // 掛けると「全項目がサーバーに無い」＝ 61件のドリフトという嘘の警告が出て、
  // 本物のドリフトが埋もれる。
  const drift: Drift = useMemo(
    () =>
      serverRaw && typeof serverRaw === "object"
        ? detectDrift(serverRaw)
        : { unknown: [], missing: [] },
    [serverRaw],
  );
  const configHash = useMemo(() => {
    const v = getPath(serverRaw, "configHash");
    return typeof v === "string" ? v : undefined;
  }, [serverRaw]);

  // この画面が知らないが編集はできるリーフ（数値・真偽値）。差分・保存の対象に含める。
  const unknownEditable = useMemo(() => editableUnknown(drift), [drift]);
  const extraNumberPaths = useMemo(
    () => unknownEditable.filter((u) => u.kind === "number").map((u) => u.path),
    [unknownEditable],
  );
  const extraBoolPaths = useMemo(
    () => unknownEditable.filter((u) => u.kind === "boolean").map((u) => u.path),
    [unknownEditable],
  );

  const errors = useMemo(() => validate(current), [current]);
  const errorPaths = useMemo(
    () => new Set(errors.map((e) => e.path).filter(Boolean) as string[]),
    [errors],
  );

  const specs = useMemo(() => allFieldSpecs(), []);
  const diffs = useMemo(() => {
    const out: { path: string; label: string; from: number | boolean; to: number | boolean }[] = [];
    for (const path of [...allFieldPaths(), ...extraNumberPaths]) {
      const from = getNumber(serverParams, path);
      const to = getNumber(current, path);
      if (from !== to && !(Number.isNaN(from) && Number.isNaN(to))) {
        out.push({ path, label: specs.get(path)?.label ?? path, from, to });
      }
    }
    // 真偽値（publish.rankingDeltaEnabled）も差分に載せる。載せないと
    // トグルを切り替えても「未保存の変更」に出ず、保存ボタンが有効にならない。
    for (const path of [...allBoolPaths(), ...extraBoolPaths]) {
      const from = getPath(serverParams, path) === true;
      const to = getPath(current, path) === true;
      if (from !== to) {
        out.push({ path, label: specs.get(path)?.label ?? path, from, to });
      }
    }
    return out;
  }, [serverParams, current, specs, extraNumberPaths, extraBoolPaths]);
  const changedPaths = useMemo(() => new Set(diffs.map((d) => d.path)), [diffs]);
  const dirty = diffs.length > 0;

  const load = useCallback(
    async (announce: boolean) => {
      setLoading(true);
      try {
        const raw = await getParams();
        setServerRaw(raw);
        setEdits(new Map());
        if (announce) setMsg({ type: "ok", text: "サーバーの現在値を読み込みました" });
      } catch (e) {
        const err = e as ApiError;
        setMsg({
          type: "err",
          text: `現在値の取得に失敗しました。${err.message}`,
          detail: err.verboseDetail,
        });
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setPresets(getPresets());
    setHistory(getHistory());
    void load(false);
    // お題の最大レベルは警告の精度を上げるためのおまけ。失敗しても無視する。
    void getWords()
      .then((ws) => {
        if (ws.length) setMaxWordLevel(Math.max(...ws.map((w) => w.level)));
      })
      .catch(() => {});
  }, [load]);

  function setField(path: string, value: EditValue) {
    setEdits((prev) => {
      const next = new Map(prev);
      next.set(path, value);
      return next;
    });
  }

  /** loadInto は「別の値一式」を編集中の状態として読み込む（プリセット・履歴・既定に戻す・インポート）。 */
  function loadInto(p: GameParameters, note: string) {
    const next = new Map<string, EditValue>();
    for (const path of [...allFieldPaths(), ...extraNumberPaths]) {
      const v = getNumber(p, path);
      if (Number.isFinite(v)) next.set(path, v);
    }
    for (const path of [...allBoolPaths(), ...extraBoolPaths]) {
      const v = getPath(p, path);
      if (typeof v === "boolean") next.set(path, v);
    }
    setEdits(next);
    setMsg({ type: "info", text: `${note}。まだ保存していません（反映するには「保存」）` });
  }

  /**
   * 未保存のまま画面を離れようとしたら確認する（plan-h35 §3.2）。
   *
   * 当日は焦って画面を離れる。「変えたつもりで保存していない」は設定事故の定番で、
   * しかも**気付くのが次の試合になってから**なので取り返しがつかない。
   */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // 旧仕様のブラウザ向け。文言はブラウザ側が固定のものを出す。
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /**
   * onExport は現在の値を JSON ファイルに書き出す（plan-h35 §3.3）。
   *
   * プリセットも履歴も **この端末の localStorage にしか無い**ので、当日に別のPCへ
   * 引き継ぐ手段がこれ。current はサーバー由来の未知フィールドも保持しているので、
   * 書き出した JSON はそのまま別端末で読み込める。
   */
  function onExport() {
    try {
      const blob = new Blob([JSON.stringify(current, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFileName(configHash);
      a.click();
      URL.revokeObjectURL(url);
      setMsg({ type: "ok", text: `現在の値を ${a.download} に書き出しました` });
    } catch (e) {
      setMsg({ type: "err", text: "書き出しに失敗しました", detail: String(e) });
    }
  }

  async function onImportFile(file: File) {
    const parsed = parseImported(await file.text());
    if ("error" in parsed) {
      setMsg({ type: "err", text: `読み込めませんでした（${file.name}）`, detail: parsed.error });
      return;
    }
    loadInto(parsed.params, `${file.name} を読み込みました`);
  }

  function onReload() {
    if (dirty && !window.confirm("未保存の変更があります。破棄してサーバーの現在値を読み直しますか？")) {
      return;
    }
    void load(true);
  }

  async function onSave() {
    if (errors.length) {
      setMsg({ type: "err", text: "入力エラーを直してください", detail: errors.map((e) => `・${e.message}`).join("\n") });
      return;
    }
    if (!token) {
      setMsg({ type: "err", text: "画面右上の「管理トークン」を入力してください（保存にのみ必要です）" });
      return;
    }
    const risks = riskWarnings(current, maxWordLevel);
    if (
      risks.length &&
      !window.confirm(`次の値は注意が必要です。\n\n・${risks.join("\n\n・")}\n\nこのまま保存しますか？`)
    ) {
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      const saved = await saveParams(current, token);
      setServerRaw(saved);
      setEdits(new Map());
      setHistory(pushHistory(fillMissing(saved)));
      const live = diffs.some((d) => d.path.startsWith("matching."));
      setMsg({
        type: "ok",
        text: live
          ? "保存しました。マッチング系は数秒で反映、それ以外は次の試合から反映されます"
          : "保存しました。次の試合から反映されます（進行中の試合は変わりません）",
      });
    } catch (e) {
      const err = e as ApiError;
      setMsg({ type: "err", text: err.message, detail: err.verboseDetail });
    } finally {
      setSaving(false);
    }
  }

  function onSavePreset() {
    const name = presetName.trim();
    if (!name) {
      setMsg({ type: "err", text: "プリセット名を入力してください" });
      return;
    }
    setPresets(savePreset(name, current));
    setPresetName("");
    setMsg({ type: "ok", text: `プリセット「${name}」をこの端末に保存しました` });
  }

  // 検索: ラベル・説明・パスのどれかに一致した項目だけを残す。
  const q = query.trim().toLowerCase();
  const matches = useCallback(
    (f: { path: string; label: string; help: string }) =>
      !q ||
      f.label.toLowerCase().includes(q) ||
      f.help.toLowerCase().includes(q) ||
      f.path.toLowerCase().includes(q),
    [q],
  );

  const visibleGroups = useMemo(() => {
    if (!q) return schema;
    return schema.filter((g) => {
      const inFields = (g.fields ?? []).some(matches);
      const inSubs = (g.subgroups ?? []).some((sg) => sg.fields.some(matches));
      const inMatrix = (g.matrices ?? []).some(
        (mx) =>
          g.title.toLowerCase().includes(q) ||
          mx.title.toLowerCase().includes(q) ||
          mx.cols.some((c) => c.label.toLowerCase().includes(q) || c.help.toLowerCase().includes(q)),
      );
      return inFields || inSubs || inMatrix || g.title.toLowerCase().includes(q);
    });
  }, [q, matches]);

  const fieldProps = (f: FieldSpec) => ({
    label: f.label,
    unit: f.unit,
    float: f.float,
    help: f.help,
    value: getNumber(current, f.path),
    defaultValue: getNumber(defaultParameters, f.path),
    invalid: errorPaths.has(f.path),
    changed: changedPaths.has(f.path),
    showHelp,
    onChange: (v: number) => setField(f.path, v),
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      {/* ---- 本体 ---- */}
      <div className="min-w-0">
        <Banner msg={msg} onClose={() => setMsg(null)} />

        <Intro />

        {/* 走っている設定の身元（plan-h35 §3.1）＋ 持ち出し（§3.3） */}
        <div className="card mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
          <span className="text-[11px] font-medium text-stone-500 dark:text-stone-400">
            サーバーの設定ID
          </span>
          <code
            className="rounded-md bg-stone-100 px-2 py-1 font-mono text-[13px] font-semibold text-stone-700 dark:bg-stone-800 dark:text-stone-200"
            title="configHash。サーバーが返している現在の設定のハッシュ。保存すると変わるので「保存が本当に届いたか」「他の人と同じ設定を見ているか」の照合に使える"
          >
            {loading && !serverRaw ? "…" : (configHash ?? "（サーバーが返していません）")}
          </code>
          {dirty ? (
            <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              未保存 {diffs.length}件
            </span>
          ) : serverRaw ? (
            <span className="badge bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              サーバーと一致
            </span>
          ) : null}

          <div className="ml-auto flex gap-2">
            <button onClick={onExport} className="btn-ghost px-2 py-1 text-xs" title="現在の値を JSON ファイルに書き出す（別の端末へ引き継ぐ用）">
              JSONで書き出し
            </button>
            <button
              onClick={() => fileInput.current?.click()}
              className="btn-ghost px-2 py-1 text-xs"
              title="書き出した JSON を編集欄に読み込む（保存は別途「保存」ボタン）"
            >
              JSONを読み込み
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = ""; // 同じファイルを続けて選べるように
                if (f) void onImportFile(f);
              }}
            />
          </div>
          <p className="w-full text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
            プリセットと変更履歴は<b>この端末の localStorage にしかありません</b>。
            別のPCやブラウザから開くと消えます。当日に誰かへ引き継ぐなら「JSONで書き出し」を使ってください。
          </p>
        </div>

        <DriftBanner drift={drift} />

        {/* 検索・表示切替 */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-400">
              🔍
            </span>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="項目を検索（例: スコア / 足切り / 人数 / Bot）"
              className="w-full rounded-lg border border-stone-300 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-900 dark:focus:ring-amber-900"
            />
          </div>
          <button onClick={() => setShowHelp((v) => !v)} className="btn-ghost whitespace-nowrap">
            {showHelp ? "説明を隠す" : "説明を表示"}
          </button>
        </div>

        {loading && !serverRaw ? (
          <div className="card p-10 text-center text-sm text-stone-500">読み込み中…</div>
        ) : (
          <div className="space-y-4">
            {visibleGroups.map((g) => (
              <GroupCard key={g.key} group={g}>
                {/* 直下のフィールド */}
                {g.fields && g.fields.filter(matches).length > 0 ? (
                  <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                    {g.fields.filter(matches).map((f) =>
                      f.bool ? (
                        <BoolField
                          key={f.path}
                          label={f.label}
                          help={f.help}
                          showHelp={showHelp}
                          changed={changedPaths.has(f.path)}
                          value={getPath(current, f.path) === true}
                          onChange={(v) => setField(f.path, v)}
                        />
                      ) : (
                        <NumberField key={f.path} {...fieldProps(f)} />
                      ),
                    )}
                  </div>
                ) : null}

                {/* 行×列の表（customer は「属性別」と「注文数の段階」の2つ・h36） */}
                {(g.matrices ?? []).map((mx) => (
                  <div key={mx.title} className="mt-5">
                    <h3 className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">
                      {mx.title}
                    </h3>
                    <p className="mb-2 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                      {mx.desc}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-10 bg-white py-1.5 pr-3 text-left text-[11px] font-medium text-stone-500 dark:bg-stone-900">
                              {mx.rowHeader ?? "属性"}
                            </th>
                            {mx.cols.map((c) => (
                              <th
                                key={c.key}
                                title={c.help}
                                className="px-1.5 py-1.5 text-right text-[11px] font-medium text-stone-500"
                              >
                                {c.label}
                                {c.unit ? <span className="ml-1 text-stone-400">{c.unit}</span> : null}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {mx.rows.map((r) => (
                            <tr key={r.key} className="align-top">
                              <td className="sticky left-0 z-10 bg-white py-1.5 pr-3 dark:bg-stone-900">
                                <div className="text-[13px] font-medium text-stone-700 dark:text-stone-200">
                                  {r.label}
                                </div>
                                {showHelp ? (
                                  <div className="text-[11px] text-stone-500 dark:text-stone-400">{r.note}</div>
                                ) : null}
                              </td>
                              {mx.cols.map((c) => {
                                const path = mx.pathOf(r.key, c.key);
                                const changed = changedPaths.has(path);
                                const invalid = errorPaths.has(path);
                                const v = getNumber(current, path);
                                if (c.readonly) {
                                  return (
                                    <td key={c.key} className="w-28 px-1.5 py-1.5">
                                      <div
                                        className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-2 py-1.5 text-right font-mono text-[13px] text-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-400"
                                        title="企画で確定した値のため変更できません"
                                      >
                                        {Number.isFinite(v) ? v.toLocaleString("ja-JP") : "–"}
                                      </div>
                                    </td>
                                  );
                                }
                                return (
                                  <td key={c.key} className="w-28 px-1.5 py-1.5">
                                    <div className="flex items-center gap-1">
                                      {changed ? (
                                        <span className="text-amber-500" title="未保存の変更">
                                          ●
                                        </span>
                                      ) : null}
                                      <input
                                        type="number"
                                        step={c.float ? "any" : "1"}
                                        inputMode={c.float ? "decimal" : "numeric"}
                                        aria-label={`${r.label} ${c.label}`}
                                        aria-invalid={invalid}
                                        value={Number.isFinite(v) ? v : ""}
                                        onChange={(e) => setField(path, e.target.valueAsNumber)}
                                        className={`field-input ${
                                          invalid
                                            ? "border-rose-400 focus:ring-rose-200 dark:border-rose-700"
                                            : changed
                                              ? "border-amber-400 focus:ring-amber-200 dark:border-amber-600"
                                              : "border-stone-300 focus:ring-amber-200 dark:border-stone-700"
                                        }`}
                                      />
                                    </div>
                                    <div className="mt-0.5 text-right text-[10px] text-stone-400 dark:text-stone-600">
                                      既定 {getNumber(defaultParameters, path)}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {/* サブグループ（credit.leaveLoss） */}
                {(g.subgroups ?? []).map((sg) =>
                  sg.fields.filter(matches).length === 0 ? null : (
                    <div
                      key={sg.title}
                      className="mt-5 rounded-lg border border-stone-200 bg-stone-50 p-3.5 dark:border-stone-800 dark:bg-stone-950/60"
                    >
                      <h3 className="text-[13px] font-semibold text-stone-700 dark:text-stone-200">
                        {sg.title}
                      </h3>
                      {sg.desc ? (
                        <p className="mb-3 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                          {sg.desc}
                        </p>
                      ) : null}
                      <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-4">
                        {sg.fields.filter(matches).map((f) => (
                          <NumberField key={f.path} {...fieldProps(f)} />
                        ))}
                      </div>
                    </div>
                  ),
                )}
              </GroupCard>
            ))}

            {/* この画面が知らない項目（plan-h35 §4）。スキーマに写す前でも触れるようにする。 */}
            {drift.unknown.length > 0 ? (
              <section id="drift" className="card border-amber-300 p-4 dark:border-amber-800 sm:p-5">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <span className="text-lg leading-none" aria-hidden>
                    🧩
                  </span>
                  <h2 className="text-[15px] font-bold">未対応の項目（{drift.unknown.length}件）</h2>
                  <span className="badge bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    自動表示
                  </span>
                </div>
                <p className="mb-4 text-xs leading-relaxed text-stone-500 dark:text-stone-400">
                  サーバーは返しているが、この画面のスキーマ（<code>lib/params.ts</code>）に写していない項目。
                  ラベルもヘルプも無い素の状態だが、<b>触れないよりはるかにマシ</b>なので自動で出している。
                  落ち着いたら <code>lib/params.ts</code> に正式に足すこと（このカードはその宿題のリマインダー）。
                </p>
                <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2 xl:grid-cols-3">
                  {drift.unknown.map((u) => (
                    <UnknownField
                      key={u.path}
                      leaf={u}
                      value={getPath(current, u.path)}
                      changed={changedPaths.has(u.path)}
                      onChange={(v) => setField(u.path, v)}
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {visibleGroups.length === 0 && drift.unknown.length === 0 ? (
              <div className="card p-10 text-center text-sm text-stone-500">
                「{query}」に一致する項目はありません
              </div>
            ) : null}
          </div>
        )}
      </div>

      {/* ---- サイド ---- */}
      <aside className="space-y-4 lg:sticky lg:top-28 lg:self-start">
        {/* 保存パネル */}
        <div className="card p-4">
          <div className="mb-2 flex items-baseline justify-between gap-2 text-[11px] text-stone-500 dark:text-stone-400">
            <span>サーバーの設定ID</span>
            <code className="font-mono text-stone-600 dark:text-stone-300" title="configHash">
              {configHash ?? "—"}
            </code>
          </div>
          <div className="mb-3 text-sm">
            {dirty ? (
              <details open>
                <summary className="cursor-pointer font-semibold text-amber-700 dark:text-amber-500">
                  未保存の変更 {diffs.length}件
                </summary>
                <ul className="mt-2 max-h-52 space-y-1 overflow-auto pr-1 text-[11px]">
                  {diffs.map((d) => (
                    <li key={d.path} className="flex items-baseline gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-stone-600 dark:text-stone-300" title={d.path}>
                        {d.label}
                      </span>
                      <span className="shrink-0 font-mono text-stone-400 line-through">{fmt(d.from)}</span>
                      <span className="shrink-0 font-mono font-semibold text-amber-700 dark:text-amber-500">
                        {fmt(d.to)}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              <span className="text-emerald-700 dark:text-emerald-400">✓ サーバーの値と一致しています</span>
            )}
          </div>

          {errors.length > 0 ? (
            <ul className="mb-3 max-h-40 space-y-1 overflow-auto rounded-lg bg-rose-50 p-2.5 text-[11px] text-rose-800 dark:bg-rose-950 dark:text-rose-200">
              {errors.map((e, i) => (
                <li key={i}>・{e.message}</li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button onClick={onSave} disabled={saving || errors.length > 0 || !dirty} className="btn-primary flex-1">
              {saving ? "保存中…" : dirty ? `保存（${diffs.length}件）` : "保存"}
            </button>
            <button onClick={onReload} className="btn-ghost" title="サーバーの現在値を取得し直す">
              再読込
            </button>
            <button
              onClick={() => loadInto(defaultParameters, "既定値を読み込みました")}
              className="btn-ghost"
              title="サーバー内蔵のデフォルト値を編集欄に入れる"
            >
              既定に戻す
            </button>
          </div>
          {!token ? (
            <p className="mt-2 text-[11px] text-stone-500 dark:text-stone-400">
              保存には画面右上の管理トークンが必要です。
            </p>
          ) : null}
        </div>

        {/* プリセット */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold">
            プリセット
            <span className="ml-1 font-normal text-stone-400">（この端末）</span>
          </h2>
          <div className="mt-2 flex gap-2">
            <input
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
              placeholder="名前（例: 少人数テスト）"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-amber-200 dark:border-stone-700 dark:bg-stone-950 dark:focus:ring-amber-900"
            />
            <button onClick={onSavePreset} className="btn-ghost shrink-0 px-2 py-1 text-xs">
              現在値を保存
            </button>
          </div>
          {presets.length > 0 ? (
            <ul className="mt-2 space-y-1 text-sm">
              {presets.map((p) => (
                <li key={p.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate" title={p.name}>
                    {p.name}
                  </span>
                  <button
                    onClick={() => loadInto(p.params, `プリセット「${p.name}」を読み込みました`)}
                    className="text-xs text-amber-700 hover:underline dark:text-amber-500"
                  >
                    読込
                  </button>
                  <button
                    onClick={() => setPresets(deletePreset(p.name))}
                    className="text-xs text-rose-600 hover:underline dark:text-rose-400"
                  >
                    削除
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-stone-400">まだありません</p>
          )}
        </div>

        {/* 変更履歴 */}
        <div className="card p-4">
          <h2 className="text-sm font-semibold">
            変更履歴
            <span className="ml-1 font-normal text-stone-400">（この端末・保存時）</span>
          </h2>
          {history.length > 0 ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm">
              {history.map((h, i) => (
                <li key={i} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-stone-600 dark:text-stone-300">
                    {new Date(h.at).toLocaleString("ja-JP")}
                  </span>
                  <button
                    onClick={() => loadInto(h.params, `${new Date(h.at).toLocaleString("ja-JP")} の値を読み込みました`)}
                    className="shrink-0 text-xs text-amber-700 hover:underline dark:text-amber-500"
                  >
                    戻す
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs text-stone-400">保存するとここに残ります</p>
          )}
        </div>

        {/* JSON */}
        <div className="card p-4">
          <button
            onClick={() => setShowJson((v) => !v)}
            className="flex w-full items-center justify-between text-sm font-semibold"
          >
            <span>JSON プレビュー</span>
            <span className="text-stone-400">{showJson ? "−" : "+"}</span>
          </button>
          {showJson ? (
            <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-stone-900 p-3 text-[11px] leading-relaxed text-stone-100 dark:bg-black">
              {JSON.stringify(current, null, 2)}
            </pre>
          ) : null}
        </div>
      </aside>
    </div>
  );
}

/**
 * DriftBanner はサーバーとこの画面のスキーマのズレを**両方向**で出す（plan-h35 §4）。
 *
 * 🔴 2026-08-16 の事故（heat.perElapsedSec の既定値がサーバーと画面でズレていて、
 * DB に無いキーが画面側の値で補完・保存された）を、画面上で見えるようにするのが目的。
 *
 * 片方向だけでは足りない:
 *   ・サーバーが返すのに画面が知らない → 触れないだけ（下の「未対応の項目」で救済）
 *   ・画面が持つのにサーバーが返さない → **効かないツマミ**。しかも保存すると
 *     画面側の既定値がそのまま本番DBへ書き込まれる。こちらのほうが危ない
 */
function DriftBanner({ drift }: { drift: Drift }) {
  if (drift.unknown.length === 0 && drift.missing.length === 0) return null;
  return (
    <div className="mb-4 space-y-3">
      {drift.unknown.length > 0 ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-medium">
            ⚠ この画面が知らない項目が {drift.unknown.length} 件あります
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            サーバーが先に更新されて、この画面がまだ追いついていない状態です。保存で値が落ちることはありません。
            下の<a href="#drift" className="underline">「未対応の項目」</a>から素の入力欄で変更できます。
          </p>
          <p className="mt-1 break-all font-mono text-[11px] opacity-80">
            {drift.unknown.map((u) => u.path).join(" / ")}
          </p>
        </div>
      ) : null}

      {drift.missing.length > 0 ? (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-3.5 py-2.5 text-sm text-rose-900 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200">
          <p className="font-medium">
            🔴 この画面にあるのにサーバーが返していない項目が {drift.missing.length} 件あります（効かないツマミ）
          </p>
          <p className="mt-1 text-xs leading-relaxed">
            サーバーが古い（まだデプロイされていない）か、その項目が削除されています。
            <b>
              これらの欄には今この画面の既定値が入っており、このまま保存するとその値が本番DBへ書き込まれます。
            </b>
            2026-08-16 に <code>heat.perElapsedSec</code> でこれが起き、本番が意図と違う値で走りました。
            心当たりが無ければ<b>保存せずに</b>サーバー側の担当へ確認してください。
          </p>
          <p className="mt-1 break-all font-mono text-[11px] opacity-80">
            {drift.missing.join(" / ")}
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * UnknownField はスキーマに無いリーフの素の入力欄。
 * 型に応じて数値入力／トグル／読み取り専用テキストを出す（plan-h35 §4.2）。
 */
function UnknownField({
  leaf,
  value,
  changed,
  onChange,
}: {
  leaf: UnknownLeaf;
  value: unknown;
  changed: boolean;
  onChange: (v: EditValue) => void;
}) {
  const label = (
    <div className="mb-1 flex items-baseline gap-1.5">
      {changed ? (
        <span className="-ml-2.5 text-amber-500" title="未保存の変更">
          ●
        </span>
      ) : null}
      <code className="min-w-0 break-all text-[12px] font-medium text-stone-700 dark:text-stone-200">
        {leaf.path}
      </code>
    </div>
  );

  if (leaf.kind === "boolean") {
    return (
      <div className="min-w-0">
        {label}
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-label={leaf.path}
            className="h-4 w-4 rounded border-stone-300 text-amber-600 focus:ring-amber-200 dark:border-stone-600"
          />
          <span className="font-mono text-[11px] text-stone-500 dark:text-stone-400">
            {value === true ? "ON" : "OFF"}
          </span>
        </label>
      </div>
    );
  }

  if (leaf.kind === "number") {
    const v = typeof value === "number" ? value : Number.NaN;
    return (
      <div className="min-w-0">
        {label}
        <input
          type="number"
          step="any"
          inputMode="decimal"
          aria-label={leaf.path}
          value={Number.isFinite(v) ? v : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          className={`field-input ${
            changed
              ? "border-amber-400 focus:ring-amber-200 dark:border-amber-600"
              : "border-stone-300 focus:ring-amber-200 dark:border-stone-700"
          }`}
        />
        <div className="mt-1 text-[11px] text-stone-400 dark:text-stone-600">
          サーバーの値 {String(leaf.value)}
        </div>
      </div>
    );
  }

  // 文字列・その他は読み取り専用（型が分からないものを編集させると壊せてしまう）。
  return (
    <div className="min-w-0">
      {label}
      <div className="rounded-md border border-dashed border-stone-300 bg-stone-50 px-2 py-1.5 font-mono text-[12px] text-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:text-stone-400">
        {JSON.stringify(leaf.value)}
      </div>
      <div className="mt-1 text-[11px] text-stone-400 dark:text-stone-600">
        この型はこの画面から編集できません（保存時もそのまま送られます）
      </div>
    </div>
  );
}

function fmt(v: number | boolean): string {
  if (typeof v === "boolean") return v ? "ON" : "OFF";
  return Number.isFinite(v) ? String(v) : "—";
}

function GroupCard({ group, children }: { group: GroupSpec; children: React.ReactNode }) {
  const timing = TIMING_LABEL[group.timing];
  return (
    <section id={group.key} className="card p-4 sm:p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="text-lg leading-none" aria-hidden>
          {group.icon}
        </span>
        <h2 className="text-[15px] font-bold">{group.title}</h2>
        <span className={`badge ${timing.tone}`} title={timing.title}>
          {timing.text}
        </span>
        <code className="ml-auto text-[10px] text-stone-400">{group.key}</code>
      </div>
      <p className="mb-4 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{group.desc}</p>
      {children}
    </section>
  );
}

function Intro() {
  return (
    <details className="card mb-4 p-4 text-sm">
      <summary className="cursor-pointer font-semibold">はじめに / 反映タイミング</summary>
      <div className="mt-3 space-y-3 text-stone-700 dark:text-stone-300">
        <p className="text-xs leading-relaxed">
          <b>ゲームの流れ:</b>{" "}
          客が店の行列に並ぶ → お題を打って提供する →{" "}
          <b>スコア</b>が加算される（たこ焼き数 × 加点 − ミス数 × 減点）→{" "}
          <b>20秒ごとにスコア下位から強制脱落</b>（99→75→55→35→20→10）→{" "}
          <b>120秒で全店が脱落して終了</b>。その時点のスコア1位が優勝。
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[30rem] text-xs">
            <thead>
              <tr className="text-left text-stone-500">
                <th className="py-1 pr-3 font-medium">変更した場所</th>
                <th className="py-1 font-medium">いつ効くか</th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr className="border-t border-stone-200 dark:border-stone-800">
                <td className="py-1.5 pr-3">マッチング</td>
                <td className="py-1.5">
                  <b className="text-emerald-700 dark:text-emerald-400">数秒で反映</b>
                  ・サーバー再起動は不要
                </td>
              </tr>
              <tr className="border-t border-stone-200 dark:border-stone-800">
                <td className="py-1.5 pr-3">それ以外のパラメータ・お題</td>
                <td className="py-1.5">次の試合から</td>
              </tr>
              <tr className="border-t border-stone-200 dark:border-stone-800">
                <td className="py-1.5 pr-3">進行中の試合</td>
                <td className="py-1.5 text-stone-500">変わりません</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs leading-relaxed text-stone-500 dark:text-stone-400">
          ⚠ 当日 <b>試合中にサーバーを再起動すると進行中の試合が消えます</b>。
          マッチングの値を変えるのに再起動は要りません。
        </p>
      </div>
    </details>
  );
}
