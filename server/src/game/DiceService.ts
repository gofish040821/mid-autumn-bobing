/**
 * DiceService —— 服务端唯一产生骰子的地方。
 *
 * 客户端永远不能提交点数；这里也不接受任何来自客户端的随机源。
 * 所有随机数都通过可注入的 Rng 获取，方便测试时替换成确定性序列。
 */
import { CHAMPION_WEIGHTS, MOON_BLESSING_START_ROUND, CHAMPION_GUARANTEE_ROUND, MOON_BLESSING_INITIAL_RATE, MOON_BLESSING_RATE_INCREMENT, MOON_BLESSING_MAX_RATE } from '../config/gameConfig.js';
import { DICE_COUNT, DICE_FACES, evaluateDice } from './RuleEngine.js';
import type { AwardId } from '@bobing/shared';

export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** 取 [1,6] 的一个整数。对 rng() 的返回值做了防御性夹取，rng 返回 1 也不会越界。 */
export function randomFace(rng: Rng = defaultRng): number {
  const r = rng();
  const clamped = Number.isFinite(r) ? Math.min(0.9999999, Math.max(0, r)) : 0;
  return 1 + Math.floor(clamped * DICE_FACES);
}

/** 一次完整的六颗骰子随机（1~6 均匀）。 */
export function rollRawDice(rng: Rng = defaultRng): number[] {
  const dice: number[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) dice.push(randomFace(rng));
  return dice;
}

function shuffle<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.min(0.9999999, Math.max(0, rng())) * (i + 1));
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/** 从 {1,2,3,5,6} 中取一个（即「非四点」）。 */
function randomNonFour(rng: Rng): number {
  const pool = [1, 2, 3, 5, 6];
  return pool[Math.floor(Math.min(0.9999999, Math.max(0, rng())) * pool.length)];
}

type ChampionId = Extract<
  AwardId,
  'CHAMPION_FLOWER' | 'SIX_FOUR' | 'BROCADE' | 'SIX_BLACK' | 'FIVE_FOUR' | 'FIVE_SCHOLAR' | 'FOUR_FOUR'
>;

/** 兜底骰型：万一随机构造出意外结果，直接退回这些确定值。 */
const CANONICAL_CHAMPION_DICE: Record<ChampionId, number[]> = {
  CHAMPION_FLOWER: [4, 4, 4, 4, 1, 1],
  SIX_FOUR: [4, 4, 4, 4, 4, 4],
  BROCADE: [1, 1, 1, 1, 1, 1],
  SIX_BLACK: [2, 2, 2, 2, 2, 2],
  FIVE_FOUR: [4, 4, 4, 4, 4, 2],
  FIVE_SCHOLAR: [3, 3, 3, 3, 3, 6],
  FOUR_FOUR: [4, 4, 4, 4, 2, 6],
};

/**
 * 构造一组「恰好等于指定 Champion Tier」的骰子。
 *
 * 注意所有构造都刻意避开了会升级成更高奖项的组合：
 *  - 四点红的后两颗只从 {2,3,5,6} 取，避免凑成「两个一点」变成插金花；
 *  - 五红 / 五子登科 的第六颗一定与重复点数不同，避免变成六抔黑等级。
 * 最后再跑一遍 RuleEngine 自检，不一致就退回确定值。
 */
export function generateChampionDice(awardId: ChampionId, rng: Rng = defaultRng): number[] {
  let dice: number[];
  switch (awardId) {
    case 'CHAMPION_FLOWER':
      dice = [4, 4, 4, 4, 1, 1];
      break;
    case 'SIX_FOUR':
      dice = [4, 4, 4, 4, 4, 4];
      break;
    case 'BROCADE':
      dice = [1, 1, 1, 1, 1, 1];
      break;
    case 'SIX_BLACK': {
      const v = [2, 3, 5, 6][Math.floor(Math.min(0.9999999, Math.max(0, rng())) * 4)];
      dice = [v, v, v, v, v, v];
      break;
    }
    case 'FIVE_FOUR': {
      const extra = randomNonFour(rng);
      dice = [4, 4, 4, 4, 4, extra];
      break;
    }
    case 'FIVE_SCHOLAR': {
      const v = randomNonFour(rng);
      let extra = randomNonFour(rng);
      if (extra === v) extra = v === 6 ? 5 : 6;
      dice = [v, v, v, v, v, extra];
      break;
    }
    case 'FOUR_FOUR': {
      // 后两颗只从 {2,3,5,6} 取：既不会变成「两个一点」，也不会变成「六个四点」
      const pool = [2, 3, 5, 6];
      const a = pool[Math.floor(Math.min(0.9999999, Math.max(0, rng())) * pool.length)];
      const b = pool[Math.floor(Math.min(0.9999999, Math.max(0, rng())) * pool.length)];
      dice = [4, 4, 4, 4, a, b];
      break;
    }
  }
  if (evaluateDice(dice).id !== awardId) {
    dice = [...CANONICAL_CHAMPION_DICE[awardId]];
  }
  return shuffle(dice, rng);
}

/** 按权重抽取一个 Champion Tier。 */
export function pickWeightedChampion(
  rng: Rng = defaultRng,
  weights: Readonly<Record<string, number>> = CHAMPION_WEIGHTS,
): ChampionId {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((sum, [, w]) => sum + w, 0);
  let target = Math.min(0.9999999, Math.max(0, rng())) * total;
  for (const [id, weight] of entries) {
    target -= weight;
    if (target < 0) return id as ChampionId;
  }
  return entries[entries.length - 1][0] as ChampionId;
}

/* ------------------------------------------------------------------ *
 * 月华加持 / 状元保底
 * ------------------------------------------------------------------ */

/** 保底触发的那一次掷骰序号（5N）。 */
export function guaranteeRollNumber(playerCount: number): number {
  return CHAMPION_GUARANTEE_ROUND * playerCount;
}

/**
 * 当前这一次掷骰的额外状元概率。
 *
 * 第一轮（前 N 次）恒为 0；第二轮第一次为 MOON_BLESSING_INITIAL_RATE，
 * 之后每掷一次未出状元再加 MOON_BLESSING_RATE_INCREMENT，封顶 MAX。
 *
 * @param normalRollCount 已经完成的普通阶段掷骰次数（本次掷骰前）
 */
export function computeBlessingRate(normalRollCount: number, playerCount: number): number {
  if (playerCount <= 0) return 0;
  const rollNumber = normalRollCount + 1;
  const startRoll = (MOON_BLESSING_START_ROUND - 1) * playerCount + 1;
  if (rollNumber < startRoll) return 0;
  const k = rollNumber - startRoll;
  return Math.min(MOON_BLESSING_INITIAL_RATE + MOON_BLESSING_RATE_INCREMENT * k, MOON_BLESSING_MAX_RATE);
}

/** 这一次掷骰是否已经进入保底。 */
export function isGuaranteedRoll(normalRollCount: number, playerCount: number): boolean {
  return normalRollCount + 1 >= guaranteeRollNumber(playerCount);
}

export interface NormalPhaseOutcome {
  dice: number[];
  /** 由月华加持额外催生 */
  blessed: boolean;
  /** 由保底强制产生 */
  guaranteed: boolean;
}

/**
 * 普通阶段的骰子生成：
 *   1. 先真随机掷一次；
 *   2. 若本来就是 Champion Tier，直接采用（不消耗加持）；
 *   3. 否则按当前月华概率决定是否额外催生一个 Champion Tier；
 *   4. 到达保底序号时无条件保底。
 */
export function rollNormalPhase(
  normalRollCount: number,
  playerCount: number,
  rng: Rng = defaultRng,
): NormalPhaseOutcome {
  if (isGuaranteedRoll(normalRollCount, playerCount)) {
    const awardId = pickWeightedChampion(rng);
    return { dice: generateChampionDice(awardId, rng), blessed: false, guaranteed: true };
  }

  const dice = rollRawDice(rng);
  if (evaluateDice(dice).tier === 'CHAMPION') {
    return { dice, blessed: false, guaranteed: false };
  }

  const rate = computeBlessingRate(normalRollCount, playerCount);
  if (rate > 0 && rng() < rate) {
    const awardId = pickWeightedChampion(rng);
    return { dice: generateChampionDice(awardId, rng), blessed: true, guaranteed: false };
  }

  return { dice, blessed: false, guaranteed: false };
}

/** 追状元阶段：关闭一切概率干预，纯随机。 */
export function rollChasePhase(rng: Rng = defaultRng): number[] {
  return rollRawDice(rng);
}
