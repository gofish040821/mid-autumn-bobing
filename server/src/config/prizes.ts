/**
 * 一桌饼的配货 —— 传统会饼的经典份数，1 : 2 : 4 : 8 : 16 : 32。
 *
 *      一秀 32 · 二举 16 · 三红 4 · 四进 8 · 对堂 2 · 状元 1，共 63 份
 *
 * **这是一张人工定死的表，不是算出来的。**
 *
 * 早先的版本拿自然概率做比例（份数 ∝ 概率，概率由穷举 6^6 得出），
 * 好处是五个普通池的期望清空时间都落在 65~85 掷，「谁都不是短板」。
 * 换成传统份数就把那个性质丢掉了，现在是**四进一个人拖后腿**：
 *
 *     池     份数   自然概率   期望清空掷数
 *     一秀    32    37.29%         86
 *     二举    16    19.93%         80
 *     三红     4     5.36%         75
 *     四进     8     4.02%        199   ← 实测 72% 的局最后都在等它
 *     对堂     2     1.54%        130
 *     状元     1     1.20%         83
 *
 * 代价是局长度：实测中位约 9 分钟、p90 约 14 分钟，而且**没有上限**
 * （旧配货中位约 4.8 分钟）。收益是这组份数就是传统会饼本来的样子，
 * 玩家一眼认得。两边的详细实测见 README。
 *
 * **要调局长度，就改下面 PIECES 这一张表 —— 它是唯一的旋钮。**
 */
import type { InventoryState, PrizeKey } from '@bobing/shared';
import { PRIZE_KEYS } from '@bobing/shared';

/**
 * 一桌饼的传统配货。
 *
 * 类型写成 `Record<PrizeKey, number>` 是**编译期断言**：将来给 PrizeKey
 * 添了新奖池却忘了在这里配货，这一行立刻报错（少一个池子会让「博到饼尽」
 * 这道闸门永远差一样没过零，牌局再也收不了席，而且要走完整局才看得出来）。
 */
const PIECES: Record<PrizeKey, number> = {
  ONE_SHOW: 32,
  TWO_LIFT: 16,
  THREE_RED: 4,
  FOUR_ADVANCE: 8,
  DUITANG: 2,
  CHAMPION: 1,
};

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
  // 展开成新对象：counts 是会被对局就地改的，不能让两个牌局共用一份 PIECES。
  const counts = { ...PIECES };
  return { counts, initial: { ...counts } };
}

/**
 * 空桌：六样全部为 0。
 *
 * **必须写死全零，不能复用 buildInventory()。** 那样「空桌」会返回一整套
 * 32/16/4/8/2/1 的配货，重开之后库存根本清不干净。
 */
export function emptyInventory(): InventoryState {
  const counts = {} as Record<PrizeKey, number>;
  for (const key of PRIZE_KEYS) counts[key] = 0;
  return { counts, initial: { ...counts } };
}
