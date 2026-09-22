/**
 * DiceService 测试。
 *
 * 重点：
 *  - 随机骰子的边界（rng 返回 0 / 1 / NaN 都不能越界）；
 *  - 月华加持的概率曲线与三轮保底；
 *  - 构造出来的状元骰型**必须恰好等于目标奖项**，不能意外升级或降级。
 */
import { describe, expect, it } from 'vitest';
import { AWARD_MAP } from '@bobing/shared';
import type { AwardId } from '@bobing/shared';

import {
  CHAMPION_GUARANTEE_ROUND,
  CHAMPION_WEIGHTS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  MOON_BLESSING_INITIAL_RATE,
  MOON_BLESSING_MAX_RATE,
  MOON_BLESSING_RATE_INCREMENT,
  MOON_BLESSING_START_ROUND,
  TURN_TIMEOUT_MS,
} from '../src/config/gameConfig';
import {
  computeBlessingRate,
  generateChampionDice,
  guaranteeRollNumber,
  isGuaranteedRoll,
  pickWeightedChampion,
  randomFace,
  rollChasePhase,
  rollNormalPhase,
  rollRawDice,
} from '../src/game/DiceService';
import { evaluateDice, isValidDice } from '../src/game/RuleEngine';

/* ------------------------------------------------------------------ *
 * 测试用随机源
 * ------------------------------------------------------------------ */

/** 固定返回一个值的 rng。 */
const fixed = (value: number) => () => value;

/** 按队列依次返回，队列空了就回落到 fallback。 */
function queueRng(values: number[], fallback = 0.99) {
  const queue = [...values];
  return () => (queue.length > 0 ? (queue.shift() as number) : fallback);
}

/** 按固定长度循环返回，用于模拟「每一把都掷出同一组骰子」。 */
function cycleRng(pattern: number[]) {
  let i = 0;
  return () => {
    const value = pattern[i % pattern.length] as number;
    i += 1;
    return value;
  };
}

/** 确定性伪随机，用于跑大量样本。 */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 把 1~6 的面转成对应的 rng 取值（取每个区间的中点）。 */
const faces = (...f: number[]): number[] => f.map((v) => (v - 0.5) / 6);

const CHAMPION_IDS = [
  'FOUR_FOUR',
  'FIVE_SCHOLAR',
  'FIVE_FOUR',
  'SIX_BLACK',
  'BROCADE',
  'SIX_FOUR',
  'CHAMPION_FLOWER',
] as const satisfies readonly AwardId[];

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

  it('rollChasePhase 是纯随机，不做任何干预', () => {
    for (let seed = 0; seed < 100; seed += 1) {
      expect(isValidDice(rollChasePhase(lcg(seed + 7)))).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 状元骰型构造
 * ------------------------------------------------------------------ */

describe('DiceService · 状元骰型构造', () => {
  for (const id of CHAMPION_IDS) {
    it(`${id} 构造出的骰子恰好是它本身（200 次采样）`, () => {
      for (let seed = 0; seed < 200; seed += 1) {
        const dice = generateChampionDice(id, lcg(seed * 31 + 1));
        expect(isValidDice(dice)).toBe(true);
        const award = evaluateDice(dice);
        expect(award.id).toBe(id);
        expect(award.tier).toBe('CHAMPION');
      }
    });
  }

  it('四点红绝不会被意外构造出「两颗一点」而升级成插金花', () => {
    // 这是最容易写错的一处：四颗四点 + 两颗一点 = 插金花，不是四点红
    for (let seed = 0; seed < 500; seed += 1) {
      const dice = generateChampionDice('FOUR_FOUR', lcg(seed + 101));
      const fours = dice.filter((d) => d === 4).length;
      const ones = dice.filter((d) => d === 1).length;
      expect(fours).toBe(4);
      expect(ones).toBeLessThanOrEqual(1);
      expect(evaluateDice(dice).id).toBe('FOUR_FOUR');
    }
  });

  it('五红 / 五子登科的第六颗一定与重复点数不同，不会变成六抔黑', () => {
    for (let seed = 0; seed < 300; seed += 1) {
      const fiveRed = generateChampionDice('FIVE_FOUR', lcg(seed + 11));
      expect(fiveRed.filter((d) => d === 4)).toHaveLength(5);

      const fiveScholar = generateChampionDice('FIVE_SCHOLAR', lcg(seed + 13));
      const counts = new Map<number, number>();
      for (const d of fiveScholar) counts.set(d, (counts.get(d) ?? 0) + 1);
      expect(Math.max(...counts.values())).toBe(5);
      expect(counts.get(4) ?? 0).toBe(0);
      expect(evaluateDice(fiveScholar).id).toBe('FIVE_SCHOLAR');
    }
  });

  it('生成的状元骰型不会误伤成更低的普通奖项', () => {
    for (const id of CHAMPION_IDS) {
      const award = evaluateDice(generateChampionDice(id, lcg(5)));
      expect(award.tier).toBe('CHAMPION');
      expect(award.championRank).toBe(AWARD_MAP[id].championRank);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 加权抽取
 * ------------------------------------------------------------------ */

describe('DiceService · 状元加权抽取', () => {
  it('rng → 0 时命中权重表的第一项', () => {
    expect(pickWeightedChampion(fixed(0))).toBe('FOUR_FOUR');
  });

  it('rng → 0.999… 时命中权重表的最后一项', () => {
    expect(pickWeightedChampion(fixed(0.999999))).toBe('CHAMPION_FLOWER');
  });

  it('抽取分布大致符合权重（四点红最常见，顶级状元罕见）', () => {
    const rng = lcg(20240915);
    const tally = new Map<string, number>();
    const samples = 60_000;
    for (let i = 0; i < samples; i += 1) {
      const id = pickWeightedChampion(rng);
      tally.set(id, (tally.get(id) ?? 0) + 1);
    }
    const totalWeight = Object.values(CHAMPION_WEIGHTS).reduce((a, b) => a + b, 0);
    for (const [id, weight] of Object.entries(CHAMPION_WEIGHTS)) {
      const actual = (tally.get(id) ?? 0) / samples;
      const expected = weight / totalWeight;
      // 60k 采样下 3 个百分点的容差足够宽松，又能挡住真正的逻辑错误
      expect(Math.abs(actual - expected)).toBeLessThan(0.03);
    }
  });

  it('权重为 0 的项永远不会被抽到', () => {
    const weights = { FOUR_FOUR: 1, SIX_FOUR: 0, BROCADE: 0 };
    for (let seed = 0; seed < 200; seed += 1) {
      expect(pickWeightedChampion(lcg(seed + 3), weights)).toBe('FOUR_FOUR');
    }
  });
});

/* ------------------------------------------------------------------ *
 * 月华加持
 * ------------------------------------------------------------------ */

describe('DiceService · 月华加持概率曲线', () => {
  const N = MIN_PLAYERS; // 4

  it('第一轮（前 N 次）完全不干预，概率为 0', () => {
    for (let done = 0; done < N; done += 1) {
      expect(computeBlessingRate(done, N)).toBe(0);
    }
  });

  it(`第二轮第一次的概率等于 MOON_BLESSING_INITIAL_RATE（${MOON_BLESSING_INITIAL_RATE}）`, () => {
    expect(computeBlessingRate(N, N)).toBeCloseTo(MOON_BLESSING_INITIAL_RATE, 10);
  });

  it(`之后每掷一次加 ${MOON_BLESSING_RATE_INCREMENT}，且封顶 ${MOON_BLESSING_MAX_RATE}`, () => {
    const startRoll = (MOON_BLESSING_START_ROUND - 1) * N + 1;
    for (let rollNumber = startRoll; rollNumber <= startRoll + 40; rollNumber += 1) {
      const done = rollNumber - 1;
      const expected = Math.min(
        MOON_BLESSING_INITIAL_RATE + MOON_BLESSING_RATE_INCREMENT * (rollNumber - startRoll),
        MOON_BLESSING_MAX_RATE,
      );
      expect(computeBlessingRate(done, N)).toBeCloseTo(expected, 10);
    }
  });

  it('概率单调不减', () => {
    let prev = -1;
    for (let done = 0; done < 60; done += 1) {
      const rate = computeBlessingRate(done, N);
      expect(rate).toBeGreaterThanOrEqual(prev);
      prev = rate;
    }
  });

  it('人数为 0 时不做任何加持', () => {
    expect(computeBlessingRate(0, 0)).toBe(0);
    expect(computeBlessingRate(50, 0)).toBe(0);
  });

  it('人数越多，加持开启得越晚（第一轮永远是 N 次）', () => {
    for (const n of [MIN_PLAYERS, 6, 8, MAX_PLAYERS]) {
      for (let done = 0; done < n; done += 1) {
        expect(computeBlessingRate(done, n)).toBe(0);
      }
      expect(computeBlessingRate(n, n)).toBeGreaterThan(0);
    }
  });
});

describe('DiceService · 三轮保底', () => {
  it(`保底序号恒为 ${CHAMPION_GUARANTEE_ROUND}N`, () => {
    expect(guaranteeRollNumber(MIN_PLAYERS)).toBe(3 * MIN_PLAYERS);
    expect(guaranteeRollNumber(MAX_PLAYERS)).toBe(3 * MAX_PLAYERS);
    for (let n = 1; n <= 20; n += 1) {
      expect(guaranteeRollNumber(n)).toBe(CHAMPION_GUARANTEE_ROUND * n);
    }
  });

  it('只有到达 3N 那一次才算保底', () => {
    const N = MIN_PLAYERS;
    const at = guaranteeRollNumber(N);
    expect(isGuaranteedRoll(at - 2, N)).toBe(false); // 已完成 3N-2 次 → 下一次是第 3N-1 次
    expect(isGuaranteedRoll(at - 1, N)).toBe(true); //  已完成 3N-1 次 → 下一次正好是第 3N 次
    expect(isGuaranteedRoll(at, N)).toBe(true); //      已经越过保底线，仍然保底
  });
});

describe('DiceService · 普通阶段掷骰', () => {
  it('本来就是状元时直接采用，不消耗加持', () => {
    const outcome = rollNormalPhase(0, MIN_PLAYERS, queueRng(faces(4, 4, 4, 4, 2, 6)));
    expect(evaluateDice(outcome.dice).id).toBe('FOUR_FOUR');
    expect(outcome.blessed).toBe(false);
    expect(outcome.guaranteed).toBe(false);
  });

  it('第一轮永远不会加持出状元', () => {
    // 每一把都掷出同一组「无奖」骰子；第一轮 rate 恒为 0，所以永远不会被加持成状元
    const rng = cycleRng(faces(2, 3, 5, 6, 1, 2));
    for (let done = 0; done < MIN_PLAYERS; done += 1) {
      const outcome = rollNormalPhase(done, MIN_PLAYERS, rng);
      expect(outcome.blessed).toBe(false);
      expect(outcome.guaranteed).toBe(false);
      expect(evaluateDice(outcome.dice).tier).not.toBe('CHAMPION');
    }
  });

  it('概率命中时会加持出一个真正的 Champion Tier', () => {
    // 第 2 轮第一次：rate = 0.05；掷出无奖的骰子后用 0.01 命中加持
    const rng = queueRng([...faces(2, 3, 5, 6, 1, 2), 0.01, 0.3]);
    const outcome = rollNormalPhase(MIN_PLAYERS, MIN_PLAYERS, rng);
    expect(outcome.blessed).toBe(true);
    expect(outcome.guaranteed).toBe(false);
    expect(evaluateDice(outcome.dice).tier).toBe('CHAMPION');
  });

  it('概率没命中时保持原样', () => {
    const rng = queueRng([...faces(2, 3, 5, 6, 1, 2), 0.99]);
    const outcome = rollNormalPhase(MIN_PLAYERS, MIN_PLAYERS, rng);
    expect(outcome.blessed).toBe(false);
    expect(evaluateDice(outcome.dice).id).toBe('NONE');
  });

  it('到达 3N 时无条件保底，且不需要消耗「概率判定」', () => {
    const outcome = rollNormalPhase(guaranteeRollNumber(MIN_PLAYERS) - 1, MIN_PLAYERS, fixed(0.3));
    expect(outcome.guaranteed).toBe(true);
    expect(outcome.blessed).toBe(false);
    expect(evaluateDice(outcome.dice).tier).toBe('CHAMPION');
  });

  it('保底掷出的骰型与加权抽取结果一致', () => {
    // rng 0.3 → 落在 FOUR_FOUR（权重 64）
    const outcome = rollNormalPhase(guaranteeRollNumber(6) - 1, 6, fixed(0.3));
    expect(outcome.guaranteed).toBe(true);
    expect(evaluateDice(outcome.dice).id).toBe('FOUR_FOUR');
  });
});

/* ------------------------------------------------------------------ *
 * 配置常量
 * ------------------------------------------------------------------ */

describe('配置常量', () => {
  it('人数上下限与题目一致（4~10）', () => {
    expect(MIN_PLAYERS).toBe(4);
    expect(MAX_PLAYERS).toBe(10);
  });

  it('回合超时为 30 秒', () => {
    expect(TURN_TIMEOUT_MS).toBe(30_000);
  });

  it('月华参数自洽：初始值 < 上限，且增量能爬到上限', () => {
    expect(MOON_BLESSING_INITIAL_RATE).toBeLessThan(MOON_BLESSING_MAX_RATE);
    expect(MOON_BLESSING_INITIAL_RATE).toBeGreaterThan(0);
    expect(MOON_BLESSING_RATE_INCREMENT).toBeGreaterThan(0);
    expect(MOON_BLESSING_START_ROUND).toBe(2);
  });

  it('权重表里的每一个 key 都是真实的 Champion Tier', () => {
    for (const id of Object.keys(CHAMPION_WEIGHTS)) {
      const award = AWARD_MAP[id as AwardId];
      expect(award).toBeDefined();
      expect(award.tier).toBe('CHAMPION');
    }
  });
});
