/**
 * GameStateMachine —— 阶段流转规则。
 *
 *   LOBBY ──2~15人开始──▶ NORMAL_TURN
 *   NORMAL_TURN ──首个 Champion Tier──▶ CHAMPION_CHASE
 *   CHAMPION_CHASE ──N-1 位各追一次──▶ SETTLING
 *   SETTLING ──发最终状元奖──▶ FINISHED
 *   FINISHED ──再来一局──▶ LOBBY
 */
import type { GameSnapshot, Phase } from '@bobing/shared';

const PHASE_TRANSITIONS: Record<Phase, readonly Phase[]> = {
  LOBBY: ['NORMAL_TURN'],
  NORMAL_TURN: ['CHAMPION_CHASE', 'FINISHED', 'LOBBY'],
  CHAMPION_CHASE: ['SETTLING', 'FINISHED', 'LOBBY'],
  SETTLING: ['FINISHED', 'LOBBY'],
  FINISHED: ['LOBBY'],
};

export function canTransitionPhase(from: Phase, to: Phase): boolean {
  if (from === to) return true;
  return PHASE_TRANSITIONS[from].includes(to);
}

export function assertTransitionPhase(from: Phase, to: Phase): void {
  if (!canTransitionPhase(from, to)) {
    throw new Error(`非法的阶段流转：${from} → ${to}`);
  }
}

/** 游戏进行中（含结算瞬间）不允许新玩家加入、也不允许修改昵称之外的房间结构。 */
export function isGameRunning(phase: Phase): boolean {
  return phase !== 'LOBBY';
}

/** 客户端应该展示「游戏页」的阶段。 */
export function isPlayingPhase(phase: Phase): boolean {
  return phase === 'NORMAL_TURN' || phase === 'CHAMPION_CHASE' || phase === 'SETTLING';
}

/** 客户端应该展示「结算页」的阶段。 */
export function isResultPhase(phase: Phase): boolean {
  return phase === 'FINISHED';
}

/** 是否处于追状元（用于 UI 提升气氛）。 */
export function isChampionChase(snapshot: GameSnapshot): boolean {
  return snapshot.phase === 'CHAMPION_CHASE';
}

/** 当前是否允许博饼。 */
export function canRollNow(phase: Phase): boolean {
  return phase === 'NORMAL_TURN' || phase === 'CHAMPION_CHASE';
}
