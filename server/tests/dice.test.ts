/**
 * DiceService / AwardOdds / 库存闸门 测试。
 *
 * 重点：
 *  - 随机骰子的边界（rng 返回 0 / 1 / NaN 都不能越界）；
 *  - 判奖表的**自然概率**与穷举计数逐位对齐；
 *  - 收席闸门认得全五个普通奖池、且绝不把状元算进去。
 */
import { describe, expect, it } from 'vitest';
import { PRIZE_KEYS } from '@bobing/shared';
import type { PrizeKey } from '@bobing/shared';

import {
  ENDING_PRIZE_KEYS,
  ENDING_PRIZE_KEYS_IS_COMPLETE,
  buildInventory,
  emptyInventory,
} from '../src/config/prizes';
import { MAX_PLAYERS, MIN_PLAYERS, TURN_TIMEOUT_MS, TURN_TIMEOUT_OFFLINE_MS } from '../src/config/gameConfig';
import { awardOdds } from '../src/game/AwardOdds';
import { randomFace, rollRawDice } from '../src/game/DiceService';
import { isInventoryExhausted } from '../src/game/PrizeService';
import { isValidDice } from '../src/game/RuleEngine';

/* ------------------------------------------------------------------ *
 * 测试用随机源
 * ------------------------------------------------------------------ */

/** 固定返回一个值的 rng。 */
const fixed = (value: number) => () => value;

/** 确定性伪随机，用于跑大量样本。 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 随机骰子
 * ------------------------------------------------------------------ */

describe('DiceService · 基础随机', () => {
  it('randomFace 永远落在 1~6', () => {
    expect(randomFace(fixed(0))).toBe(1);
    expect(randomFace(fixed(0.5))).toBe(4);
    expect(randomFace(fixed(0.9999999))).toBe(6);
  });

  it('rng 越界或返回 NaN 也不会掷出非法点数', () => {
    for (const bad of [1, 1.5, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const face = randomFace(fixed(bad));
      expect(Number.isInteger(face)).toBe(true);
      expect(face).toBeGreaterThanOrEqual(1);
      expect(face).toBeLessThanOrEqual(6);
    }
  });

  it('rollRawDice 永远返回六颗合法骰子', () => {
    for (let seed = 0; seed < 200; seed += 1) {
      const dice = rollRawDice(lcg(seed + 1));
      expect(isValidDice(dice)).toBe(true);
    }
  });

  it('六颗骰子各自独立，不是同一个值重复六遍', () => {
    // 一条非常便宜的护栏：真出现「骰子被写死成一个值」这种事故时，
    // 上面那条 isValidDice 照样会过，只有这一条会炸。
    let sawDifferentFaces = false;
    for (let seed = 0; seed < 50 && !sawDifferentFaces; seed += 1) {
      const dice = rollRawDice(lcg(seed + 991));
      if (new Set(dice).size > 1) sawDifferentFaces = true;
    }
    expect(sawDifferentFaces).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 判奖表的自然概率
 * ------------------------------------------------------------------ */

describe('AwardOdds · 穷举出来的自然概率', () => {
  const odds = awardOdds();

  it('分母就是 6^6', () => {
    expect(odds.total).toBe(46656);
  });

  it('每个奖池命中的组合数与判奖表逐一对应', () => {
    // 这几个数是「六颗均匀骰子」下的真值，改判奖表必然要一起改这里。
    // 它们同时是 prizes.ts 配货比例的分子 —— 两处必须一致。
    expect(odds.byPrizeKey.ONE_SHOW).toBe(17400);
    expect(odds.byPrizeKey.TWO_LIFT).toBe(9300);
    expect(odds.byPrizeKey.THREE_RED).toBe(2500);
    expect(odds.byPrizeKey.FOUR_ADVANCE).toBe(1875);
    expect(odds.byPrizeKey.DUITANG).toBe(720);
    expect(odds.byPrizeKey.CHAMPION).toBe(561);
  });

  it('状元档 = 七个 Champion Tier 之和，且只有 1.2024%', () => {
    const championTiers = [
      'FOUR_FOUR',
      'FIVE_SCHOLAR',
      'FIVE_FOUR',
      'SIX_BLACK',
      'BROCADE',
      'SIX_FOUR',
      'CHAMPION_FLOWER',
    ] as const;
    const sum = championTiers.reduce((acc, id) => acc + odds.byAwardId[id], 0);
    expect(sum).toBe(odds.byPrizeKey.CHAMPION);
    expect(sum).toBe(561);

    // 这个数字是「约四分之一的牌局没有状元」的全部来源，值得写死一次。
    expect(sum / odds.total).toBeCloseTo(0.012024, 6);
  });

  it('按奖项分类的总和等于全部组合数（不重不漏）', () => {
    const sum = Object.values(odds.byAwardId).reduce((a, b) => a + b, 0);
    expect(sum).toBe(odds.total);
  });

  it('无奖占了将近三成，这是判奖表的性质、不是 bug', () => {
    expect(odds.byAwardId.NONE).toBe(14300);
    expect(odds.byPrizeKey.ONE_SHOW + odds.byPrizeKey.TWO_LIFT + odds.byPrizeKey.THREE_RED
      + odds.byPrizeKey.FOUR_ADVANCE + odds.byPrizeKey.DUITANG + odds.byPrizeKey.CHAMPION
      + odds.byAwardId.NONE).toBe(odds.total);
  });
});

/* ------------------------------------------------------------------ *
 * 收席闸门
 * ------------------------------------------------------------------ */

describe('prizes · 收口奖池', () => {
  it('每一个 key 都是真实的奖池，且不含状元', () => {
    for (const key of ENDING_PRIZE_KEYS) {
      expect(PRIZE_KEYS).toContain(key as PrizeKey);
      expect(key).not.toBe('CHAMPION');
    }
    // 状元必须被排除在外：consumePrize 对它一律 deferred，
    // 算进闸门 = 这道门永远打不开、牌局永远收不了席。
    expect(ENDING_PRIZE_KEYS).not.toContain('CHAMPION');
  });

  it('恰好覆盖「除状元以外的全部奖池」', () => {
    expect(ENDING_PRIZE_KEYS_IS_COMPLETE).toBe(true);
    expect([...ENDING_PRIZE_KEYS].sort()).toEqual(
      PRIZE_KEYS.filter((k) => k !== 'CHAMPION').sort(),
    );
  });
});

describe('PrizeService · isInventoryExhausted', () => {
  it('开局那一桌不算博尽', () => {
    expect(isInventoryExhausted(buildInventory())).toBe(false);
  });

  it('五样普通饼全空才算博尽，哪怕状元还留着', () => {
    const inventory = buildInventory();
    for (const key of ENDING_PRIZE_KEYS) inventory.counts[key] = 0;
    expect(inventory.counts.CHAMPION).toBe(1);
    expect(isInventoryExhausted(inventory)).toBe(true);
  });

  it('只要还有任意一样普通饼没博完，就不收席', () => {
    for (const key of ENDING_PRIZE_KEYS) {
      const inventory = emptyInventory();
      inventory.counts[key] = 1;
      expect(isInventoryExhausted(inventory)).toBe(false);
    }
  });

  it('空桌（全零）算博尽 —— 收席判定不能依赖状元', () => {
    expect(isInventoryExhausted(emptyInventory())).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 配置常量
 * ------------------------------------------------------------------ */

describe('配置常量', () => {
  it('人数上下限与题目一致（2~15）', () => {
    expect(MIN_PLAYERS).toBe(2);
    expect(MAX_PLAYERS).toBe(15);
  });

  it('回合超时为 30 秒', () => {
    expect(TURN_TIMEOUT_MS).toBe(30_000);
  });

  it('离线档必须是「更短的等待」，否则这个功能没有意义', () => {
    expect(TURN_TIMEOUT_OFFLINE_MS).toBe(10_000);
    // 两边都写死数值还不够：真正要守住的是这个不等关系。
    // 哪天有人手滑把离线档调到比在线档还长，这一条会先炸。
    expect(TURN_TIMEOUT_OFFLINE_MS).toBeLessThan(TURN_TIMEOUT_MS);
  });
});
