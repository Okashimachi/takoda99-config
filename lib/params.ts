// GameParameters の TS ミラーと、画面描画用のスキーマ。
//
// 正典は server の internal/game/params.go。フィールドを増減したら両方を揃える（手動同期）。
// Textro99 の config-front はグループ→フィールドの2階層フラットだったが、Takoda99 は
// credit.leaveLoss.* / customer.{属性}.* が3階層になったので、**ドット区切りパス**で扱う。

export type CustomerAttribute = "Normal" | "Bonus" | "Claimer" | "Buzz";

export type AttributeSpec = {
  attribute: CustomerAttribute;
  weight: number;
  patienceBaseMs: number;
  orderCount: number;
};

export type GameParameters = {
  session: { tickIntervalMs: number; publishIntervalMs: number };
  matching: {
    minPlayers: number;
    maxPlayers: number;
    startCountdownMs: number;
    rosterWaitMs: number;
    readyCountdownMs: number;
    minFill: number;
  };
  credit: {
    initialLife: number;
    leaveLoss: { normal: number; bonus: number; claimer: number; buzz: number };
  };
  customer: {
    total: number;
    normal: AttributeSpec;
    bonus: AttributeSpec;
    claimer: AttributeSpec;
    buzz: AttributeSpec;
  };
  eval: {
    emaAlpha: number;
    weightAccuracy: number;
    weightSpeed: number;
    speedBaselineMs: number;
    speedCap: number;
    minMsPerWord: number;
    buzzBonus: number;
    buzzDecay: number;
    buzzCap: number;
  };
  phase: {
    midAliveThreshold: number;
    lateAliveThreshold: number;
    midTimeMs: number;
    lateTimeMs: number;
  };
  heat: {
    base: number;
    perAliveDrop: number;
    phaseEarly: number;
    phaseMid: number;
    phaseLate: number;
    maxLevel: number;
  };
  storm: { intervalTicks: number; warnTicks: number; thresholdPct: number };
  distribution: { queueRefillThreshold: number; weightFloor: number };
  patience: { lateMul: number; alertMs: number };
  presentation: {
    finalStageAliveThreshold: number;
    finalRushAliveThreshold: number;
  };
  bot: {
    baseAccuracy: number;
    baseElapsedMs: number;
    accuracyJitter: number;
    elapsedJitterMs: number;
  };
};

// server の game.DefaultParameters() と同値（フォールバック／「既定に戻す」用）。
// 2026-08-05 時点。PR #80（決着時間調整・#74）と PR #79（heat.maxLevel 適用・#75）の反映後。
export const defaultParameters: GameParameters = {
  session: { tickIntervalMs: 150, publishIntervalMs: 250 },
  matching: { minPlayers: 20, maxPlayers: 99, startCountdownMs: 15000, rosterWaitMs: 3000, readyCountdownMs: 5000, minFill: 99 },
  credit: {
    initialLife: 3,
    leaveLoss: { normal: 1, bonus: 1, claimer: 1, buzz: 2 },
  },
  customer: {
    total: 300,
    normal: { attribute: "Normal", weight: 70, patienceBaseMs: 16000, orderCount: 2 },
    bonus: { attribute: "Bonus", weight: 15, patienceBaseMs: 18000, orderCount: 2 },
    claimer: { attribute: "Claimer", weight: 10, patienceBaseMs: 12000, orderCount: 1 },
    buzz: { attribute: "Buzz", weight: 5, patienceBaseMs: 24000, orderCount: 4 },
  },
  eval: {
    emaAlpha: 0.3,
    weightAccuracy: 0.5,
    weightSpeed: 0.5,
    speedBaselineMs: 4000,
    speedCap: 2.0,
    minMsPerWord: 200,
    buzzBonus: 0.2,
    buzzDecay: 0.98,
    buzzCap: 0.5,
  },
  phase: {
    midAliveThreshold: 70,
    lateAliveThreshold: 30,
    midTimeMs: 30000,
    lateTimeMs: 90000,
  },
  heat: { base: 0, perAliveDrop: 0.1, phaseEarly: 0, phaseMid: 3, phaseLate: 8, maxLevel: 17 },
  storm: { intervalTicks: 140, warnTicks: 30, thresholdPct: 0.1 },
  distribution: { queueRefillThreshold: 3, weightFloor: 0.25 },
  patience: { lateMul: 0.6, alertMs: 2000 },
  presentation: { finalStageAliveThreshold: 20, finalRushAliveThreshold: 10 },
  bot: { baseAccuracy: 0.85, baseElapsedMs: 3000, accuracyJitter: 0.1, elapsedJitterMs: 500 },
};

// サーバー側 odai.MaxWordLevel。お題辞書が持つ最大 level。
// heat.maxLevel がこれを超えても、その level に語がなければ下位へフォールバックする。
export const MAX_WORD_LEVEL = 17;

// ---------------------------------------------------------------------------
// パス操作
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>;

/** getPath は "customer.buzz.weight" のようなパスで値を取り出す。途中が無ければ undefined。 */
export function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Json)[key];
  }
  return cur;
}

/** getNumber は数値として取り出す。数値でなければ NaN（＝UI 側で不正扱い）。 */
export function getNumber(obj: unknown, path: string): number {
  const v = getPath(obj, path);
  return typeof v === "number" ? v : Number.NaN;
}

/**
 * setPath は破壊的に値を設定する（途中のオブジェクトは必要なら作る）。
 * 呼び出し側で structuredClone してから使うこと。
 */
export function setPath(obj: Json, path: string, value: unknown): void {
  const keys = path.split(".");
  let cur: Json = obj;
  for (const key of keys.slice(0, -1)) {
    if (typeof cur[key] !== "object" || cur[key] === null) cur[key] = {};
    cur = cur[key] as Json;
  }
  cur[keys[keys.length - 1]] = value;
}

/**
 * fillMissing はサーバー取得値を土台に、**スキーマが知っている数値パスのうち欠けているものだけ**を
 * デフォルトで補完する。サーバーが古くて新項目を持っていない場合の undefined 参照クラッシュを防ぐ。
 *
 * サーバー独自の未知フィールド（将来追加された項目、customer.*.attribute 等）はそのまま温存する。
 * これが Textro99 の mergeWithDefaults との一番の違い：あちらは数値前提だった。
 */
export function fillMissing(raw: unknown): GameParameters {
  const base: Json =
    typeof raw === "object" && raw !== null
      ? (structuredClone(raw) as Json)
      : {};

  for (const path of allFieldPaths()) {
    const v = getPath(base, path);
    if (typeof v !== "number" || !Number.isFinite(v)) {
      setPath(base, path, getPath(defaultParameters, path));
    }
  }
  // attribute（文字列）も欠けていたら補う。落ちたまま保存すると全客が Normal 扱いになる。
  for (const attr of ATTRIBUTE_KEYS) {
    if (typeof getPath(base, `customer.${attr.key}.attribute`) !== "string") {
      setPath(base, `customer.${attr.key}.attribute`, attr.value);
    }
  }
  return base as unknown as GameParameters;
}

/**
 * applyEdits は「サーバーから取得した JSON そのもの」を土台に、編集された数値リーフだけを
 * 上書きした保存用オブジェクトを返す。
 *
 * ここが設計の肝。スキーマに載っていないフィールド（customer.*.attribute の文字列、
 * サーバーが先に増やした未知の項目）を**一切触らない**ので、保存で情報が落ちない。
 */
export function applyEdits(
  serverRaw: unknown,
  edits: Map<string, number>,
): GameParameters {
  const out: Json =
    typeof serverRaw === "object" && serverRaw !== null
      ? (structuredClone(serverRaw) as Json)
      : (structuredClone(defaultParameters) as unknown as Json);

  for (const [path, value] of edits) {
    setPath(out, path, value);
  }
  return out as unknown as GameParameters;
}

// ---------------------------------------------------------------------------
// 画面スキーマ
// ---------------------------------------------------------------------------

export type FieldSpec = {
  path: string;
  label: string;
  unit?: string;
  /** true=小数可（既定は整数）。input の step と検証の両方に効く。 */
  float?: boolean;
  /** 「どこの何の値か／上げ下げの効果」。ゲーム実装（server internal/game）準拠で書く。 */
  help: string;
};

/** サブグループ＝3階層項目をまとめる単位（credit.leaveLoss, customer.{属性}）。 */
export type SubGroup = {
  title: string;
  desc?: string;
  fields: FieldSpec[];
};

export type GroupSpec = {
  key: keyof GameParameters;
  title: string;
  /** 見出しの絵文字。項目が多いので視覚的な手がかりを付ける。 */
  icon: string;
  desc: string;
  /** 反映タイミング。matching だけ再起動不要で即時（仕様書 §7）。 */
  timing: "live" | "next-match" | "presentation";
  fields?: FieldSpec[];
  subgroups?: SubGroup[];
  /** 属性別の値を表で見せるグループ（customer）用。 */
  matrix?: {
    title: string;
    desc: string;
    rows: { key: string; label: string; note: string }[];
    cols: { key: string; label: string; unit?: string; help: string }[];
    /** 行×列 → パス。 */
    pathOf: (row: string, col: string) => string;
  };
};

export const ATTRIBUTE_KEYS: {
  key: "normal" | "bonus" | "claimer" | "buzz";
  value: CustomerAttribute;
  label: string;
  note: string;
}[] = [
  { key: "normal", value: "Normal", label: "通常客", note: "評価への効きは標準。母数を作る" },
  { key: "bonus", value: "Bonus", label: "ボーナス客", note: "うまく捌くと評価が伸びる" },
  { key: "claimer", value: "Claimer", label: "クレーマー", note: "我慢が短く、帰られると痛い" },
  { key: "buzz", value: "Buzz", label: "バズ客（JK）", note: "注文が多い代わりに一時的な加点" },
];

export const schema: GroupSpec[] = [
  {
    key: "matching",
    title: "マッチング（試合前）",
    icon: "🎯",
    desc: "試合を始める条件。当日いちばん触る場所。人が集まらない時は「開始最小人数」を下げて回す。",
    timing: "live",
    fields: [
      {
        path: "matching.minPlayers",
        label: "開始最小人数",
        unit: "人",
        help: "カウントダウンを始めるのに必要な最少人数。イベント当日に人が足りない時はここを下げると即座に試合が回る。1 にすればひとりでも開始できる。",
      },
      {
        path: "matching.maxPlayers",
        label: "最大人数",
        unit: "人",
        help: "1試合の上限人数（本番99）。到達するとカウントダウンを待たずに即開始。",
      },
      {
        path: "matching.startCountdownMs",
        label: "開始カウントダウン",
        unit: "ms",
        help: "開始最小人数に達してからマッチング完了（メンバー確定）するまでのカウントダウン時間。",
      },
      {
        path: "matching.rosterWaitMs",
        label: "メンバー確定〜画面遷移猶予",
        unit: "ms",
        help: "マッチング完了後に最終メンバー一覧を見せる時間。この時間経過後に試合画面へ遷移する。",
      },
      {
        path: "matching.readyCountdownMs",
        label: "試合開始前カウントダウン",
        unit: "ms",
        help: "試合画面に遷移してから、実際にタイピング（ゲーム進行）が解禁されるまでの猶予時間。",
      },
      {
        path: "matching.minFill",
        label: "Bot補完人数",
        unit: "人",
        help: "試合開始時にこの人数までBotで埋める（0＝補完なし、99＝99人になるまでBot追加）。⚠ サーバーを --bots N 付きで起動しているとこの値は N で上書きされる。",
      },
    ],
  },
  {
    key: "credit",
    title: "信用（ライフ）",
    icon: "❤️",
    desc: "客に帰られた時だけ減る。0 になると自滅で脱落。既定値では脱落の約半分がこの経路。",
    timing: "next-match",
    fields: [
      {
        path: "credit.initialLife",
        label: "初期ライフ",
        help: "試合開始時の信用。0 で脱落。上げるほど試合が長引く（決着時間の主要レバーの一つ）。",
      },
    ],
    subgroups: [
      {
        title: "離脱ペナルティ（属性別）",
        desc: "客が我慢しきれず帰った時に減る信用の量。属性ごとに重みを変えられる。",
        fields: [
          {
            path: "credit.leaveLoss.normal",
            label: "通常客",
            help: "通常客に帰られた時に減る信用。いちばん頻度が高いので効きが大きい。",
          },
          {
            path: "credit.leaveLoss.bonus",
            label: "ボーナス客",
            help: "ボーナス客に帰られた時に減る信用。",
          },
          {
            path: "credit.leaveLoss.claimer",
            label: "クレーマー",
            help: "クレーマーに帰られた時に減る信用。我慢が短いので取りこぼしやすい。",
          },
          {
            path: "credit.leaveLoss.buzz",
            label: "バズ客",
            help: "バズ客に帰られた時に減る信用。注文数が多く手間もかかるので既定は重め（2）。",
          },
        ],
      },
    ],
  },
  {
    key: "customer",
    title: "客",
    icon: "🧑‍🤝‍🧑",
    desc: "試合全体で流れる客の総数と、属性ごとの出現比・我慢時間・注文数。",
    timing: "next-match",
    fields: [
      {
        path: "customer.total",
        label: "客の総数",
        unit: "人",
        help: "1試合で登場する客の固定総数。全店で奪い合う。少なすぎると客が枯れて誰も評価を伸ばせなくなる。",
      },
    ],
    matrix: {
      title: "属性別の設定",
      desc: "出現比は相対値（合計で割った比率）。我慢時間は来店時に持つゲージの最大値。注文数は1人が出すお題の本数。",
      rows: ATTRIBUTE_KEYS.map((a) => ({ key: a.key, label: a.label, note: a.note })),
      cols: [
        {
          key: "weight",
          label: "出現比",
          help: "この属性が抽選で選ばれる相対的な重み。他の属性との比率だけが意味を持つ（合計が100である必要はない）。",
        },
        {
          key: "patienceBaseMs",
          label: "我慢時間",
          unit: "ms",
          help: "来店時に持つ我慢ゲージの最大値。0 になると帰って信用が減る。終盤フェーズではさらに短くなる。",
        },
        {
          key: "orderCount",
          label: "注文数",
          unit: "本",
          help: "この客1人が出すお題の本数。多いほど捌くのに時間がかかる。",
        },
      ],
      pathOf: (row, col) => `customer.${row}.${col}`,
    },
  },
  {
    key: "storm",
    title: "下位淘汰（storm）",
    icon: "🌪️",
    desc: "一定間隔で評価の下位を強制脱落させる。⚠ Takoda99 に試合の制限時間はないので、決着を保証しているのはこの仕組みだけ。",
    timing: "next-match",
    fields: [
      {
        path: "storm.intervalTicks",
        label: "淘汰の間隔",
        unit: "tick",
        help: "この tick 数ごとに下位淘汰を実行する。tick 周期150msなら 140tick＝約21秒。⚠ 0 にすると淘汰が無効になり、試合が終わらなくなる可能性がある。",
      },
      {
        path: "storm.warnTicks",
        label: "予告の先出し",
        unit: "tick",
        help: "淘汰の何 tick 前に警告を配信するか。プレイヤーが巻き返す猶予になる。淘汰間隔より大きいと予告が出ない。",
      },
      {
        path: "storm.thresholdPct",
        label: "淘汰する割合",
        float: true,
        help: "生存店のうち評価下位から何割を脱落させるか（0.10＝10%）。切り上げなので最低1店は必ず落ちる。上げるほど早く決着する。",
      },
    ],
  },
  {
    key: "phase",
    title: "フェーズ移行",
    icon: "⏳",
    desc: "序盤→中盤→終盤。生存数と経過時間の「どちらか先に到達」で移行する。火力と我慢ゲージに効く。",
    timing: "next-match",
    fields: [
      {
        path: "phase.midAliveThreshold",
        label: "中盤へ（生存数）",
        unit: "店",
        help: "生存店がこの数まで減ったら中盤へ移行。",
      },
      {
        path: "phase.lateAliveThreshold",
        label: "終盤へ（生存数）",
        unit: "店",
        help: "生存店がこの数まで減ったら終盤へ移行。中盤のしきい値より小さくする。",
      },
      {
        path: "phase.midTimeMs",
        label: "中盤へ（経過時間）",
        unit: "ms",
        help: "試合開始からこの時間が経ったら中盤へ移行（生存数がまだ減っていなくても）。",
      },
      {
        path: "phase.lateTimeMs",
        label: "終盤へ（経過時間）",
        unit: "ms",
        help: "試合開始からこの時間が経ったら終盤へ移行。中盤の時間より後にする。",
      },
    ],
  },
  {
    key: "heat",
    title: "火力（お題の難度）",
    icon: "🔥",
    desc: "お題の難易度レベル。生存数が減るほど、フェーズが進むほど上がる。式＝基礎 + 減少係数×(総店数−生存数) + フェーズ加算、上限でクランプ。",
    timing: "next-match",
    fields: [
      {
        path: "heat.base",
        label: "基礎値",
        help: "試合開始時点の火力。上げると最初から難しいお題が出る。",
      },
      {
        path: "heat.perAliveDrop",
        label: "1店脱落あたりの上昇",
        float: true,
        help: "店が1つ脱落するごとに火力へ加える量（0.1なら10店脱落で+1）。上げるほど終盤の難度が急に上がる。",
      },
      {
        path: "heat.phaseEarly",
        label: "序盤の加算",
        help: "序盤フェーズの間だけ火力に加える量。",
      },
      {
        path: "heat.phaseMid",
        label: "中盤の加算",
        help: "中盤フェーズの間だけ火力に加える量。",
      },
      {
        path: "heat.phaseLate",
        label: "終盤の加算",
        help: "終盤フェーズの間だけ火力に加える量。序盤・中盤より大きくして終盤感を出す。",
      },
      {
        path: "heat.maxLevel",
        label: "火力の上限",
        help: `火力の頭打ち。お題辞書の level はここまで用意されている必要がある（現在の辞書は 0〜${MAX_WORD_LEVEL}）。超えた分は語がなく下位 level にフォールバックするので、実質的に難度が上がらなくなる。`,
      },
    ],
  },
  {
    key: "patience",
    title: "我慢ゲージ",
    icon: "😤",
    desc: "客が待てる時間の調整。属性ごとの基準値は「客」グループにある。ここは全体にかかる補正。",
    timing: "next-match",
    fields: [
      {
        path: "patience.lateMul",
        label: "終盤の短縮倍率",
        float: true,
        help: "終盤フェーズでは経過時間をこの値で割って扱う（0.6 なら約1.67倍の速さで減る）。⚠ 下げるほどキツくなる（名前の印象と逆）。0 だと短縮が無効。",
      },
      {
        path: "patience.alertMs",
        label: "離脱アラート",
        unit: "ms",
        help: "我慢ゲージの残りがこの時間を切ったら「帰りそう」の警告を出す。プレイヤーの優先順位付けに効く。",
      },
    ],
  },
  {
    key: "eval",
    title: "評価",
    icon: "⭐",
    desc: "提供のたびに算出するスコアと、その平滑化。評価は客の分配と下位淘汰の順位に使われる。",
    timing: "next-match",
    fields: [
      {
        path: "eval.weightAccuracy",
        label: "精度の重み",
        float: true,
        help: "提供スコア＝精度×この重み＋速度×速度の重み。精度＝正しく打てた割合。合計が1になるようにするのが素直。",
      },
      {
        path: "eval.weightSpeed",
        label: "速度の重み",
        float: true,
        help: "提供スコアの速度成分にかかる重み。上げるほど「速く打つ人」が有利になる。",
      },
      {
        path: "eval.speedBaselineMs",
        label: "速度の基準時間",
        unit: "ms",
        help: "速度成分＝基準時間÷実所要時間（上限でクランプ）。この時間ちょうどで提供すると 1.0。上げるほど全員の速度成分が伸びる。",
      },
      {
        path: "eval.speedCap",
        label: "速度成分の上限",
        float: true,
        help: "速度成分の頭打ち。2.0 なら基準の2倍速以上は同じ扱い。異常な速さで評価が飛び抜けるのを防ぐ。",
      },
      {
        path: "eval.emaAlpha",
        label: "評価の平滑化係数",
        float: true,
        help: "評価は指数移動平均で更新する。1に近いほど直近の提供を強く反映（乱高下する）、0に近いほど過去を引きずる。",
      },
      {
        path: "eval.minMsPerWord",
        label: "1語あたり最短時間",
        unit: "ms",
        help: "不正対策の下限。所要時間が「この値×注文数」を下回る提供は正当でないとみなす。人間の限界より少し下に置く。",
      },
      {
        path: "eval.buzzBonus",
        label: "バズ加点",
        float: true,
        help: "バズ客（JK）を満足させた時に評価へ乗る一時的な加点。",
      },
      {
        path: "eval.buzzDecay",
        label: "バズ加点の減衰",
        float: true,
        help: "バズ加点は毎tickこの倍率で減っていく（0.98＝1tickごとに2%減）。1に近いほど長持ちする。",
      },
      {
        path: "eval.buzzCap",
        label: "バズ加点の上限",
        float: true,
        help: "バズ加点の累積の頭打ち。バズ客を独占した店が突き抜けるのを防ぐ。",
      },
    ],
  },
  {
    key: "distribution",
    title: "客の分配",
    icon: "🚶",
    desc: "待機中の客をどの店の行列に入れるか。重み＝(下駄 + 正規化評価) ÷ (行列長 + 1)。",
    timing: "next-match",
    fields: [
      {
        path: "distribution.queueRefillThreshold",
        label: "行列の補充しきい値",
        unit: "人",
        help: "行列がこの人数未満の店だけが客の分配対象になる。上げるほど各店に客が溜まりやすい。",
      },
      {
        path: "distribution.weightFloor",
        label: "評価0の店への下駄",
        float: true,
        help: "重み式に足す下限値。評価が0の店にも客が来るようにする救済。下げるほど高評価の店に客が集中し、格差が開く。",
      },
    ],
  },
  {
    key: "bot",
    title: "CPU（Bot）の強さ",
    icon: "🤖",
    desc: "人数補完・デモ用のBot。人間と同じ土俵で戦う。強すぎる／弱すぎる時はここ。",
    timing: "next-match",
    fields: [
      {
        path: "bot.baseElapsedMs",
        label: "1お題にかける時間",
        unit: "ms",
        help: "Botがお題1本を打ち切るのにかける時間。小さいほど速い＝強い。人間寄りにするなら上げる。",
      },
      {
        path: "bot.baseAccuracy",
        label: "精度",
        float: true,
        help: "Botの打鍵精度（0〜1。0.85＝85%）。上げるほど評価が伸びて強くなる。",
      },
      {
        path: "bot.elapsedJitterMs",
        label: "時間のばらつき",
        unit: "ms",
        help: "1お題ごとに所要時間へ乗せる揺らぎの幅。0 だと全Botが機械的に同じ挙動になる。",
      },
      {
        path: "bot.accuracyJitter",
        label: "精度のばらつき",
        float: true,
        help: "Botごと・お題ごとの精度の揺らぎ幅。上げるとBotの強さに個体差が出る。",
      },
    ],
  },
  {
    key: "presentation",
    title: "演出しきい値",
    icon: "🎬",
    desc: "クライアントの見た目を切り替えるだけの値。⚠ ゲーム進行・判定には一切影響しない（フェーズとは別物）。",
    timing: "presentation",
    fields: [
      {
        path: "presentation.finalStageAliveThreshold",
        label: "終盤演出へ",
        unit: "店",
        help: "生存店がこの数まで減ったらクライアントが終盤演出へ切り替える。",
      },
      {
        path: "presentation.finalRushAliveThreshold",
        label: "最終盤演出へ",
        unit: "店",
        help: "生存店がこの数まで減ったら最終盤演出へ切り替える。終盤より小さくする。",
      },
    ],
  },
  {
    key: "session",
    title: "試合ループ（内部）",
    icon: "⚙️",
    desc: "サーバー内部の更新周期。基本は既定のままでよい。負荷・帯域の調整用。",
    timing: "next-match",
    fields: [
      {
        path: "session.tickIntervalMs",
        label: "tick 周期",
        unit: "ms",
        help: "ゲームループの刻み。小さいほど処理が精密になるがCPU負荷が増える。本番は e2-micro（0.25vCPU）なので下げすぎない。",
      },
      {
        path: "session.publishIntervalMs",
        label: "盤面配信間隔",
        unit: "ms",
        help: "99店ミニ盤面の配信間隔。小さいほど滑らかだが通信量が増える（実測で試合あたり数百MB）。脱落などの即時イベントとは別。",
      },
    ],
  },
];

/** allFieldPaths はスキーマが宣言する全ての数値パスを返す（重複なし）。 */
export function allFieldPaths(): string[] {
  const out: string[] = [];
  for (const g of schema) {
    for (const f of g.fields ?? []) out.push(f.path);
    for (const sg of g.subgroups ?? []) for (const f of sg.fields) out.push(f.path);
    if (g.matrix) {
      for (const r of g.matrix.rows) {
        for (const c of g.matrix.cols) out.push(g.matrix.pathOf(r.key, c.key));
      }
    }
  }
  return out;
}

/** allFieldSpecs はパス→表示情報の辞書。差分表示のラベル解決に使う。 */
export function allFieldSpecs(): Map<string, { label: string; group: string; unit?: string; float?: boolean }> {
  const m = new Map<string, { label: string; group: string; unit?: string; float?: boolean }>();
  for (const g of schema) {
    for (const f of g.fields ?? []) {
      m.set(f.path, { label: f.label, group: g.title, unit: f.unit, float: f.float });
    }
    for (const sg of g.subgroups ?? []) {
      for (const f of sg.fields) {
        m.set(f.path, { label: `${sg.title} / ${f.label}`, group: g.title, unit: f.unit, float: f.float });
      }
    }
    if (g.matrix) {
      for (const r of g.matrix.rows) {
        for (const c of g.matrix.cols) {
          m.set(g.matrix.pathOf(r.key, c.key), {
            label: `${r.label} / ${c.label}`,
            group: g.title,
            unit: c.unit,
          });
        }
      }
    }
  }
  return m;
}

export const TIMING_LABEL: Record<GroupSpec["timing"], { text: string; tone: string; title: string }> = {
  live: {
    text: "数秒で反映",
    tone: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
    title: "マッチング待機ループが毎回読み直すため、サーバー再起動なしで反映される",
  },
  "next-match": {
    text: "次の試合から",
    tone: "bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300",
    title: "試合開始時に読み込まれる。進行中の試合には影響しない",
  },
  presentation: {
    text: "演出のみ・次の試合から",
    tone: "bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-300",
    title: "クライアントの見た目だけを変える。ゲーム進行には影響しない",
  },
};
