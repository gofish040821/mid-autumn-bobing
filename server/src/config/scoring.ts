/**
 * 积分表 —— 从奖项定义表派生，避免两处硬编码走偏。
 *
 * 一秀 1 / 二举 2 / 三红 5 / 四进 8 / 对堂 15
 * 四点红 30 / 五子登科 40 / 五红 50 / 六抔黑 60 / 遍地锦 80 / 六杯红 100 / 状元插金花 120
 * 最终状元额外 +100（只加一次）
 */
import { AWARDS } from '@bobing/shared';
import type { AwardId } from '@bobing/shared';
import { CHAMPION_BONUS } from './gameConfig.js';

export { CHAMPION_BONUS };

export const SCORE_TABLE: Readonly<Record<AwardId, number>> = AWARDS.reduce(
  (acc, a) => {
    acc[a.id] = a.score;
    return acc;
  },
  {} as Record<AwardId, number>,
);

export function scoreForAward(awardId: AwardId): number {
  return SCORE_TABLE[awardId] ?? 0;
}
