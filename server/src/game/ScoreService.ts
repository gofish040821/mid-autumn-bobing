/**
 * ScoreService —— 积分与排行榜。
 *
 * 积分只统计当前这一局；再来一局时全部清零。
 * 排序：score DESC，同分时 seat ASC（保证稳定）。
 */
import { FUN_TITLES, PRIZE_KEYS, PRIZE_NAMES } from '@bobing/shared';
import type { PlayerState, PrizeKey, PrizeLine, RankingEntry } from '@bobing/shared';
import { CHAMPION_BONUS, scoreForAward } from '../config/scoring.js';
import type { AwardId } from '@bobing/shared';

export { CHAMPION_BONUS, scoreForAward };

/** 把玩家奖品计数转成有序数组（按库存表顺序）。 */
export function prizesOf(player: PlayerState): PrizeLine[] {
  const lines: PrizeLine[] = [];
  for (const key of PRIZE_KEYS) {
    const count = player.prizes[key] ?? 0;
    if (count > 0) lines.push({ key, name: PRIZE_NAMES[key], count });
  }
  return lines;
}

/**
 * 排行榜。前三名的「榜眼 / 探花」只是趣味称号，不影响任何正式奖项与积分。
 */
export function computeRanking(
  players: readonly PlayerState[],
  finalChampionId: string | null,
): RankingEntry[] {
  const sorted = [...players].sort((a, b) => (b.score - a.score) || (a.seat - b.seat));
  return sorted.map((p, index) => {
    const rank = index + 1;
    return {
      playerId: p.id,
      nickname: p.nickname,
      seat: p.seat,
      score: p.score,
      rank,
      funTitle: FUN_TITLES[rank] ?? null,
      prizes: prizesOf(p),
      rollCount: p.rollCount,
      isFinalChampion: p.id === finalChampionId,
    };
  });
}

/** 给玩家加积分并返回新积分。 */
export function addScore(player: PlayerState, amount: number): number {
  player.score += amount;
  return player.score;
}

/** 给玩家记一笔奖品。 */
export function addPrize(player: PlayerState, key: PrizeKey, count = 1): void {
  player.prizes[key] = (player.prizes[key] ?? 0) + count;
}

/** 各奖项基础分（供测试与展示）。 */
export function baseScoreOf(awardId: AwardId): number {
  return scoreForAward(awardId);
}
