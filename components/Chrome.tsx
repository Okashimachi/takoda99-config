"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { SERVER_BASE } from "@/lib/api";
import { getToken, setToken as persistToken } from "@/lib/storage";

// 管理トークンは2つのタブ（パラメータ / お題）で共有する。
const TokenContext = createContext<{
  token: string;
  setToken: (v: string) => void;
  ready: boolean;
}>({ token: "", setToken: () => {}, ready: false });

export function useToken() {
  return useContext(TokenContext);
}

const TABS = [
  { href: "/", label: "パラメータ", icon: "🎛️" },
  { href: "/words", label: "お題（words）", icon: "📝" },
];

export function Chrome({ children }: { children: React.ReactNode }) {
  const [token, setTokenState] = useState("");
  // localStorage はサーバー描画時に読めないので、読み込み完了まで入力欄を触らせない。
  const [ready, setReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setTokenState(getToken());
    setReady(true);
  }, []);

  function setToken(v: string) {
    setTokenState(v);
    persistToken(v);
  }

  return (
    <TokenContext.Provider value={{ token, setToken, ready }}>
      <div className="min-h-screen">
        <header className="sticky top-0 z-30 border-b border-stone-200 bg-white/90 backdrop-blur dark:border-stone-800 dark:bg-stone-900/90">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-xl leading-none" aria-hidden>
                🐙
              </span>
              <span className="text-[15px] font-bold tracking-tight">たこ焼き99 運営コンソール</span>
            </div>

            <a
              href={SERVER_BASE}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-stone-100 px-2 py-1 font-mono text-[11px] text-stone-600 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-400 dark:hover:bg-stone-700"
              title="接続先のゲームサーバー"
            >
              {SERVER_BASE.replace(/^https?:\/\//, "")}
            </a>

            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-stone-500 dark:text-stone-400">
                <span className="whitespace-nowrap">管理トークン</span>
                <input
                  type="password"
                  value={token}
                  disabled={!ready}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="保存時のみ必要"
                  autoComplete="off"
                  className="w-40 rounded-lg border border-stone-300 bg-white px-2 py-1 font-mono text-xs text-stone-900 outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-200 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-950 dark:text-stone-100 dark:focus:ring-amber-900"
                />
              </label>
              <span
                className={`badge ${
                  token
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
                    : "bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-400"
                }`}
                title={token ? "保存できます" : "閲覧のみ。保存にはトークンが要ります"}
              >
                {token ? "保存可" : "閲覧のみ"}
              </span>
            </div>
          </div>

          <nav className="mx-auto flex max-w-7xl gap-1 px-4">
            {TABS.map((t) => {
              const active = pathname === t.href;
              return (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition ${
                    active
                      ? "border-amber-500 text-amber-700 dark:text-amber-400"
                      : "border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-100"
                  }`}
                >
                  <span className="mr-1" aria-hidden>
                    {t.icon}
                  </span>
                  {t.label}
                </Link>
              );
            })}
          </nav>
        </header>

        <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>

        <footer className="mx-auto max-w-7xl px-4 pb-10 text-xs text-stone-400 dark:text-stone-600">
          値の正典は Takoda99-Server の <code>internal/game/params.go</code>。
          この画面はサーバーの <code>/api/params</code> と <code>/api/words</code> を直接叩いています。
        </footer>
      </div>
    </TokenContext.Provider>
  );
}
