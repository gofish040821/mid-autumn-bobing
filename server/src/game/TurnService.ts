/**
 * TurnService —— 回合 id 生成与开奖请求校验。
 *
 * 这里的校验是防重复开奖的第一道闸门：
 *   1. 必须是当前回合的玩家；
 *   2. turnId 必须与当前回合一致；
 *   3. 当前回合必须还处于 WAITING（ROLLING / RESOLVING 期间一律拒绝）。
 */
import type { ErrorCode, Phase, TurnState } from '@bobing/shared';

export function formatTurnId(n: number): string {
  return `turn_${String(n).padStart(6, '0')}`;
}

export function formatRollId(n: number): string {
  return `roll_${String(n).padStart(6, '0')}`;
}

export function formatLogId(n: number): string {
  return `log_${String(n).padStart(6, '0')}`;
}

export function formatPlayerId(n: number): string {
  return `player_${String(n).padStart(4, '0')}`;
}

export function isRollablePhase(phase: Phase): boolean {
  return phase === 'NORMAL_TURN' || phase === 'CHAMPION_CHASE';
}

export interface RollValidationInput {
  phase: Phase;
  turn: TurnState | null;
  playerId: string;
  turnId: string;
  /** 同一个 (turnId, actionId) 是否已经处理过 */
  alreadyProcessed: boolean;
}

/** @returns null 表示校验通过，否则返回错误码 */
export function validateRollRequest(input: RollValidationInput): ErrorCode | null {
  const { phase, turn, playerId, turnId, alreadyProcessed } = input;

  if (phase === 'FINISHED') return 'GAME_FINISHED';
  if (!isRollablePhase(phase)) return 'INVALID_TURN';
  if (!turn) return 'INVALID_TURN';
  if (turn.playerId !== playerId) return 'NOT_YOUR_TURN';
  if (turn.turnId !== turnId) return 'INVALID_TURN';
  if (turn.status !== 'WAITING') return 'TURN_ALREADY_ROLLED';
  if (alreadyProcessed) return 'TURN_ALREADY_ROLLED';
  return null;
}

/** 回合子状态的合法流转：WAITING → ROLLING → RESOLVING → (下一回合 WAITING) */
const TURN_STATUS_FLOW: Record<TurnState['status'], readonly TurnState['status'][]> = {
  WAITING: ['ROLLING'],
  ROLLING: ['RESOLVING'],
  RESOLVING: [],
};

export function canAdvanceTurnStatus(
  from: TurnState['status'],
  to: TurnState['status'],
): boolean {
  return TURN_STATUS_FLOW[from].includes(to);
}
