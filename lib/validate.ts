// 保存前の検証。2段構えにしてある。
//
//   validate()     … 破綻値。保存ボタンを無効化する（サーバーの Validate() を先回りする）
//   riskWarnings() … 妥当だが事故りやすい値。保存前に確認ダイアログで列挙する
//
// validate はサーバー game.GameParameters.Validate() の条件を必ず含む。
// サーバーで弾かれてから気づくのを防ぐのが目的。
//
// ⚠ **サーバーが最終防衛線。** ここは UX のための先出し検証であって、
// サーバー側の検証を省く理由にはしない（plan-h24 §4.4）。

import {
  CULL_STAGE_COUNT,
  MAX_WORD_LEVEL,
  allFieldPaths,
  allFieldSpecs,
  getNumber,
  type GameParameters,
} from "./params";

export type Issue = { path?: string; message: string };

export function validate(p: GameParameters): Issue[] {
  const errs: Issue[] = [];
  const n = (path: string) => getNumber(p, path);
  const specs = allFieldSpecs();

  // --- 全項目に共通の形式チェック -----------------------------------------
  for (const path of allFieldPaths()) {
    const v = n(path);
    const spec = specs.get(path);
    const label = spec ? `${spec.group} / ${spec.label}` : path;
    if (!Number.isFinite(v)) {
      errs.push({ path, message: `${label}: 数値を入力してください` });
      continue;
    }
    // signed が付いた項目（odai.levelOffset）だけは負値が正常な使い方。
    // ここを一律に弾くと「お題だけやさしくする」ができず、片側にしか動かないツマミになる。
    if (v < 0 && !spec?.signed) {
      errs.push({ path, message: `${label}: 0 以上にしてください` });
      continue;
    }
    if (!spec?.float && !Number.isInteger(v)) {
      errs.push({ path, message: `${label}: 整数で入力してください` });
    }
  }

  // --- サーバー game.GameParameters.Validate() と同一の条件 ----------------
  if (n("customer.total") <= 0) {
    errs.push({ path: "customer.total", message: "客の総数は 1 以上である必要があります" });
  }
  if (n("session.tickIntervalMs") <= 0) {
    errs.push({ path: "session.tickIntervalMs", message: "tick 周期は 1 以上である必要があります" });
  }
  if (n("bot.baseElapsedMs") <= 0) {
    errs.push({ path: "bot.baseElapsedMs", message: "Bot の1お題の時間は 1 以上である必要があります" });
  }
  if (n("bot.baseAccuracy") < 0 || n("bot.baseAccuracy") > 1) {
    errs.push({ path: "bot.baseAccuracy", message: "Bot の精度は 0〜1 の範囲である必要があります" });
  }
  if (n("heat.maxLevel") <= 0) {
    errs.push({ path: "heat.maxLevel", message: "火力の上限は 1 以上である必要があります" });
  }
  if (n("score.weightTakoyaki") <= 0) {
    errs.push({
      path: "score.weightTakoyaki",
      message: "たこ焼き1個の加点は 1 以上である必要があります（0 だと点が入らず順位が付きません）",
    });
  }
  // score.weightMiss は 0 を許す（ミスを罰しない設定でバランスを見たい場合がある）。
  // 負値は上の共通チェックが弾く。
  for (const key of [
    "publish.evaluationIntervalMs",
    "publish.warningIntervalMs",
    "publish.rankingIntervalMs",
    "publish.rankingDeltaIntervalMs",
  ]) {
    if (n(key) <= 0) {
      errs.push({ path: key, message: "配信間隔は 1 以上である必要があります（0 だと毎tick配信になり帯域が破綻します）" });
    }
  }

  // --- 足切りスケジュール（サーバー CullParams.validate と同一条件）-----------
  errs.push(...validateCull(p));

  // --- お題のツマミ（plan-h35 §2）------------------------------------------
  // levelSpread が負だとサーバーの rng.Intn が panic する（サーバー側 Validate も弾く）。
  // 共通チェックが既に負値を弾いているが、条件を緩めた時に素通りしないよう明示しておく。
  if (n("odai.levelSpread") < 0) {
    errs.push({ path: "odai.levelSpread", message: "1語ごとのばらつきは 0 以上にしてください" });
  }
  // warnMaxIds は 0 を許す（サーバーが「未設定」として既定24に読み替えるため）。負値は共通チェック。

  // --- フロント独自の整合性チェック ---------------------------------------
  if (n("matching.minPlayers") > n("matching.maxPlayers")) {
    errs.push({
      path: "matching.minPlayers",
      message: "開始最小人数は最大人数以下にしてください",
    });
  }
  if (n("phase.lateAliveThreshold") > n("phase.midAliveThreshold")) {
    errs.push({
      path: "phase.lateAliveThreshold",
      message: "終盤の生存数しきい値は中盤以下にしてください（終盤のほうが生存店は少ない）",
    });
  }
  if (n("phase.midTimeMs") > n("phase.lateTimeMs")) {
    errs.push({
      path: "phase.midTimeMs",
      message: "中盤へ移行する時間は終盤より前にしてください",
    });
  }
  const weightSum =
    n("customer.normal.weight") +
    n("customer.bonus.weight") +
    n("customer.claimer.weight") +
    n("customer.buzz.weight");
  if (Number.isFinite(weightSum) && weightSum <= 0) {
    errs.push({
      path: "customer.normal.weight",
      message: "客の出現比は合計が 1 以上になるようにしてください（全部 0 だと客が出ません）",
    });
  }
  if (
    n("presentation.finalRushAliveThreshold") > n("presentation.finalStageAliveThreshold")
  ) {
    errs.push({
      path: "presentation.finalRushAliveThreshold",
      message: "最終盤演出のしきい値は終盤演出以下にしてください",
    });
  }
  return errs;
}

/**
 * validateCull は足切りスケジュールを検証する。サーバー CullParams.validate と同一条件。
 *
 * 🔴 **ゼロ埋めの罠がここの存在理由。** サーバーは [6]CullStage の固定長配列で受けるので、
 * 要素が足りない JSON を送ると Go 側が残りをゼロ値で埋め、
 * 「0秒時点で生存0＝開始直後に全店即死」が成立してしまう。
 */
function validateCull(p: GameParameters): Issue[] {
  const errs: Issue[] = [];
  const stages = p.cull?.stages;
  if (!Array.isArray(stages) || stages.length !== CULL_STAGE_COUNT) {
    errs.push({
      path: "cull.stages.0.targetAliveCount",
      message: `足切りは ${CULL_STAGE_COUNT} 段階ちょうどである必要があります（現在 ${Array.isArray(stages) ? stages.length : 0} 段階）`,
    });
    return errs;
  }

  let prevAt = 0;
  let prevTarget = -1;
  stages.forEach((st, i) => {
    const path = `cull.stages.${i}.targetAliveCount`;
    const at = Number(st?.atMs);
    const target = Number(st?.targetAliveCount);
    const last = i === stages.length - 1;

    if (!Number.isFinite(at) || at <= 0) {
      errs.push({ path, message: `第${i + 1}段階: 時刻が不正です（${at}）` });
    } else if (at <= prevAt) {
      errs.push({ path, message: `第${i + 1}段階: 時刻が前の段階より後である必要があります` });
    }
    if (!Number.isFinite(target) || target < 0 || !Number.isInteger(target)) {
      errs.push({ path, message: `第${i + 1}段階: 目標生存数は 0 以上の整数にしてください` });
    } else if (prevTarget >= 0 && target > prevTarget) {
      errs.push({
        path,
        message: `第${i + 1}段階: 目標生存数は前の段階(${prevTarget})以下にしてください（生存数は増えません）`,
      });
    } else if (last && target !== 0) {
      errs.push({
        path,
        message: `最終段階の目標生存数は 0 である必要があります（120秒で全店が脱落して試合が終わります）`,
      });
    } else if (!last && target <= 0) {
      errs.push({
        path,
        message: `第${i + 1}段階: 目標生存数は 1 以上にしてください（最終段階より前に生存0にすると試合が途中で終わります）`,
      });
    }

    if (Number.isFinite(at)) prevAt = at;
    if (Number.isFinite(target)) prevTarget = target;
  });
  return errs;
}

/**
 * riskWarnings は「保存はできるが事故りやすい」値を返す。
 * maxWordLevel には words 画面で取得した実際の最大 level を渡せる（未取得なら辞書の既定を使う）。
 */
export function riskWarnings(p: GameParameters, maxWordLevel = MAX_WORD_LEVEL): string[] {
  const w: string[] = [];
  const n = (path: string) => getNumber(p, path);

  // ★本作の性格を決める値。極端にすると「片方の打ち方だけが正解」になる。
  const wt = n("score.weightTakoyaki");
  const wm = n("score.weightMiss");
  if (Number.isFinite(wt) && Number.isFinite(wm) && wt > 0) {
    const ratio = wm / wt;
    if (ratio < 0.18) {
      w.push(
        `ミス減点がたこ焼き加点の ${(ratio * 100).toFixed(0)}% と軽く、「ミスを恐れず速く打つ」一辺倒になります（既定は30%。シミュレーションでは18%で正確に打つ人が下位3分の1に沈みました）`,
      );
    }
    if (ratio > 0.45) {
      w.push(
        `ミス減点がたこ焼き加点の ${(ratio * 100).toFixed(0)}% と重く、速く打つ意味が薄くなります（既定は30%）`,
      );
    }
  }

  // 中間段階を大きく動かすと脱落カーブの体感が変わる。
  const stages = p.cull?.stages ?? [];
  if (stages.length === CULL_STAGE_COUNT) {
    if (stages[0]?.targetAliveCount !== 75) {
      w.push(
        `第1段階の目標生存数が ${stages[0]?.targetAliveCount} です（既定75）。ここを下げると20秒時点で切られる人が増えます`,
      );
    }
    if (stages[4]?.targetAliveCount !== 10) {
      w.push(
        `第5段階の目標生存数が ${stages[4]?.targetAliveCount} です。**決勝の人数**なので企画で10に確定しています`,
      );
    }
  }

  if (n("matching.minPlayers") < 3 && n("matching.minFill") === 0) {
    w.push(
      `開始最小人数 ${n("matching.minPlayers")} 人・Bot補完なしです。ほぼ即座に試合が始まります`,
    );
  }
  if (n("matching.minPlayers") > n("matching.minFill") && n("matching.minFill") > 0) {
    w.push(
      `Bot補完人数(${n("matching.minFill")}) が開始最小人数(${n("matching.minPlayers")}) を下回っています。人間だけで最小人数を満たす必要があります`,
    );
  }

  if (n("heat.maxLevel") > maxWordLevel) {
    w.push(
      `火力の上限(${n("heat.maxLevel")}) がお題辞書の最大レベル(${maxWordLevel}) を超えています。超えた分は下位レベルの語が出るため難度が上がりません`,
    );
  }

  const aliveGuess = Math.max(1, n("matching.maxPlayers"));
  if (n("customer.total") < aliveGuess * n("distribution.queueRefillThreshold")) {
    w.push(
      `客の総数(${n("customer.total")}) が「店数 × 行列しきい値」(${aliveGuess * n("distribution.queueRefillThreshold")}) を下回っています。序盤から客が行き渡りません`,
    );
  }

  if (n("bot.baseAccuracy") > 0.95 || n("bot.baseElapsedMs") < 1000) {
    w.push("Bot が人間より強い設定です（精度が高すぎる、または1お題が速すぎる）");
  }
  if (n("session.tickIntervalMs") < 50) {
    w.push(
      `tick 周期が ${n("session.tickIntervalMs")}ms と短く、本番サーバー（e2-micro / 0.25vCPU）には重い可能性があります`,
    );
  }
  if (n("publish.rankingIntervalMs") < 500) {
    w.push(
      `全店ランキングの配信間隔が ${n("publish.rankingIntervalMs")}ms と短く、通信量が大きく増えます（1Hzで99台合計 約4.8Mbps・1試合71MB が目安）`,
    );
  }
  if (n("publish.evaluationIntervalMs") > 500) {
    w.push(
      `自分のスコア・順位の配信が ${n("publish.evaluationIntervalMs")}ms 間隔と遅く、順位表示がもたつきます（2〜4Hz＝250〜500ms が目安）`,
    );
  }
  // --- 難度カーブ（plan-h32）----------------------------------------------
  //
  // 🔴 「火力が辞書の上端に届かない」は #75 → h26 → h32 と**3回**再発している。
  // 旧ルール（phaseLate < 9 なら警告）は phaseLate だけを見ていたため、
  // perAliveDrop を 0.1→0.05 に下げたときに素通りし、本番で上端に届かなくなった。
  // **式そのものを再現して到達値を出す**のが再発防止になる。
  //
  //   heat = base + int(perAliveDrop×脱落数) + int(perElapsedSec×経過秒) + フェーズ加算
  const durationSec = (stages[stages.length - 1]?.atMs ?? 0) / 1000;
  // 最終ステージ(生存0)の1つ手前が「決勝の生存数」。試合はここで最高難度になる。
  const finalAlive = stages[stages.length - 2]?.targetAliveCount ?? 0;
  const peakHeat =
    n("heat.base") +
    Math.floor(n("heat.perAliveDrop") * (n("matching.maxPlayers") - finalAlive)) +
    Math.floor(n("heat.perElapsedSec") * durationSec) +
    n("heat.phaseLate");
  if (peakHeat < n("heat.maxLevel")) {
    w.push(
      `火力が試合終了(${durationSec}秒・生存${finalAlive}店)までに ${peakHeat} までしか上がらず、上限 ${n("heat.maxLevel")} に届きません。最上位レベルの語彙が一度も出ず、「火力の上限」が効かないツマミになります（「1秒あたりの上昇」を上げてください）`,
    );
  }
  if (n("heat.perElapsedSec") <= 0) {
    w.push(
      "火力の「1秒あたりの上昇」が 0 です。難度が生存数とフェーズでしか動かず、足切りの瞬間だけ跳ねる階段状のカーブになります（h32 で時間主軸に変えた項目）",
    );
  }
  // --- お題のツマミ（plan-h35 §2）------------------------------------------
  //
  // 🔴 warnMaxIds は**クライアントと合意済みの値**。黙って変えるとクライアント側の
  // 右パネルの想定件数と食い違う。保存前に必ず気付けるようにする。
  const warnMax = n("cull.warnMaxIds");
  if (Number.isFinite(warnMax) && warnMax !== 24) {
    w.push(
      `足切り予告に載せる店数の上限が ${warnMax} です（既定24）。**24 はクライアントと合意済みの値**なので、変えるならクライアント担当に必ず共有してください`,
    );
  }
  const off = n("odai.levelOffset");
  if (Number.isFinite(off) && off !== 0) {
    w.push(
      `お題の難度に ${off > 0 ? "+" : ""}${off} の下駄がかかります。クライアントに表示される火力レベルは変わらないので、**表示より${off > 0 ? "難しい" : "やさしい"}お題**が出ます（それがこのツマミの狙いですが、当日の混乱の元にもなります）`,
    );
  }
  const spread = n("odai.levelSpread");
  if (Number.isFinite(spread) && spread >= 4) {
    w.push(
      `お題のばらつきが ±${spread} と大きく、同じ火力でも簡単な語と難しい語が混ざりすぎて「運で決まる」感じが出ます`,
    );
  }

  if (n("heat.phaseLate") - n("heat.phaseMid") >= 4) {
    w.push(
      `終盤フェーズ突入で火力が一気に +${n("heat.phaseLate") - n("heat.phaseMid")} 跳ねます。プレイヤーには「別のゲームに切り替わった」ように感じられます（差は小さくし、難度は「1秒あたりの上昇」で上げてください）`,
    );
  }

  return w;
}
