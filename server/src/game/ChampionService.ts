/**
 * ChampionService —— 追状元队列、状元换人。
 *
 * 这里只决定「谁在什么时候能坐上状元位」，不碰骰子。
 */
import type { ChampionState, PlayerState } from '@bobing/shared';

export function emptyChampionState(): ChampionState {
  return {
    playerId: null,
    nickname: null,
    seat: null,
    awardId: null,
    dice: null,
    rank: 0,
    tiebreak: 0,
    chaseQueue: [],
    chaseTotal: 0,
    chaseDone: 0,
    replacements: 0,
    finalPlayerId: null,
  };
}

/**
 * 追状元队列：从首状元的下家开始，按座位顺序绕一圈，**不含首状元本人**。
 * 长度恒为 N - 1。
 */
export function buildChaseQueue(
  players: readonly PlayerState[],
  championPlayerId: string,
): string[] {
  const ordered = [...players].sort((a, b) => a.seat - b.seat);
  const idx = ordered.findIndex((p) => p.id === championPlayerId);
  if (idx < 0) return ordered.map((p) => p.id);
  return [...ordered.slice(idx + 1), ...ordered.slice(0, idx)].map((p) => p.id);
}

/**
 * 是否替换当前状元。
 *
 * 两级比较，缺一不可：
 *  1. Champion Rank 高者胜（插金花 7 → 四点红 1）；
 *  2. Rank 相同时再比「剩余点数之和」—— 同为四点红，444456 大于 444426。
 *
 * 两级都持平才不动，即同档同余数先出现者优先。
 *
 * `emptyChampionState().rank` 是 0，而所有 Champion Tier 的 rank 都 ≥ 1，
 * 于是「本局第一位状元」天然被同一条谓词覆盖，不需要额外的首中分支。
 */
export function shouldReplaceChampion(
  currentRank: number,
  currentTiebreak: number,
  challengerRank: number,
  challengerTiebreak: number,
): boolean {
  if (challengerRank !== currentRank) return challengerRank > currentRank;
  return challengerTiebreak > currentTiebreak;
}
