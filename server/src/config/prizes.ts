/**
 * 一桌饼的配货。
 *
 * 默认按传统会饼固定配货：
 *
 *      一秀 32 · 二举 16 · 三红 4 · 四进 8 · 对堂 2 · 状元 1，共 63 份
 *
 * 状元只有一份；其余五类的份数可随开房配置（RoomConfig）覆盖。
 * 份数与人数无关：一张会饼是定量的，人多人少都是这一张。
 */
import type { InventoryState, PrizeKey, RoomConfig } from '@bobing/shared';
import { DEFAULT_PRIZE_COUNTS, PRIZE_KEYS } from '@bobing/shared';

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

export function buildInventory(config?: RoomConfig): InventoryState {
  const counts: Record<PrizeKey, number> = {
    ONE_SHOW: config?.counts.ONE_SHOW ?? DEFAULT_PRIZE_COUNTS.ONE_SHOW,
    TWO_LIFT: config?.counts.TWO_LIFT ?? DEFAULT_PRIZE_COUNTS.TWO_LIFT,
    THREE_RED: config?.counts.THREE_RED ?? DEFAULT_PRIZE_COUNTS.THREE_RED,
    FOUR_ADVANCE: config?.counts.FOUR_ADVANCE ?? DEFAULT_PRIZE_COUNTS.FOUR_ADVANCE,
    DUITANG: config?.counts.DUITANG ?? DEFAULT_PRIZE_COUNTS.DUITANG,
    CHAMPION: 1,
  };
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
