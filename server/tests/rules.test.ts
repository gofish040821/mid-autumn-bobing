/**
 * RuleEngine 判奖测试。
 *
 * 这里做两层验证：
 *   1. 穷举全部 6^6 = 46656 种骰子组合，逐个与「独立实现的判奖参照」比对；
 *   2. 统计每一种奖项出现的组合数，与博饼的**数学真值**比对。
 *
 * 第 2 层才是真正独立的检验：如果 RuleEngine 和参照实现犯了同一个错，
 * 第 1 层会一起错，但组合数一定对不上正确的概率分布。
 */
import { describe, expect, it } from 'vitest';
import { AWARDS, AWARD_MAP } from '@bobing/shared';
import type { AwardId } from '@bobing/shared';

import {
  countFaces,
  diceKey,
  diceToChinese,
  diceToDigits,
  evaluateAwardId,
  evaluateDice,
  isChampionTier,
  isValidDice,
} from '../src/game/RuleEngine';

/* ------------------------------------------------------------------ *
 * 独立参照实现
 *
 * 刻意用 some/every + 面数区间判断重写一遍，不复用 RuleEngine 的 PREDICATES，
 * 避免「把同一个 bug 抄两遍」。
 * ------------------------------------------------------------------ */

const NON_FOUR = [1, 2, 3, 5, 6] as const;

function referenceAward(counts: readonly number[]): AwardId {
  const exactly = (face: number, n: number): boolean => counts[face] === n;
  const anyNonFour = (n: number): boolean => NON_FOUR.some((f) => counts[f] === n);
  const allSixDistinct = (): boolean => [1, 2, 3, 4, 5, 6].every((f) => counts[f] === 1);

  if (exactly(4, 4) && exactly(1, 2)) return 'CHAMPION_FLOWER';
  if (exactly(4, 6)) return 'SIX_FOUR';
  if (exactly(1, 6)) return 'BROCADE';
  if ([2, 3, 5, 6].some((f) => counts[f] === 6)) return 'SIX_BLACK';
  if (exactly(4, 5)) return 'FIVE_FOUR';
  if (anyNonFour(5)) return 'FIVE_SCHOLAR';
  if (exactly(4, 4)) return 'FOUR_FOUR';
  if (allSixDistinct()) return 'DUITANG';
  if (anyNonFour(4)) return 'FOUR_ADVANCE';
  if (exactly(4, 3)) return 'THREE_RED';
  if (exactly(4, 2)) return 'TWO_LIFT';
  if (exactly(4, 1)) return 'ONE_SHOW';
  return 'NONE';
}

/** 穷举 6^6 组合。 */
function* allCombos(): Generator<number[]> {
  for (let a = 1; a <= 6; a += 1)
    for (let b = 1; b <= 6; b += 1)
      for (let c = 1; c <= 6; c += 1)
        for (let d = 1; d <= 6; d += 1)
          for (let e = 1; e <= 6; e += 1)
            for (let f = 1; f <= 6; f += 1) yield [a, b, c, d, e, f];
}

const TOTAL = 6 ** 6; // 46656

/**
 * 各奖项的**数学真值**（组合数）。
 *
 * 推导方式：按「四点的个数 k」分层统计 C(6,k)·5^(6-k)，再逐层扣掉更高奖项。
 *   一秀   = 6·5^5 − (对堂 720 + 五子登科 30 + 四进 600) = 17400
 *   二举   = 15·5^4 − (四进 75)                            = 9300
 *   三红   = 20·5^3                                        = 2500
 *   四进   = 5·C(6,4)·5^2 (无四点层 1200 + 一个四点层 600 + 两个四点层 75) = 1875
 *   对堂   = 6!                                            = 720
 *   四点红 = C(6,4)·5^2 − 插金花 15                        = 360
 * 与公开的博饼概率（一秀 ≈ 37.3%、二举 ≈ 19.9%）一致。
 */
const EXPECTED_COUNTS: Record<AwardId, number> = {
  CHAMPION_FLOWER: 15,
  SIX_FOUR: 1,
  BROCADE: 1,
  SIX_BLACK: 4,
  FIVE_FOUR: 30,
  FIVE_SCHOLAR: 150,
  FOUR_FOUR: 360,
  DUITANG: 720,
  FOUR_ADVANCE: 1875,
  THREE_RED: 2500,
  TWO_LIFT: 9300,
  ONE_SHOW: 17400,
  NONE: 14300,
};

interface SweepResult {
  seen: number;
  counts: Record<string, number>;
  mismatches: string[];
  unknownAwards: string[];
}

/** 只跑一次穷举，后面几条断言共用这次结果。 */
function runSweep(): SweepResult {
  const counts: Record<string, number> = Object.fromEntries(AWARDS.map((a) => [a.id, 0]));
  const mismatches: string[] = [];
  const unknownAwards: string[] = [];
  let seen = 0;

  for (const dice of allCombos()) {
    seen += 1;
    const award = evaluateDice(dice);
    const actual = award.id;
    const expected = referenceAward(countFaces(dice));

    if (actual !== expected && mismatches.length < 20) {
      mismatches.push(`${diceToDigits(dice)} → 实际 ${actual} / 参照 ${expected}`);
    }
    if (!AWARD_MAP[actual] && unknownAwards.length < 20) {
      unknownAwards.push(`${diceToDigits(dice)} → ${actual}`);
    }
    counts[actual] = (counts[actual] ?? 0) + 1;
  }

  return { seen, counts, mismatches, unknownAwards };
}

describe('RuleEngine · 穷举 6^6', () => {
  const sweep = runSweep();

  it('确实跑满了 46656 种组合', () => {
    expect(sweep.seen).toBe(TOTAL);
  });

  it('每一种组合的判奖都与独立参照实现一致', () => {
    expect(sweep.mismatches).toEqual([]);
  });

  it('每一种奖项的组合数都等于数学真值', () => {
    expect(sweep.counts).toEqual(EXPECTED_COUNTS);
  });

  it('各奖项组合数之和恰好等于 46656（无重复、无遗漏）', () => {
    const sum = Object.values(sweep.counts).reduce((a, b) => a + b, 0);
    expect(sum).toBe(TOTAL);
  });

  it('永远只返回真实存在的奖项', () => {
    expect(sweep.unknownAwards).toEqual([]);
  });

  it('判奖是纯函数，同样输入永远同样输出', () => {
    const sample: number[][] = [
      [4, 4, 4, 4, 1, 1],
      [1, 2, 3, 4, 5, 6],
      [2, 3, 5, 6, 1, 2],
      [4, 4, 4, 2, 3, 5],
    ];
    for (const dice of sample) {
      expect(evaluateAwardId(dice)).toBe(evaluateAwardId(dice));
      expect(diceKey(dice)).toBe(diceKey([...dice].reverse()));
    }
  });
});

describe('RuleEngine · 顺序正确性（高等级绝不被低等级覆盖）', () => {
  const cases: Array<[string, number[], AwardId]> = [
    ['插金花不能被四点红截胡', [4, 4, 4, 4, 1, 1], 'CHAMPION_FLOWER'],
    ['插金花不能被五红或二举截胡', [1, 4, 1, 4, 4, 4], 'CHAMPION_FLOWER'],
    ['六杯红不能被五红截胡', [4, 4, 4, 4, 4, 4], 'SIX_FOUR'],
    ['遍地锦不能被五子登科截胡', [1, 1, 1, 1, 1, 1], 'BROCADE'],
    ['六抔黑不能被五子登科截胡', [2, 2, 2, 2, 2, 2], 'SIX_BLACK'],
    ['六抔黑（5点）', [5, 5, 5, 5, 5, 5], 'SIX_BLACK'],
    ['六抔黑（3点）', [3, 3, 3, 3, 3, 3], 'SIX_BLACK'],
    ['六抔黑（6点）', [6, 6, 6, 6, 6, 6], 'SIX_BLACK'],
    ['五红不能被四点红截胡', [4, 4, 4, 4, 4, 2], 'FIVE_FOUR'],
    ['五红配一颗一点，不是插金花', [4, 4, 4, 4, 4, 1], 'FIVE_FOUR'],
    ['五子登科不能被四进截胡', [3, 3, 3, 3, 3, 6], 'FIVE_SCHOLAR'],
    ['五子登科（1点）', [1, 1, 1, 1, 1, 6], 'FIVE_SCHOLAR'],
    ['四点红不能被二举截胡', [4, 4, 4, 4, 2, 6], 'FOUR_FOUR'],
    ['四点红配两颗一点会升级成插金花', [4, 4, 4, 4, 1, 2], 'FOUR_FOUR'],
    ['对堂不能被一秀截胡', [1, 2, 3, 4, 5, 6], 'DUITANG'],
    ['对堂（乱序）', [6, 4, 1, 5, 3, 2], 'DUITANG'],
    ['四进不能被三红截胡', [2, 2, 2, 2, 3, 5], 'FOUR_ADVANCE'],
    ['四进可以带两颗四点', [2, 2, 2, 2, 4, 4], 'FOUR_ADVANCE'],
    ['四进（五颗一加一颗二其实是五子登科）', [1, 1, 1, 1, 1, 2], 'FIVE_SCHOLAR'],
    ['三红不能被二举截胡', [4, 4, 4, 2, 3, 5], 'THREE_RED'],
    ['三红可以带三颗同点', [4, 4, 4, 3, 3, 3], 'THREE_RED'],
    ['二举不能被一秀截胡', [4, 4, 2, 3, 5, 6], 'TWO_LIFT'],
    ['一秀', [4, 2, 3, 5, 6, 2], 'ONE_SHOW'],
    ['没有四点也没有重复 —— 无奖', [2, 3, 5, 6, 1, 2], 'NONE'],
    ['一条顺子少一颗 —— 无奖', [2, 3, 5, 6, 1, 1], 'NONE'],
  ];

  for (const [name, dice, expected] of cases) {
    it(`${diceToDigits(dice)} → ${expected}（${name}）`, () => {
      expect(evaluateAwardId(dice)).toBe(expected);
      expect(evaluateDice(dice).id).toBe(expected);
    });
  }
});

describe('RuleEngine · 奖项表自身的一致性', () => {
  it('order 从 1 连续递增，与数组下标一致', () => {
    AWARDS.forEach((award, index) => {
      expect(award.order).toBe(index + 1);
    });
  });

  it('最后一个奖项必须是 NONE（兜底）', () => {
    expect(AWARDS[AWARDS.length - 1]?.id).toBe('NONE');
  });

  it('Champion Tier 的 championRank 严格递减且取值 1~7', () => {
    const champions = AWARDS.filter((a) => a.tier === 'CHAMPION');
    expect(champions).toHaveLength(7);
    const ranks = champions.map((a) => a.championRank);
    expect(ranks).toEqual([7, 6, 5, 4, 3, 2, 1]);
    for (const r of ranks) expect(r).toBeGreaterThanOrEqual(1);
    for (const r of ranks) expect(r).toBeLessThanOrEqual(7);
  });

  it('非 Champion Tier 的 championRank 必须是 0', () => {
    for (const award of AWARDS) {
      if (award.tier !== 'CHAMPION') expect(award.championRank).toBe(0);
    }
  });

  it('所有 Champion Tier 共用同一个状元库存 key', () => {
    for (const award of AWARDS) {
      if (award.tier === 'CHAMPION') expect(award.prizeKey).toBe('CHAMPION');
    }
  });

  it('只有 NONE 没有 prizeKey', () => {
    for (const award of AWARDS) {
      if (award.id === 'NONE') expect(award.prizeKey).toBeNull();
      else expect(award.prizeKey).not.toBeNull();
    }
  });

  it('积分随奖项升高而单调不减', () => {
    const scores = [...AWARDS].filter((a) => a.id !== 'NONE').reverse().map((a) => a.score);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]!).toBeGreaterThanOrEqual(scores[i - 1]!);
    }
  });

  it('AWARD_MAP 覆盖所有奖项', () => {
    for (const award of AWARDS) {
      expect(AWARD_MAP[award.id]).toBe(award);
    }
  });

  it('isChampionTier 只对 Champion Tier 为真', () => {
    for (const award of AWARDS) {
      expect(isChampionTier(award)).toBe(award.tier === 'CHAMPION');
    }
  });
});

describe('RuleEngine · 工具函数', () => {
  it('countFaces 忽略非法点数且索引 0 恒为 0', () => {
    const counts = countFaces([4, 4, 9, 0, -1, 3]);
    expect(counts[0]).toBe(0);
    expect(counts[4]).toBe(2);
    expect(counts[3]).toBe(1);
  });

  it('isValidDice 只接受六颗 1~6 的整数', () => {
    expect(isValidDice([1, 2, 3, 4, 5, 6])).toBe(true);
    expect(isValidDice([1, 2, 3, 4, 5])).toBe(false);
    expect(isValidDice([1, 2, 3, 4, 5, 7])).toBe(false);
    expect(isValidDice([1, 2, 3, 4, 5, 0])).toBe(false);
    expect(isValidDice([1, 2, 3, 4, 5, 6.5])).toBe(false);
    expect(isValidDice('444411')).toBe(false);
    expect(isValidDice(null)).toBe(false);
    expect(isValidDice(undefined)).toBe(false);
  });

  it('diceToChinese / diceToDigits 输出可读文本', () => {
    expect(diceToChinese([4, 4, 4, 4, 1, 1])).toBe('四 四 四 四 一 一');
    expect(diceToDigits([4, 4, 4, 4, 1, 1])).toBe('4 4 4 4 1 1');
  });

  it('diceKey 与点数顺序无关（用于去重）', () => {
    expect(diceKey([1, 2, 3, 4, 5, 6])).toBe(diceKey([6, 5, 4, 3, 2, 1]));
    expect(diceKey([4, 4, 4, 4, 1, 1])).toBe('114444');
  });
});
