/**
 * RuleEngine —— 纯函数，无副作用，不依赖任何全局状态。
 *
 * 严格按「奖项定义表」的 order 从高到低匹配，命中即返回。
 * 因此绝不会出现「低等级结果覆盖高等级结果」。
 *
 *   1  状元插金花  4 个 4 + 2 个 1
 *   2  六杯红      6 个 4
 *   3  遍地锦      6 个 1
 *   4  六抔黑      6 个相同(2/3/5/6)
 *   5  五红        5 个 4
 *   6  五子登科    5 个相同非 4
 *   7  四点红      4 个 4
 *   8  对堂        1~6 各一个
 *   9  四进        4 个相同非 4
 *   10 三红        3 个 4
 *   11 二举        2 个 4
 *   12 一秀        1 个 4
 *   13 无奖
 */
import { AWARDS, AWARD_MAP } from './awards.js';
import type { AwardDefinition } from './awards.js';
import type { AwardId } from './types.js';

export const DICE_COUNT = 6;
export const DICE_FACES = 6;

/** 六个面出现的次数，索引 1..6（索引 0 不使用）。 */
export type FaceCounts = readonly number[];

type Predicate = (counts: FaceCounts) => boolean;

const SIX_OF_NON_RED = (counts: FaceCounts): boolean =>
  counts[2] === 6 || counts[3] === 6 || counts[5] === 6 || counts[6] === 6;

const FIVE_OF_NON_RED = (counts: FaceCounts): boolean =>
  counts[1] === 5 ||
  counts[2] === 5 ||
  counts[3] === 5 ||
  counts[5] === 5 ||
  counts[6] === 5;

const FOUR_OF_NON_RED = (counts: FaceCounts): boolean =>
  counts[1] === 4 ||
  counts[2] === 4 ||
  counts[3] === 4 ||
  counts[5] === 4 ||
  counts[6] === 4;

/** 每个奖项的判定条件。NONE 恒真，作为兜底。 */
const PREDICATES: Record<AwardId, Predicate> = {
  CHAMPION_FLOWER: (c) => c[4] === 4 && c[1] === 2,
  SIX_FOUR: (c) => c[4] === 6,
  BROCADE: (c) => c[1] === 6,
  SIX_BLACK: SIX_OF_NON_RED,
  FIVE_FOUR: (c) => c[4] === 5,
  FIVE_SCHOLAR: FIVE_OF_NON_RED,
  FOUR_FOUR: (c) => c[4] === 4,
  DUITANG: (c) => c[1] === 1 && c[2] === 1 && c[3] === 1 && c[4] === 1 && c[5] === 1 && c[6] === 1,
  FOUR_ADVANCE: FOUR_OF_NON_RED,
  THREE_RED: (c) => c[4] === 3,
  TWO_LIFT: (c) => c[4] === 2,
  ONE_SHOW: (c) => c[4] === 1,
  NONE: () => true,
};

/** 统计每个点数出现的次数。 */
export function countFaces(dice: readonly number[]): FaceCounts {
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (const face of dice) {
    if (face >= 1 && face <= 6) counts[face] += 1;
  }
  return counts;
}

/** 骰子是否合法（六颗，每颗 1~6）。 */
export function isValidDice(dice: unknown): dice is number[] {
  return (
    Array.isArray(dice) &&
    dice.length === DICE_COUNT &&
    dice.every((d) => Number.isInteger(d) && d >= 1 && d <= DICE_FACES)
  );
}

/**
 * 核心判奖：传入六颗骰子，返回唯一奖项。
 * 永远有返回值，永远不返回 undefined。
 */
export function evaluateDice(dice: readonly number[]): AwardDefinition {
  const counts = countFaces(dice);
  for (const award of AWARDS) {
    if (PREDICATES[award.id](counts)) return award;
  }
  // AWARDS 中最后一项是 NONE（恒真），理论上不可达。
  return AWARD_MAP.NONE;
}

/** 只要奖项 id。 */
export function evaluateAwardId(dice: readonly number[]): AwardId {
  return evaluateDice(dice).id;
}

export function isChampionTier(award: AwardDefinition): boolean {
  return award.tier === 'CHAMPION';
}

const FACE_NAMES = ['', '一', '二', '三', '四', '五', '六'] as const;

/** 「四四四四一一」这种写法，用于游戏日志。 */
export function diceToChinese(dice: readonly number[]): string {
  return dice.map((d) => FACE_NAMES[d] ?? '?').join(' ');
}

/** 「4 4 4 4 1 1」，用于调试与测试。 */
export function diceToDigits(dice: readonly number[]): string {
  return dice.join(' ');
}

export function diceSum(dice: readonly number[]): number {
  return dice.reduce((a, b) => a + b, 0);
}

/** 排序后的稳定字符串，用于去重与测试。 */
export function diceKey(dice: readonly number[]): string {
  return [...dice].sort((a, b) => a - b).join('');
}

/**
 * 同档状元的次级比较值：**剩余点数之和**。
 *
 * 榜首先比 championRank；rank 相同时再比这个值，大者胜。
 * 例：同为四点红，444426 余 2+6=8，小于 444456 的 5+6=11。
 *
 * 只有「四点红 / 五红 / 五子登科」存在可比的余数：
 *  - 四点红   四颗四点固定，比余下两颗之和；
 *  - 五红     五颗四点固定，比余下那一颗；
 *  - 五子登科 五颗同点固定，比余下那一颗。
 *
 * 固定组合（状元插金花、六杯红、遍地锦、六抔黑）没有任何余数，
 * 恒为 0 —— 也就是同档之间仍然先出现者优先。
 */
export function championTiebreak(awardId: AwardId, dice: readonly number[]): number {
  const total = diceSum(dice);
  switch (awardId) {
    case 'FOUR_FOUR':
      // 四颗四点 = 16，余下两颗之和
      return total - 4 * 4;
    case 'FIVE_FOUR':
      // 五颗四点 = 20，余下一颗
      return total - 5 * 4;
    case 'FIVE_SCHOLAR': {
      // 五颗同点（必然非 4，否则会被五红先匹配），余下一颗
      const counts = countFaces(dice);
      for (let face = 1; face <= DICE_FACES; face += 1) {
        if (counts[face] === 5) return total - 5 * face;
      }
      return 0;
    }
    default:
      return 0;
  }
}
