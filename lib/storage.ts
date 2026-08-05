// プリセット・変更履歴・管理トークンの永続化。
// **この端末の localStorage のみ**（サーバー共有ではない）。共有・監査が要るなら別課題。
//
// キーは takoda99- 始まり。Textro99 の config-front が t99- を使っているので、
// 同じブラウザで両方開いても混ざらないようにしてある。

import type { GameParameters } from "./params";

const TOKEN_KEY = "takoda99-admin-token";
const PRESETS_KEY = "takoda99-presets";
const HISTORY_KEY = "takoda99-history";
const HISTORY_MAX = 20;

export type Preset = { name: string; params: GameParameters; savedAt: string };
export type HistoryEntry = { at: string; params: GameParameters };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback; // プライベートモード等で localStorage が使えなくても動かす
  }
}

function write(key: string, v: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* 無視 */
  }
}

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setToken(v: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, v);
  } catch {
    /* 無視 */
  }
}

export function getPresets(): Preset[] {
  return read<Preset[]>(PRESETS_KEY, []);
}

/** savePreset は同名を上書きし、先頭に置いた一覧を返す。 */
export function savePreset(name: string, params: GameParameters): Preset[] {
  const list = getPresets().filter((p) => p.name !== name);
  list.unshift({ name, params, savedAt: new Date().toISOString() });
  write(PRESETS_KEY, list);
  return list;
}

export function deletePreset(name: string): Preset[] {
  const list = getPresets().filter((p) => p.name !== name);
  write(PRESETS_KEY, list);
  return list;
}

export function getHistory(): HistoryEntry[] {
  return read<HistoryEntry[]>(HISTORY_KEY, []);
}

/** pushHistory は保存成功時に呼ぶ。最新を先頭に、最大 HISTORY_MAX 件。 */
export function pushHistory(params: GameParameters): HistoryEntry[] {
  const list = getHistory();
  list.unshift({ at: new Date().toISOString(), params });
  const trimmed = list.slice(0, HISTORY_MAX);
  write(HISTORY_KEY, trimmed);
  return trimmed;
}
