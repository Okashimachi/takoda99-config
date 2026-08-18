// GameParameters の TS ミラーと、画面描画用のスキーマ。
//
// 正典は server の internal/game/params.go。フィールドを増減したら両方を揃える（手動同期）。
// customer.{属性}.* が3階層になるので、**ドット区切りパス**で扱う。
//
// 🔴 本戦移行（plan-h21〜h24）でスキーマが大きく変わった。廃止したグループは
// **UI から消すこと**。「効かない値」を当日いじって時間を溶かす事故を防ぐのが目的で、
// 予選で initialLife を DB で変えたのにコードの既定値を見ていた、という混乱の再来を避ける。

export type CustomerAttribute = "Normal" | "Bonus" | "Claimer" | "Buzz";

export type AttributeSpec = {
  attribute: CustomerAttribute;
  weight: number;
  orderCount: number;
};

/** 足切りの1ステージ。atMs は企画で確定しており編集させない（§4.3）。 */
export type CullStage = { atMs: number; targetAliveCount: number };

/** 足切りの段階数。サーバーは [6]CullStage の固定長配列で持つ。 */
export const CULL_STAGE_COUNT = 6;

/**
 * Bot の強さ階層1つぶん（plan-h31）。
 *
 * 🔴 **速度は「1注文あたり」ではなく「1打鍵あたり」**。お題は火力が上がるほど長くなる
 * （level 0 で約13打鍵／level 17 で約130打鍵）ので、注文あたりの固定時間で持つと
 * 終盤ほど Bot だけが相対的に速くなる。
 */
export type BotTier = {
  weight: number;
  msPerKey: number;
  missRate: number;
  heatPenalty: number;
};

/** Bot の階層数。サーバーは [3]BotTier の固定長配列で持つ（強／中／弱）。 */
export const BOT_TIER_COUNT = 3;

export type GameParameters = {
  session: { tickIntervalMs: number };
  publish: {
    evaluationIntervalMs: number;
    warningIntervalMs: number;
    rankingIntervalMs: number;
    rankingDeltaEnabled: boolean;
    rankingDeltaIntervalMs: number;
  };
  matching: {
    minPlayers: number;
    maxPlayers: number;
    startCountdownMs: number;
    rosterWaitMs: number;
    readyCountdownMs: number;
    minFill: number;
  };
  customer: {
    total: number;
    normal: AttributeSpec;
    bonus: AttributeSpec;
    claimer: AttributeSpec;
    buzz: AttributeSpec;
  };
  score: { weightTakoyaki: number; weightMiss: number };
  sanity: { minMsPerWord: number };
  phase: {
    midAliveThreshold: number;
    lateAliveThreshold: number;
    midTimeMs: number;
    lateTimeMs: number;
  };
  heat: {
    base: number;
    perAliveDrop: number;
    /** 経過1秒あたりの上昇（plan-h32）。難度カーブの主軸。 */
    perElapsedSec: number;
    phaseEarly: number;
    phaseMid: number;
    phaseLate: number;
    maxLevel: number;
  };
  /** お題の難度を heat から独立して微調整する（plan-h35）。既定は両方 0＝現行と同じ。 */
  odai: { levelSpread: number; levelOffset: number };
  cull: { stages: CullStage[]; warnMaxIds: number };
  distribution: { queueRefillThreshold: number };
  presentation: {
    finalStageAliveThreshold: number;
    finalRushAliveThreshold: number;
  };
  /**
   * Bot の強さ（plan-h31 で tier 制になった）。
   * 旧 baseAccuracy / baseElapsedMs / accuracyJitter は**サーバーから削除済み**。
   */
  bot: {
    tiers: BotTier[];
    individualSpread: number;
    elapsedJitterMs: number;
  };
};

// server の game.DefaultParameters() と同値（フォールバック／「既定に戻す」用）。
//
// 🔴 **ここがズレると事故る。ズレて実際に事故った。**
//
//	2026-08-16: heat.perElapsedSec をサーバー側で 0.12 にしたのに、こちらを 0.11 の
//	まま直し忘れた。perElapsedSec は新設キーで DB に無かったため、**画面を開いた瞬間に
//	こちら側の 0.11 で補完され、そのまま本番DBへ保存**された。誰も気付かないまま
//	本番が意図と違う値で走っていた。
//
// 「既定に戻す」が嘘になるだけではない。**DB に無いキーはこの値で補完されて保存される**ので、
// ここはサーバー内蔵デフォルトの写しであって「画面の好み」ではない。
// サーバー側 internal/game/params.go の DefaultParameters() を変えたら必ず両方直すこと。
// 突き合わせ方: `curl -s https://takoda99.mooo.com/api/params | jq` と目視、または
// サーバーで `go run` して DefaultParameters() を JSON 出力する。
//
// ⚠ この画面が知らないキー／サーバーが返さないキーは、**画面上部のドリフト検出**
// （lib/drift.ts）が両方向で警告する。警告が出たらここを直すのが正しい対処。
export const defaultParameters: GameParameters = {
  session: { tickIntervalMs: 150 },
  publish: {
    evaluationIntervalMs: 250,
    warningIntervalMs: 500,
    rankingIntervalMs: 1000,
    rankingDeltaEnabled: false,
    rankingDeltaIntervalMs: 500,
  },
  matching: { minPlayers: 20, maxPlayers: 99, startCountdownMs: 15000, rosterWaitMs: 3000, readyCountdownMs: 5000, minFill: 99 },
  // orderCount は h30 で 2/2/1/4 → 3/3/2/6 に引き上げ済み（1語を短くしたぶんを語数で持つ）。
  customer: {
    total: 5000,
    normal: { attribute: "Normal", weight: 70, orderCount: 3 },
    bonus: { attribute: "Bonus", weight: 15, orderCount: 3 },
    claimer: { attribute: "Claimer", weight: 10, orderCount: 2 },
    buzz: { attribute: "Buzz", weight: 5, orderCount: 6 },
  },
  // weightMiss は h26(25) → h30(30) → h32後の再測定(22) と3回動いている。
  // 🔴 サーバー internal/game/params.go の既定値と必ず一致させること（ズレると
  // DB に無いキーがこちら側の値で保存される。実際 perElapsedSec で起きた）。
  score: { weightTakoyaki: 100, weightMiss: 22 },
  sanity: { minMsPerWord: 200 },
  phase: {
    midAliveThreshold: 70,
    lateAliveThreshold: 30,
    midTimeMs: 30000,
    lateTimeMs: 90000,
  },
  // h32 で難度カーブを時間主軸に組み替えた（perElapsedSec 新設・phaseLate 9→2）。
  //
  // 🔴 perElapsedSec は **サーバー側の既定値（internal/game/params.go）と必ず揃える**。
  // ここが 0.11、サーバーが 0.12 でズレていたため、DB に無いキーがこちら側の
  // 既定値で補完されて 0.11 が保存された。0.11 だと上端(17)への到達が 119秒で
  // **上端に居るのが1秒**しかなく、level 17 の語（約43打鍵≒10秒）が打ち切れない。
  heat: { base: 0, perAliveDrop: 0.03, perElapsedSec: 0.12, phaseEarly: 0, phaseMid: 1, phaseLate: 2, maxLevel: 17 },
  // 両方 0 ＝ 現行と完全に同じ挙動（お題の level は heat と1対1）。plan-h35 §7.3。
  odai: { levelSpread: 0, levelOffset: 0 },
  cull: {
    stages: [
      { atMs: 20000, targetAliveCount: 75 },
      { atMs: 40000, targetAliveCount: 55 },
      { atMs: 60000, targetAliveCount: 35 },
      { atMs: 80000, targetAliveCount: 20 },
      { atMs: 100000, targetAliveCount: 10 },
      { atMs: 120000, targetAliveCount: 0 },
    ],
    // 🔴 サーバー側の const DefaultCullWarnMaxIds と同値。クライアントと合意済みの 24。
    warnMaxIds: 24,
  },
  distribution: { queueRefillThreshold: 5 },
  presentation: { finalStageAliveThreshold: 20, finalRushAliveThreshold: 10 },
  // h31: tier（強／中／弱）＋個体差。**サーバー game.DefaultBotTiers() と同値**。
  //
  // 🔴 tiers も individualSpread も**本番DBには無いキー**（bot グループは旧スキーマで存在する）。
  // つまりこの画面を開いて保存した瞬間、ここの値がそのまま本番へ書き込まれる。
  // サーバー側 internal/game/params.go の DefaultBotTiers() から1文字も変えないこと。
  bot: {
    tiers: [
      { weight: 25, msPerKey: 150, missRate: 0.02, heatPenalty: 0.01 },
      { weight: 50, msPerKey: 200, missRate: 0.05, heatPenalty: 0.02 },
      { weight: 25, msPerKey: 400, missRate: 0.1, heatPenalty: 0.04 }, // 🔴 サーバーと一致必須（280 だと初心者が必ず最下位）
    ],
    individualSpread: 0.2,
    elapsedJitterMs: 500,
  },
};

// サーバー側 odai.MaxWordLevel。お題辞書が持つ最大 level。
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
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof cur[key] !== "object" || cur[key] === null) {
      // 次のキーが数字なら配列を作る（cull.stages.0.targetAliveCount のため）。
      cur[key] = /^\d+$/.test(keys[i + 1]) ? [] : {};
    }
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
  // 表示のみの列（cull.stages.*.atMs）も、欠けているとテーブルが空になるので補う。
  for (const path of allReadonlyPaths()) {
    if (typeof getPath(base, path) !== "number") {
      setPath(base, path, getPath(defaultParameters, path));
    }
  }
  // 真偽値も補う（数値パスの一覧には入っていない）。
  for (const path of allBoolPaths()) {
    if (typeof getPath(base, path) !== "boolean") {
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
  edits: Map<string, EditValue>,
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
  /**
   * true=負の値を許す（既定は 0 以上のみ）。
   * odai.levelOffset のように「−1 でやさしくする」が正常な使い方の項目に付ける。
   * 付け忘れると検証が負値を弾いて**そのツマミが片側にしか動かない**。
   */
  signed?: boolean;
  /**
   * true=真偽値（トグルで編集する）。
   * **数値パスの一覧（allFieldPaths）からは除外される**ので、数値前提の検証・補完に混ざらない。
   */
  bool?: boolean;
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
    cols: {
      key: string;
      label: string;
      unit?: string;
      help: string;
      /**
       * true=小数可（既定は整数）。bot.tiers の missRate / heatPenalty がこれ。
       * 付け忘れると検証が「整数で入力してください」を出して**そのマスが編集できなくなる**。
       */
      float?: boolean;
      /**
       * true=表示のみ（編集させない）。
       * cull.stages の atMs がこれ。20秒等間隔・120秒は企画で確定しており、
       * 当日いじると試合が壊れる（plan-h24 §4.3）。
       */
      readonly?: boolean;
    }[];
    /** 行×列 → パス。 */
    pathOf: (row: string, col: string) => string;
  };
};

// ⚠ 本戦では**属性はゲームに一切影響しない**（見た目の出し分け専用）。
// 変えられるのは出現比と注文数だけで、同じ打鍵をすれば属性によらず同じスコアになる。
export const ATTRIBUTE_KEYS: {
  key: "normal" | "bonus" | "claimer" | "buzz";
  value: CustomerAttribute;
  label: string;
  note: string;
}[] = [
  { key: "normal", value: "Normal", label: "通常客", note: "母数を作る標準の客" },
  { key: "bonus", value: "Bonus", label: "ボーナス客", note: "ヒョウ柄おばちゃん。見た目だけの違い" },
  { key: "claimer", value: "Claimer", label: "クレーマー", note: "序盤は来店しない。注文は少なめ" },
  { key: "buzz", value: "Buzz", label: "バズ客（JK）", note: "注文数が多い＝1人でたこ焼きを稼げる" },
];

/** CULL_ROWS は足切り表の行（6ステージ）。 */
export const CULL_ROWS = [
  { key: "0", label: "第1段階", note: "20秒。ここより早く切らない（弱くても20秒は遊べる担保）" },
  { key: "1", label: "第2段階", note: "40秒" },
  { key: "2", label: "第3段階", note: "60秒" },
  { key: "3", label: "第4段階", note: "80秒" },
  { key: "4", label: "第5段階", note: "100秒。**決勝の人数**。原則10で固定" },
  { key: "5", label: "第6段階", note: "120秒。**全店脱落＝試合終了**。0 以外にできない" },
];

export const schema: GroupSpec[] = [
  {
    key: "score",
    title: "スコアの重み",
    icon: "🎯",
    desc: "★本作の面白さの中心。順位を決める唯一の値で、この2つの比率が「速く打つゲームか、正確に打つゲームか」を決める。",
    timing: "next-match",
    fields: [
      {
        path: "score.weightTakoyaki",
        label: "たこ焼き1個の加点",
        help: "客1人を捌くと「注文数 × この値」が加算される。基準になる値なので、性格を変えたい時は下のミス減点のほうを動かすのが素直。",
      },
      {
        path: "score.weightMiss",
        label: "ミス1回の減点",
        help: "打鍵ミス1回につき引かれる点。既定25＝たこ焼き加点100に対して4対1（ミス1回＝たこ焼き1/4個の損）。上げると「慎重に正確に」、下げると「ミスを恐れず速く」のゲームになる。⚠ シミュレーションでは18まで下げると正確に打つ人が下位3分の1に沈む。",
      },
    ],
  },
  {
    key: "cull",
    title: "足切り（脱落スケジュール）",
    icon: "✂️",
    desc: "20秒ごとに、生存数が目標まで減るようスコア下位から脱落させる。⚠ 試合はこのスケジュールの最終段階（120秒）で全店が脱落して終わる。",
    timing: "next-match",
    fields: [
      {
        path: "cull.warnMaxIds",
        label: "予告に載せる店数の上限",
        unit: "店",
        help: "「次の足切りで切られる店」としてクライアントへ送るIDの最大件数（危ない順）。🔴 既定24は**クライアントと合意済みの値**（初回の足切り99→75でちょうど24店が切られるため、最も人数が多い段階でも全員を出し切れる）。当日に勝手に変えず、変えるときは必ずクライアント担当に共有すること。下げれば送信量が減る（会場の回線が厳しい時の逃げ道）、上げればデバッグ時に全件見える。0 にするとサーバー側で既定24として扱われる（＝「1件も送らない」にはできない）。",
      },
    ],
    matrix: {
      title: "6段階のスケジュール",
      desc: "時刻は企画で確定しており変更できない（20秒等間隔・120秒で終了）。動かしてよいのは第2〜第4段階の目標生存数だけ。",
      rows: CULL_ROWS,
      cols: [
        {
          key: "atMs",
          label: "時刻",
          unit: "ms",
          readonly: true,
          help: "この時刻に足切りが実行される。20秒等間隔・最終120秒は企画で確定しており、変更すると試合が壊れるため編集できない。",
        },
        {
          key: "targetAliveCount",
          label: "目標生存数",
          unit: "店",
          help: "この段階の実行後に残る店数。生存数がこれになるまでスコア下位から切る。上の段階より大きくはできない（単調非増加）。",
        },
      ],
      pathOf: (row, col) => `cull.stages.${row}.${col}`,
    },
  },
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
    key: "customer",
    title: "客",
    icon: "🧑‍🤝‍🧑",
    desc: "試合全体で流れる客の総数と、属性ごとの出現比・注文数。⚠ 本戦では属性はスコアに影響しない（見た目の出し分けのみ）。",
    timing: "next-match",
    fields: [
      {
        path: "customer.total",
        label: "客の総数",
        unit: "人",
        help: "1試合で登場する客の固定総数。全店で奪い合う。少なすぎると客が枯れて、行列が空＝お題が途切れる店が出る。",
      },
    ],
    matrix: {
      title: "属性別の設定",
      desc: "出現比は相対値（合計で割った比率）。注文数は1人が出すお題の本数＝たこ焼きの個数で、スコアの加点対象。",
      rows: ATTRIBUTE_KEYS.map((a) => ({ key: a.key, label: a.label, note: a.note })),
      cols: [
        {
          key: "weight",
          label: "出現比",
          help: "この属性が抽選で選ばれる相対的な重み。他の属性との比率だけが意味を持つ（合計が100である必要はない）。",
        },
        {
          key: "orderCount",
          label: "注文数",
          unit: "本",
          help: "この客1人が出すお題の本数＝たこ焼きの個数。スコアはこの数に weightTakoyaki を掛けて加算する。多いほど1人あたりの旨みが大きい。",
        },
      ],
      pathOf: (row, col) => `customer.${row}.${col}`,
    },
  },
  {
    key: "phase",
    title: "フェーズ移行",
    icon: "⏳",
    desc: "序盤→中盤→終盤。生存数と経過時間の「どちらか先に到達」で移行する。⚠ 脱落はフェーズでは起きない（足切りの時刻で起きる）。フェーズが変えるのは火力とクレーマーの解禁だけ。",
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
    desc: "お題の難易度レベル。時間が経つほど、生存数が減るほど上がる。式＝基礎 + 減少係数×(総店数−生存数) + 秒あたり上昇×経過秒 + フェーズ加算、上限でクランプ。⚠ 主軸は「秒あたり上昇」。フェーズ加算はEarly/Mid/Lateの離散イベントなので、大きくすると難度がその瞬間に跳ねる（h32）。",
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
        help: "店が1つ脱落するごとに火力へ加える量（0.03なら33店脱落で+1）。切り捨てなので足切りの瞬間だけ段差になる。カーブの主役は下の「1秒あたりの上昇」で、ここは終盤の重み付け。",
      },
      {
        path: "heat.perElapsedSec",
        label: "1秒あたりの上昇",
        float: true,
        help: "経過1秒ごとに火力へ加える量（0.11なら120秒で+13）。⚠ 難度カーブの主軸。ここを0にすると生存数とフェーズだけで難度が決まり、階段状のカーブに戻る（h32）。",
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
        help: "終盤フェーズの間だけ火力に加える量。⚠ フェーズは離散イベントなので、中盤の加算と差を付けすぎると終盤突入の瞬間に難度が跳ねる（旧値9では +8 跳んでいた）。終盤を難しくしたいときは、ここではなく「1秒あたりの上昇」を上げる（h32）。",
      },
      {
        path: "heat.maxLevel",
        label: "火力の上限",
        help: `火力の頭打ち。お題辞書の level はここまで用意されている必要がある（現在の辞書は 0〜${MAX_WORD_LEVEL}）。超えた分は語がなく下位 level にフォールバックするので、実質的に難度が上がらなくなる。`,
      },
    ],
  },
  {
    key: "odai",
    title: "お題の難度（微調整）",
    icon: "📝",
    desc: "★当日いちばん安全に触れる難度ツマミ。火力（heat）が決めたレベルに対して、お題だけを上下・ばらつかせる。⚠ 両方 0 が既定で、そのときは火力とお題が完全に1対1（従来どおり）。",
    timing: "next-match",
    fields: [
      {
        path: "odai.levelOffset",
        label: "難度の下駄（±）",
        signed: true,
        help: "火力が決めたレベルに足す値。−1 でお題だけ1段やさしく、+1 で1段難しくなる。★「難しすぎる／簡単すぎる」と感じたらまずここを ±1 する。火力（heat）を触るとカーブの形が変わるうえクライアントの難度表示まで動くが、こちらは**形も表示も変えずに平行移動**できるので当日の調整として安全。負の値も入れてよい（レベルは0で止まる）。",
      },
      {
        path: "odai.levelSpread",
        label: "1語ごとのばらつき（±）",
        help: "1語ずつレベルを「火力±この値」の範囲からランダムに選ぶ。0（既定）だと同じ瞬間の語は全店・全客が同じレベルで、難度が上がる＝一律に全部難しくなる、という単調な動きしかない。2 にすると同じ火力でも語の長さに幅が出る。⚠ 上振れして辞書の上限を超えた分は自動的に下のレベルへ落ちるので壊れない。",
      },
    ],
  },
  {
    key: "distribution",
    title: "客の分配",
    icon: "🚶",
    desc: "待機中の客をどの店の行列に入れるか。重み＝1 ÷ (行列長 + 1)。⚠ スコアは分配に影響しない（高スコアほど客が増える正のフィードバックを避けるため）。",
    timing: "next-match",
    fields: [
      {
        path: "distribution.queueRefillThreshold",
        label: "行列の補充しきい値",
        unit: "人",
        help: "行列がこの人数未満の店だけが客の分配対象になる。上げるほど各店に客が溜まりやすい。",
      },
    ],
  },
  {
    key: "bot",
    title: "CPU（Bot）の強さ",
    icon: "🤖",
    desc:
      "人数補完・デモ用のBot。人間と同じ土俵で戦う。★狙いは「人間が真ん中あたりに来る」こと。" +
      "強／中／弱の3階層を出現比で抽選し、そこへ個体差を掛けた個体が1体ずつ作られる（h31）。",
    timing: "next-match",
    fields: [
      {
        path: "bot.individualSpread",
        label: "個体差の幅",
        float: true,
        help: "同じ階層の中でも1体ずつ強さを散らす幅（0.20＝±20%）。速度とミス率に**同じ係数**が掛かるので「遅い個体はミスも多い」という現実的な散らばりになる。生成時に一度決めたら試合中は変わらない（＝「あの店ずっと速いな」が成立する）。⚠ 0 は「個体差なし」ではなく**未設定**として扱われ、サーバー側で既定 0.20 に読み替えられる。",
      },
      {
        path: "bot.elapsedJitterMs",
        label: "1お題ごとの揺らぎ",
        unit: "ms",
        help: "お題1本ごとに所要時間へ乗せる揺らぎの幅（±ms）。上の「個体差」とは別物で、こちらは毎回振り直す。0 でも個体差は残る。",
      },
    ],
    matrix: {
      title: "強さの階層（強／中／弱）",
      desc:
        "「人間が上位を独占する」なら1打鍵の時間を3行とも下げ、「人間が20秒で全滅する」なら3行とも上げる。" +
        "特定の階層だけが上位を占めているときは、その行の出現比を下げるほうが効く。",
      rows: [
        { key: "0", label: "強", note: "速く正確で、難度が上がっても崩れない。上位を占める層" },
        { key: "1", label: "中", note: "標準。シミュレーションの「普通の人間」と同じ実力に合わせてある" },
        { key: "2", label: "弱", note: "遅くミスも多く、難度に弱い。終盤で落ちていく層" },
      ],
      cols: [
        {
          key: "weight",
          label: "出現比",
          help: "99体をこの比で3階層へ振り分ける相対値（25/50/25 なら概ね25体・49体・25体）。合計が100である必要はない。0 にするとその階層は出てこない。",
        },
        {
          key: "msPerKey",
          label: "1打鍵の時間",
          unit: "ms",
          help: "★主に触るのはここ。1**打鍵**あたりの時間で、小さいほど速い＝強い。既定 150/200/280 は「普通の人間＝200ms/打鍵」を基準にしてある（この設定だと 200ms/打鍵の人がちょうど真ん中の54位/100に来る）。⚠ お題1本ぶんではなく打鍵1回ぶん（火力が上がると語が長くなるので、1本あたりで持つと終盤にBotだけが速くなる）。",
        },
        {
          key: "missRate",
          label: "ミス率",
          float: true,
          help: "打鍵1回あたりにミスする確率（0.05＝5%）。打鍵ごとに判定するので、長いお題ほどミス数が増える。上げると弱くなる。1 を超える値は入れられない。",
        },
        {
          key: "heatPenalty",
          label: "難度への弱さ",
          float: true,
          help: "火力が上がったときに何倍遅くなるか（0.04 なら火力17で 1+0.04×17＝1.68倍）。弱い階層ほど大きくすると「終盤に弱いBotから落ちる」自然な淘汰になる。0 にすると難度が上がっても速度が落ちない＝上手い。",
        },
      ],
      pathOf: (row, col) => `bot.tiers.${row}.${col}`,
    },
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
    key: "publish",
    title: "配信の間隔",
    icon: "📡",
    desc: "サーバーから各クライアントへ状態を送る頻度。小さいほど滑らかだが通信量が増える。⚠ 足切りの瞬間と提供の即レスは、この間引きを通らず必ず届く。",
    timing: "next-match",
    fields: [
      {
        path: "publish.evaluationIntervalMs",
        label: "自分のスコア・順位",
        unit: "ms",
        help: "自店のスコアと順位を送る間隔（既定250ms＝4Hz）。プレイヤーが見る唯一の指標なので、遅くすると順位表示がもたつく。2〜4Hz を目安に。",
      },
      {
        path: "publish.warningIntervalMs",
        label: "足切り予告",
        unit: "ms",
        help: "「次の足切りまであと何秒」を送る間隔（既定500ms＝2Hz）。秒読みはクライアントが受信時刻を起点に自分で進めるので、高頻度でなくてよい。",
      },
      {
        path: "publish.rankingIntervalMs",
        label: "全店ランキング（全量）",
        unit: "ms",
        help: "99店ぶんの順位表を送る間隔（既定1000ms＝1Hz）。ここが通信量の主役。1Hzで99台合計 約4.8Mbps・1試合71MB。",
      },
      {
        path: "publish.rankingDeltaEnabled",
        label: "差分配信を使う",
        bool: true,
        help: "オンにすると、全量に加えて「変化した店だけ」の差分を送り、通信量が約1/3になる。既定はオフ（まず全量だけで確実に動かす方針）。会場の回線が厳しい時に入れる。",
      },
      {
        path: "publish.rankingDeltaIntervalMs",
        label: "差分の間隔",
        unit: "ms",
        help: "差分配信の間隔（既定500ms＝2Hz）。上の「差分配信を使う」がオンの時だけ効く。",
      },
    ],
  },
  {
    key: "sanity",
    title: "申告の妥当性チェック",
    icon: "🛡️",
    desc: "クライアントが送ってくる所要時間の下限。ゲームバランスではなく「あり得ない申告を弾く」ための値。",
    timing: "next-match",
    fields: [
      {
        path: "sanity.minMsPerWord",
        label: "1語あたり最短時間",
        unit: "ms",
        help: "所要時間が「この値×注文数」を下回る申告は、この下限まで引き上げて扱う。人間の限界より少し下に置く。⚠ スコアには使われない（統計の汚染を防ぐためだけ）。",
      },
    ],
  },
  {
    key: "session",
    title: "試合ループ（内部）",
    icon: "⚙️",
    desc: "サーバー内部の更新周期。基本は既定のままでよい。",
    timing: "next-match",
    fields: [
      {
        path: "session.tickIntervalMs",
        label: "tick 周期",
        unit: "ms",
        help: "ゲームループの刻み。小さいほど処理が精密になるがCPU負荷が増える。本番は e2-micro（0.25vCPU）なので下げすぎない。",
      },
    ],
  },
];

/**
 * allFieldPaths はスキーマが宣言する全ての**編集可能な数値パス**を返す（重複なし）。
 *
 * 除外するもの:
 *   - 真偽値フィールド（allBoolPaths が返す）
 *   - 表示のみの列（cull.stages.*.atMs）。編集できないので検証の対象にしない
 */
export function allFieldPaths(): string[] {
  const out: string[] = [];
  for (const g of schema) {
    for (const f of g.fields ?? []) if (!f.bool) out.push(f.path);
    for (const sg of g.subgroups ?? []) for (const f of sg.fields) if (!f.bool) out.push(f.path);
    if (g.matrix) {
      for (const r of g.matrix.rows) {
        for (const c of g.matrix.cols) {
          if (!c.readonly) out.push(g.matrix.pathOf(r.key, c.key));
        }
      }
    }
  }
  return out;
}

/** allBoolPaths は真偽値フィールドのパス。 */
export function allBoolPaths(): string[] {
  const out: string[] = [];
  for (const g of schema) {
    for (const f of g.fields ?? []) if (f.bool) out.push(f.path);
    for (const sg of g.subgroups ?? []) for (const f of sg.fields) if (f.bool) out.push(f.path);
  }
  return out;
}

/** allReadonlyPaths は表示のみの列のパス（cull.stages.*.atMs）。 */
export function allReadonlyPaths(): string[] {
  const out: string[] = [];
  for (const g of schema) {
    if (!g.matrix) continue;
    for (const r of g.matrix.rows) {
      for (const c of g.matrix.cols) {
        if (c.readonly) out.push(g.matrix.pathOf(r.key, c.key));
      }
    }
  }
  return out;
}

/** EditValue は編集値。数値のほか、publish.rankingDeltaEnabled のような真偽値も入る。 */
export type EditValue = number | boolean;

/** allFieldSpecs はパス→表示情報の辞書。差分表示のラベル解決に使う。 */
export function allFieldSpecs(): Map<
  string,
  { label: string; group: string; unit?: string; float?: boolean; signed?: boolean }
> {
  const m = new Map<
    string,
    { label: string; group: string; unit?: string; float?: boolean; signed?: boolean }
  >();
  for (const g of schema) {
    for (const f of g.fields ?? []) {
      m.set(f.path, { label: f.label, group: g.title, unit: f.unit, float: f.float, signed: f.signed });
    }
    for (const sg of g.subgroups ?? []) {
      for (const f of sg.fields) {
        m.set(f.path, {
          label: `${sg.title} / ${f.label}`,
          group: g.title,
          unit: f.unit,
          float: f.float,
          signed: f.signed,
        });
      }
    }
    if (g.matrix) {
      for (const r of g.matrix.rows) {
        for (const c of g.matrix.cols) {
          m.set(g.matrix.pathOf(r.key, c.key), {
            label: `${r.label} / ${c.label}`,
            group: g.title,
            unit: c.unit,
            float: c.float,
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
