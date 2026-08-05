// 保存前の検証。2段構えにしてある。
//
//   validate()     … 破綻値。保存ボタンを無効化する（サーバーの Validate() を先回りする）
//   riskWarnings() … 妥当だが事故りやすい値。保存前に確認ダイアログで列挙する
//
// validate はサーバー game.GameParameters.Validate() の9条件を必ず含む。
// サーバーで弾かれてから気づくのを防ぐのが目的。

import {
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
    if (v < 0) {
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
  if (n("credit.initialLife") <= 0) {
    errs.push({ path: "credit.initialLife", message: "初期ライフは 1 以上である必要があります" });
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
  if (n("storm.thresholdPct") < 0 || n("storm.thresholdPct") > 1) {
    errs.push({ path: "storm.thresholdPct", message: "淘汰する割合は 0〜1 の範囲である必要があります" });
  }
  // storm.intervalTicks >= 0 / phase.midAliveThreshold >= 0 は上の共通チェックが担う。

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
  if (n("storm.warnTicks") > n("storm.intervalTicks")) {
    errs.push({
      path: "storm.warnTicks",
      message: "予告の先出しは淘汰の間隔以下にしてください（超えると予告が出ません）",
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
  if (n("patience.lateMul") <= 0) {
    errs.push({
      path: "patience.lateMul",
      message: "終盤の短縮倍率は 0 より大きくしてください（0 だと短縮が無効になります）",
    });
  }

  return errs;
}

/**
 * riskWarnings は「保存はできるが事故りやすい」値を返す。
 * maxWordLevel には words 画面で取得した実際の最大 level を渡せる（未取得なら辞書の既定を使う）。
 */
export function riskWarnings(p: GameParameters, maxWordLevel = MAX_WORD_LEVEL): string[] {
  const w: string[] = [];
  const n = (path: string) => getNumber(p, path);

  // 決着不能はこの画面で防げる最悪の事故。Takoda99 に制限時間はない。
  if (n("storm.intervalTicks") === 0) {
    w.push(
      "下位淘汰の間隔が 0＝淘汰が無効です。この試合には制限時間がないため、決着しなくなる可能性があります",
    );
  }
  if (n("storm.thresholdPct") === 0) {
    w.push(
      "淘汰する割合が 0 です。下位淘汰が誰も脱落させないため、決着が信用切れ（自滅）頼みになります",
    );
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

  const wsum = n("eval.weightAccuracy") + n("eval.weightSpeed");
  if (Math.abs(wsum - 1) > 0.2) {
    w.push(`精度と速度の重みの合計が ${wsum.toFixed(2)} です（1.0 を目安にしてください）`);
  }

  if (n("bot.baseAccuracy") > 0.95 || n("bot.baseElapsedMs") < 1000) {
    w.push("Bot が人間より強い設定です（精度が高すぎる、または1お題が速すぎる）");
  }
  if (n("session.tickIntervalMs") < 50) {
    w.push(
      `tick 周期が ${n("session.tickIntervalMs")}ms と短く、本番サーバー（e2-micro / 0.25vCPU）には重い可能性があります`,
    );
  }
  if (n("session.publishIntervalMs") < 150) {
    w.push(
      `盤面配信間隔が ${n("session.publishIntervalMs")}ms と短く、通信量が大きく増えます（実測で1試合あたり数百MB）`,
    );
  }
  if (n("patience.lateMul") > 0 && n("patience.lateMul") < 0.3) {
    w.push(`終盤の短縮倍率 ${n("patience.lateMul")} は客がかなり早く帰ります（理不尽になりがち）`);
  }
  if (n("credit.initialLife") <= 3) {
    w.push(
      `初期ライフ ${n("credit.initialLife")} は少なく、試合が非常に短くなる可能性があります（既定は 20）`,
    );
  }

  return w;
}
