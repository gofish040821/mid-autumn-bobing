/**
 * 一桌饼的配货。
 *
 * 份数 ∝ 自然概率，比例由「状元只有一份」定死：
 *
 *     份数(k) = max(1, round( 命中组合数(k) / 命中组合数(状元) ))
 *
 * 概率来自判奖表对全部 6^6 种点数的穷举（见 game/AwardOdds.ts），
 * 所以这里**没有任何人工旋钮**——改判奖表，份数自动跟着变。
 *
 *      一秀 31 · 二举 17 · 三红 4 · 四进 3 · 对堂 1 · 状元 1，共 57 份
 *
 * 份数与人数无关：一张会饼是定量的，人多人少都是这一张。
 * 于是局长度也不随人数变，2 人和 15 人一样长。
 */
import type { InventoryState, PrizeKey } from '@bobing/shared';
import { PRIZE_KEYS } from '@bobing/shared';
import { awardOdds } from '../game/AwardOdds.js';

/**
 * 收口用的奖池：这五个池子全部博空，本局就结束。
 *
 * **状元不在其中，而且绝不能加进来。** consumePrize 对 Champion Tier 一律
 * deferred（库存要到 settle 才扣），所以状元池在大半个牌局里恒为 1；
 * 把它算进闸门等于这道闸门永远打不开，牌局永远收不了席。
 */
export const ENDING_PRIZE_KEYS = [
  'ONE_SHOW',
  'TWO_LIFT',
  'THREE_RED',
  'FOUR_ADVANCE',
  'DUITANG',
] as const;

export type EndingPrizeKey = (typeof ENDING_PRIZE_KEYS)[number];

/**
 * 编译期断言：ENDING_PRIZE_KEYS 必须恰好是「除状元以外的全部奖池」。
 *
 * 少写一个 key 的症状是**这局永远收不了席**——闸门永远差一个池子没过零，
 * 而且要通过一整局（几分钟）才看得出来，是最贵的一类 bug。
 * 所以宁可让它在编译期就炸：将来给 PrizeKey 加了新奖池却忘了加进上面那张表，
 * MissingEndingPrizeKey 就不再是 never，下一行的赋值立刻报错。
 */
type MissingEndingPrizeKey = Exclude<PrizeKey, EndingPrizeKey | 'CHAMPION'>;
export const ENDING_PRIZE_KEYS_IS_COMPLETE: MissingEndingPrizeKey extends never ? true : false = true;

export function buildInventory(): InventoryState {
  const odds = awardOdds().byPrizeKey;
  // 状元只有一份，于是它天然成为换算基准：别的池子按「几个状元那么常见」配货。
  const unit = odds.CHAMPION;

  const counts = {} as Record<PrizeKey, number>;
  for (const key of PRIZE_KEYS) {
    counts[key] = key === 'CHAMPION' ? 1 : Math.max(1, Math.round(odds[key] / unit));
  }

  return { counts, initial: { ...counts } };
}

/**
 * 空桌：六样全部为 0。
 *
 * **必须写死全零，不能复用 buildInventory()。** 配货有 max(1, …) 下限，
 * 复用会让「空桌」返回一堆 1，重开之后库存清不干净。
 */
export function emptyInventory(): InventoryState {
  const counts = {} as Record<PrizeKey, number>;
  for (const key of PRIZE_KEYS) counts[key] = 0;
  return { counts, initial: { ...counts } };
}
