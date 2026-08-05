"use client";

export type Msg = { type: "ok" | "err" | "info"; text: string; detail?: string } | null;

const TONE = {
  ok: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  err: "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200",
} as const;

const ICON = { ok: "✓", err: "!", info: "i" } as const;

export function Banner({ msg, onClose }: { msg: Msg; onClose?: () => void }) {
  if (!msg) return null;
  return (
    <div
      role={msg.type === "err" ? "alert" : "status"}
      className={`mb-4 flex animate-fade-in items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm ${TONE[msg.type]}`}
    >
      <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-current/10 text-xs font-bold">
        {ICON[msg.type]}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">{msg.text}</p>
        {msg.detail ? (
          <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all text-xs opacity-70">
            {msg.detail}
          </pre>
        ) : null}
      </div>
      {onClose ? (
        <button
          onClick={onClose}
          aria-label="閉じる"
          className="shrink-0 rounded px-1 text-lg leading-none opacity-50 hover:opacity-100"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
