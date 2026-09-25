/**
 * DiceService / 库存闸门 测试。
 *
 * 重点：
 *  - 随机骰子的边界（rng 返回 0 / 1 / NaN 都不能越界）；
 *  - 收席闸门认得全五个普通奖池、且绝不把状元算进去。
 *
 * 判奖表的自然概率（各奖池命中的组合数）由 rules.test.ts 独立穷举核对，
 * 这里不再重复一份。
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

  it('回合超时为 5 秒', () => {
    expect(TURN_TIMEOUT_MS).toBe(5_000);
  });

  it('离线档必须是「更短的等待」，否则这个功能没有意义', () => {
    expect(TURN_TIMEOUT_OFFLINE_MS).toBe(3_000);
    // 两边都写死数值还不够：真正要守住的是这个不等关系。
    // 哪天有人手滑把离线档调到比在线档还长，这一条会先炸。
    expect(TURN_TIMEOUT_OFFLINE_MS).toBeLessThan(TURN_TIMEOUT_MS);
  });
});
