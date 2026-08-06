// ゲームサーバー（Takoda99-Server）の HTTP API クライアント。
// 契約の正典は server の internal/configapi/{handler,words}.go。

import type { GameParameters } from "./params";

export const SERVER_BASE = (
  process.env.NEXT_PUBLIC_GAME_SERVER_URL ?? "https://takoda99.mooo.com"
).replace(/\/+$/, "");

export type WordEntry = {
  id?: number;
  text: string;
  reading: string;
  /** 0 ならサーバーが reading から算出する。 */
  keystrokeCount: number;
  level: number;
  category: string;
};

export type SaveMode = "upsert" | "replace";

/** ApiError は HTTP ステータスを運営に伝わる日本語へ正規化した例外。 */
export class ApiError extends Error {
  readonly status: number;
  /** サーバーが返した生の本文（400 の検証エラー詳細など）。 */
  readonly detail: string;

  constructor(status: number, message: string, detail = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
  }

  /**
   * verboseDetail は「画面に生の本文も出す価値があるか」を判断して返す。
   * 400/401 は message 側で十分に説明できているので、生の "unauthorized" 等を重ねて出さない。
   * 通信断(0)とサーバー内部エラー(5xx)だけは原因究明の手がかりになるので出す。
   */
  get verboseDetail(): string | undefined {
    if (this.status === NETWORK || this.status >= 500) return this.detail || undefined;
    return undefined;
  }
}

// status 0 は「HTTP まで到達しなかった」= ネットワーク or CORS。
const NETWORK = 0;

function messageFor(status: number, body: string, action: "load" | "save"): string {
  switch (status) {
    case 400:
      return `サーバーが値を受け付けませんでした: ${body.trim() || "(詳細なし)"}`;
    case 401:
      return "認証に失敗しました。管理トークンが違います。";
    case 404:
      return "対象が見つかりません。すでに削除済みかもしれません。";
    case 503:
      return "サーバーの管理機能が無効です（DATABASE_URL / CONFIG_ADMIN_TOKEN が未設定の可能性）。";
    default:
      return `${action === "load" ? "取得" : "保存"}に失敗しました (HTTP ${status})${
        body.trim() ? `: ${body.trim()}` : ""
      }`;
  }
}

async function request(
  path: string,
  init: RequestInit,
  action: "load" | "save",
): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${SERVER_BASE}${path}`, init);
  } catch (e) {
    // fetch の reject は「サーバーに届かなかった」か「CORS で読めなかった」の区別がつかない。
    // 運営が最初に疑うべきなのは CONFIG_FRONT_ORIGIN なので、そこへ誘導する。
    throw new ApiError(
      NETWORK,
      `サーバーに接続できませんでした（${SERVER_BASE}）。サーバーが起動しているか、` +
        `サーバー側の CONFIG_FRONT_ORIGIN にこの画面のURLが登録されているかを確認してください。`,
      String(e),
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ApiError(res.status, messageFor(res.status, body, action), body);
  }
  return res;
}

function authHeaders(token: string): HeadersInit {
  return { "Content-Type": "application/json", "X-Admin-Token": token };
}

// --- パラメータ -------------------------------------------------------------

/**
 * getParams は現在の GameParameters を**生の JSON のまま**返す。
 *
 * 型を付けずに unknown で返すのが重要：保存時にこのオブジェクトを土台にして
 * 未知フィールドを温存する（params.ts の applyEdits）ため、ここで型に押し込めない。
 */
export async function getParams(): Promise<unknown> {
  const res = await request("/api/params", { cache: "no-store" }, "load");
  return res.json();
}

/** saveParams は検証込みで保存し、**保存後の値**を返す（サーバーのレスポンスをそのまま採用する）。 */
export async function saveParams(params: GameParameters, token: string): Promise<unknown> {
  const res = await request(
    "/api/params",
    { method: "POST", headers: authHeaders(token), body: JSON.stringify(params) },
    "save",
  );
  return res.json();
}

// --- お題(words) ------------------------------------------------------------

export async function getWords(filter?: { category?: string; level?: number }): Promise<WordEntry[]> {
  const q = new URLSearchParams();
  if (filter?.category) q.set("category", filter.category);
  if (filter?.level !== undefined) q.set("level", String(filter.level));
  const qs = q.toString();
  const res = await request(`/api/words${qs ? `?${qs}` : ""}`, { cache: "no-store" }, "load");
  const json = (await res.json()) as WordEntry[] | null;
  return json ?? [];
}

/**
 * saveWords は語を保存し、保存後の**全件**を返す。
 *
 * ⚠ mode="replace" はサーバー側で DELETE FROM words を実行する。送っていない語は消える。
 * ⚠ 一意キーは (text, level) で id は使われない。text/level を変えたい場合は
 *    deleteWord してから upsert すること（words 画面がその2段を組み立てる）。
 */
export async function saveWords(
  words: WordEntry[],
  mode: SaveMode,
  token: string,
): Promise<WordEntry[]> {
  const res = await request(
    "/api/words",
    { method: "POST", headers: authHeaders(token), body: JSON.stringify({ mode, words }) },
    "save",
  );
  const json = (await res.json()) as WordEntry[] | null;
  return json ?? [];
}

export async function deleteWord(id: number, token: string): Promise<void> {
  await request(
    `/api/words/${id}`,
    { method: "DELETE", headers: { "X-Admin-Token": token } },
    "save",
  );
}
