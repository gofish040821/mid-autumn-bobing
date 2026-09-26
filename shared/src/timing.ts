/**
 * 演出节奏表 —— 客户端与服务端共用的唯一节奏来源。
 *
 * 服务端在 roll:result 之后要等「骰子动画 + 中奖演出」播完才推进下一回合，
 * 客户端在同样的时间轴上播放动画。两边读同一张表，节奏才不会错位。
 *
 * 原则：下一次博饼永远来得很快，绝不让人等。
 */
import type { AwardId } from './types.js';

export interface RollTiming {
  /** 骰子动画时长 */
  diceMs: number;
  /** 开奖演出时长（骰子停下之后开始） */
  celebrationMs: number;
}

// 所有奖项掷骰时长相同，观众不能从动画长短提前推测奖项。
export const ROLL_TIMING: Readonly<Record<AwardId, RollTiming>> = {
  CHAMPION_FLOWER: { diceMs: 1800, celebrationMs: 2600 },
  SIX_FOUR: { diceMs: 1800, celebrationMs: 2000 },
  BROCADE: { diceMs: 1800, celebrationMs: 1900 },
  SIX_BLACK: { diceMs: 1800, celebrationMs: 1900 },
  FIVE_FOUR: { diceMs: 1800, celebrationMs: 1800 },
  FIVE_SCHOLAR: { diceMs: 1800, celebrationMs: 1800 },
  FOUR_FOUR: { diceMs: 1800, celebrationMs: 1700 },
  DUITANG: { diceMs: 1800, celebrationMs: 1500 },
  FOUR_ADVANCE: { diceMs: 1800, celebrationMs: 1250 },
  THREE_RED: { diceMs: 1800, celebrationMs: 1250 },
  TWO_LIFT: { diceMs: 1800, celebrationMs: 1050 },
  ONE_SHOW: { diceMs: 1800, celebrationMs: 1050 },
  NONE: { diceMs: 1800, celebrationMs: 850 },
};

/** 服务端推进下一回合前额外留的缓冲，避免和客户端动画抢最后几十毫秒。 */
export const TRANSITION_BUFFER_MS = 220;

export function timingFor(awardId: AwardId): RollTiming {
  return ROLL_TIMING[awardId] ?? ROLL_TIMING.NONE;
}

/** 一次博饼从「点下去」到「可以再次点击」的总时长。 */
export function totalRollMs(awardId: AwardId): number {
  const t = timingFor(awardId);
  return t.diceMs + t.celebrationMs;
}

/** 服务端在 roll:result 之后等待多久再推进下一回合。 */
export function transitionMsFor(awardId: AwardId): number {
  return totalRollMs(awardId) + TRANSITION_BUFFER_MS;
}

/** 骰子起飞到落定的时长（客户端在动画期间锁定按钮）。 */
export function diceMsFor(awardId: AwardId | null): number {
  return awardId ? timingFor(awardId).diceMs : ROLL_TIMING.NONE.diceMs;
}

export function celebrationMsFor(awardId: AwardId): number {
  return timingFor(awardId).celebrationMs;
}
