/**
 * DiceService —— 服务端唯一产生骰子的地方。
 *
 * 客户端永远不能提交点数；这里也不接受任何来自客户端的随机源。
 * 所有随机数都通过可注入的 Rng 获取，方便测试时替换成确定性序列。
 *
 * 六颗骰子**永远**是均匀的 1~6，普通回合和追状元回合一模一样：
 * 没有加持、没有保底、没有为了凑出某个奖项而构造的点数。
 * 谁博到什么，全看判奖表（shared/src/awards.ts）与天命。
 */
import { DICE_COUNT, DICE_FACES } from './RuleEngine.js';

export type Rng = () => number;

export const defaultRng: Rng = Math.random;

/** 取 [1,6] 的一个整数。对 rng() 的返回值做了防御性夹取，rng 返回 1 也不会越界。 */
export function randomFace(rng: Rng = defaultRng): number {
  const r = rng();
  const clamped = Number.isFinite(r) ? Math.min(0.9999999, Math.max(0, r)) : 0;
  return 1 + Math.floor(clamped * DICE_FACES);
}

/** 一次完整的六颗骰子随机（1~6 均匀）。本局所有骰子都从这里出来。 */
export function rollRawDice(rng: Rng = defaultRng): number[] {
  const dice: number[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) dice.push(randomFace(rng));
  return dice;
}
