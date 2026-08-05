"use client";

/**
 * 数値1項目の入力欄。ラベル・単位・説明・既定値・変更マーク・エラー表示をまとめて持つ。
 *
 * 値は「表示用の文字列」を親から受け取らず、number をそのまま扱う。
 * 空欄にした時は NaN を親へ渡し、検証側が「数値を入力してください」を出す。
 */
export function NumberField({
  label,
  value,
  defaultValue,
  unit,
  float,
  help,
  invalid,
  changed,
  showHelp = true,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  unit?: string;
  float?: boolean;
  help: string;
  invalid: boolean;
  changed: boolean;
  showHelp?: boolean;
  onChange: (v: number) => void;
}) {
  const border = invalid
    ? "border-rose-400 focus:ring-rose-200 dark:border-rose-700 dark:focus:ring-rose-900"
    : changed
      ? "border-amber-400 focus:ring-amber-200 dark:border-amber-600 dark:focus:ring-amber-900"
      : "border-stone-300 focus:ring-amber-200 dark:border-stone-700 dark:focus:ring-amber-900";

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline gap-1.5">
        {changed ? (
          <span
            className="-ml-2.5 text-amber-500"
            title="サーバーの値から変更されています（未保存）"
            aria-label="未保存の変更あり"
          >
            ●
          </span>
        ) : null}
        <span className="text-[13px] font-medium text-stone-700 dark:text-stone-200">{label}</span>
        {unit ? <span className="text-[11px] text-stone-400">{unit}</span> : null}
      </div>

      <div className="relative">
        <input
          type="number"
          inputMode={float ? "decimal" : "numeric"}
          step={float ? "any" : "1"}
          value={Number.isFinite(value) ? value : ""}
          onChange={(e) => onChange(e.target.valueAsNumber)}
          aria-label={label}
          aria-invalid={invalid}
          className={`field-input ${border}`}
        />
      </div>

      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px]">
        <span className="text-stone-400 dark:text-stone-600">既定 {defaultValue}</span>
        {changed ? (
          <button
            type="button"
            onClick={() => onChange(defaultValue)}
            className="text-amber-600 hover:underline dark:text-amber-500"
          >
            既定に戻す
          </button>
        ) : null}
      </div>

      {showHelp ? (
        <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">{help}</p>
      ) : null}
    </div>
  );
}
