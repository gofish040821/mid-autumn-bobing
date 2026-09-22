/**
 * ChampionService —— 追状元队列、状元换人、月华值视图。
 */
import type { ChampionState, MoonBlessingView, PlayerState } from '@bobing/shared';
import { MOON_BLESSING_START_ROUND } from '../config/gameConfig.js';
import { computeBlessingRate, guaranteeRollNumber } from './DiceService.js';

export function emptyChampionState(): ChampionState {
  return {
    playerId: null,
    nickname: null,
    seat: null,
    awardId: null,
    dice: null,
    rank: 0,
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
 * 只有**严格更高**的 Champion Rank 才能反超；同等级先出现者优先。
 */
export function shouldReplaceChampion(currentRank: number, challengerRank: number): boolean {
  return challengerRank > currentRank;
}

export interface MoonBlessingInput {
  normalRollCount: number;
  playerCount: number;
  /** 是否已经产生首位状元（进入追状元后机制关闭） */
  championFound: boolean;
}

/**
 * 月华值的只读展示视图。
 *
 * 第一轮完全不展示（IDLE），第二轮起月亮逐渐点亮，
 * 临近保底时提示「月华将满 · 状元将至」——但永远不会明说「下一把必出状元」。
 */
export function buildMoonBlessingView(input: MoonBlessingInput): MoonBlessingView {
  const { normalRollCount, playerCount, championFound } = input;
  const guaranteeAtRoll = guaranteeRollNumber(playerCount);

  if (championFound) {
    return {
      stage: 'DONE',
      rate: 0,
      normalRollCount,
      guaranteeAtRoll,
      progress: 1,
      text: '状元已出 · 月华归隐',
      nearGuarantee: false,
    };
  }

  const rollNumber = normalRollCount + 1;
  const windowStart = (MOON_BLESSING_START_ROUND - 1) * playerCount + 1;

  if (playerCount <= 0 || rollNumber < windowStart) {
    return {
      stage: 'IDLE',
      rate: 0,
      normalRollCount,
      guaranteeAtRoll,
      progress: 0,
      text: '月华未起',
      nearGuarantee: false,
    };
  }

  const span = Math.max(1, guaranteeAtRoll - windowStart);
  const progress = Math.min(1, Math.max(0, (rollNumber - windowStart) / span));
  const nearGuarantee = progress >= 0.75;

  return {
    stage: nearGuarantee ? 'FULL' : 'CHARGING',
    rate: computeBlessingRate(normalRollCount, playerCount),
    normalRollCount,
    guaranteeAtRoll,
    progress,
    text: nearGuarantee ? '月华将满 · 状元将至' : '月华渐满',
    nearGuarantee,
  };
}
