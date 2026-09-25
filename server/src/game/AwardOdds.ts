/**
 * AwardOdds —— 判奖表的**自然概率**，靠穷举数出来，不靠手算。
 *
 * 六颗骰子共 6^6 = 46656 种等概率组合。把每一种都丢进 evaluateDice 数一遍，
 * 得到每个奖池被命中的组合数——这就是「六颗均匀骰子」下每个奖项的真实概率，
 * 没有任何假设、近似或推导。
 *
 * 谁在用：
 *   - `config/prizes.ts` 按这份概率给一桌饼配货（份数 ∝ 概率）；
 *   - 测试拿这几个数当基准，盯着判奖表有没有被改动。
 *
 * 遍历用**进制里程表**而不是六层嵌套：改 DICE_COUNT 时不用动这段代码。
 */
import type { AwardId, PrizeKey } from '@bobing/shared';
import { PRIZE_KEYS } from '@bobing/shared';
import { DICE_COUNT, DICE_FACES, evaluateDice } from './RuleEngine.js';

export interface AwardOdds {
  /** 等概率组合总数，也就是概率的分母（46656） */
  total: number;
  /** 每个奖池命中的组合数 */
  byPrizeKey: Record<PrizeKey, number>;
  /** 每个奖项命中的组合数 */
  byAwardId: Record<AwardId, number>;
}

/** 穷举一次要 25~60ms，算完缓存住；开局那段演出比这长得多，藏在里面。 */
let cache: AwardOdds | null = null;

export function awardOdds(): AwardOdds {
  if (cache) return cache;

  const byPrizeKey = Object.fromEntries(PRIZE_KEYS.map((k) => [k, 0])) as Record<PrizeKey, number>;
  const byAwardId: Record<string, number> = {};
  const dice = new Array<number>(DICE_COUNT).fill(1);
  const total = DICE_FACES ** DICE_COUNT;

  for (let i = 0; i < total; i += 1) {
    // 里程表进位：低位先走，等价于 DICE_COUNT 层嵌套循环
    let rest = i;
    for (let d = 0; d < DICE_COUNT; d += 1) {
      dice[d] = (rest % DICE_FACES) + 1;
      rest = Math.floor(rest / DICE_FACES);
    }

    const award = evaluateDice(dice);
    byAwardId[award.id] = (byAwardId[award.id] ?? 0) + 1;
    if (award.prizeKey) byPrizeKey[award.prizeKey] += 1;
  }

  cache = { total, byPrizeKey, byAwardId: byAwardId as Record<AwardId, number> };
  return cache;
}
