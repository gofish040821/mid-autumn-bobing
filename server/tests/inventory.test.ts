/**
 * 奖品库存与发奖测试。
 *
 * 核心规则：
 *  - 库存 > 0 才扣库存、才加积分；
 *  - 库存 = 0 时骰型照常显示，但标为「已领完」，不发奖不加分；
 *  - Champion Tier 一律延后，只在结算时发给最终状元一个人。
 *
 * 配货规则（默认传统会饼，见 config/prizes.ts）：
 *   一秀 32 · 二举 16 · 三红 4 · 四进 8 · 对堂 2 · 状元 1。
 */
import { describe, expect, it } from 'vitest';
import { AWARD_MAP, PRIZE_KEYS } from '@bobing/shared';
import type { InventoryState, PrizeKey } from '@bobing/shared';

import { buildInventory, emptyInventory } from '../src/config/prizes';
import { consumePrize, grantChampionPrize, hasStock } from '../src/game/PrizeService';

const expectInventory = (inv: InventoryState, expected: Record<PrizeKey, number>): void => {
  expect(inv.counts).toEqual(expected);
};

const CHAMPION_IDS = [
  'FOUR_FOUR',
  'FIVE_SCHOLAR',
  'FIVE_FOUR',
  'SIX_BLACK',
  'BROCADE',
  'SIX_FOUR',
  'CHAMPION_FLOWER',
] as const;

describe('buildInventory · 一桌饼的配货', () => {
  it('默认 63 份：一秀32 二举16 三红4 四进8 对堂2 状元1', () => {
    expectInventory(buildInventory(), {
      ONE_SHOW: 32,
      TWO_LIFT: 16,
      THREE_RED: 4,
      FOUR_ADVANCE: 8,
      DUITANG: 2,
      CHAMPION: 1,
    });
  });

  it('份数与人数无关 —— 一张会饼是定量的，人多人少都是这一张', () => {
    const inv = buildInventory();
    expect(inv.counts).toEqual(buildInventory().counts);
    expect(inv.counts.ONE_SHOW).toBe(32);
  });

  it('状元永远只有一个——七种状元骰型共用这一份库存', () => {
    expect(buildInventory().counts.CHAMPION).toBe(1);
    for (const id of CHAMPION_IDS) expect(AWARD_MAP[id].prizeKey).toBe('CHAMPION');
  });

  it('每一样至少 1 份，否则它会是收席闸门里的死结', () => {
    // 五个普通奖池都是收席条件（见 prizes.ts 的 ENDING_PRIZE_KEYS），
    // 任何一样配成 0 都会让「博到饼尽」变成开局即达成。
    const inv = buildInventory();
    for (const key of PRIZE_KEYS) expect(inv.counts[key]).toBeGreaterThanOrEqual(1);
  });

  it('initial 是 counts 的快照，之后改动 counts 不会污染 initial', () => {
    const inv = buildInventory();
    inv.counts.ONE_SHOW = 0;
    expect(inv.initial.ONE_SHOW).toBe(32);
    expect(inv.initial).not.toBe(inv.counts);
  });

  it('每次调用都返回全新对象（不会共享引用）', () => {
    const a = buildInventory();
    const b = buildInventory();
    expect(a).not.toBe(b);
    expect(a.counts).not.toBe(b.counts);
    expect(a.counts).toEqual(b.counts);
  });

  it('库存里只包含合法的奖品 key', () => {
    const inv = buildInventory();
    expect(Object.keys(inv.counts).sort()).toEqual([...PRIZE_KEYS].sort());
    for (const key of PRIZE_KEYS) {
      expect(Number.isInteger(inv.counts[key])).toBe(true);
      expect(inv.counts[key]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('emptyInventory · 空桌', () => {
  it('六样全部为 0', () => {
    const empty = emptyInventory();
    for (const key of PRIZE_KEYS) expect(empty.counts[key]).toBe(0);
    expect(empty.counts.CHAMPION).toBe(0);
  });

  it('不是 buildInventory() 的别名', () => {
    // 这条是**承重**的：配货有 max(1, …) 下限，一旦 emptyInventory 改成复用
    // buildInventory，重开一局后库存会留下一堆 1，台面清不干净
    // （e2e-smoke 的「重开后库存归零」断言会挂）。
    expect(emptyInventory().counts).not.toEqual(buildInventory().counts);
    expect(emptyInventory().counts.ONE_SHOW).toBe(0);
  });

  it('initial 同样是全零', () => {
    expect(emptyInventory().initial).toEqual(emptyInventory().counts);
  });
});

describe('consumePrize · 普通奖项发奖', () => {
  it('库存充足时扣 1 个并判定为已发奖', () => {
    const inv = buildInventory();
    const before = inv.counts.THREE_RED;
    const res = consumePrize(AWARD_MAP.THREE_RED, inv);
    expect(res.granted).toBe(true);
    expect(res.exhausted).toBe(false);
    expect(res.deferred).toBe(false);
    expect(res.prizeKey).toBe('THREE_RED');
    expect(inv.counts.THREE_RED).toBe(before - 1);
  });

  it('库存为 0 时判定为已领完，且库存不会变成负数', () => {
    const inv = buildInventory();
    inv.counts.THREE_RED = 0;
    const res = consumePrize(AWARD_MAP.THREE_RED, inv);
    expect(res.granted).toBe(false);
    expect(res.exhausted).toBe(true);
    expect(res.deferred).toBe(false);
    expect(res.prizeKey).toBe('THREE_RED');
    expect(inv.counts.THREE_RED).toBe(0);
  });

  it('无奖不发任何东西', () => {
    const inv = buildInventory();
    const before = { ...inv.counts };
    const res = consumePrize(AWARD_MAP.NONE, inv);
    expect(res.prizeKey).toBeNull();
    expect(res.granted).toBe(false);
    expect(res.exhausted).toBe(false);
    expect(res.deferred).toBe(false);
    expect(inv.counts).toEqual(before);
  });

  it('Champion Tier 一律延后，掷出当时不扣库存、不发奖', () => {
    const inv = buildInventory();
    for (const id of CHAMPION_IDS) {
      const before = inv.counts.CHAMPION;
      const res = consumePrize(AWARD_MAP[id], inv);
      expect(res.deferred).toBe(true);
      expect(res.granted).toBe(false);
      expect(res.exhausted).toBe(false);
      expect(res.prizeKey).toBe('CHAMPION');
      expect(inv.counts.CHAMPION).toBe(before);
    }
  });

  it('一种奖品被领完不影响其他奖品', () => {
    const inv = buildInventory();
    inv.counts.ONE_SHOW = 0;
    expect(consumePrize(AWARD_MAP.ONE_SHOW, inv).exhausted).toBe(true);
    expect(consumePrize(AWARD_MAP.TWO_LIFT, inv).granted).toBe(true);
    expect(consumePrize(AWARD_MAP.DUITANG, inv).granted).toBe(true);
  });

  it('连续领取直到领完，正好能发出「配货那么多」个三红', () => {
    const inv = buildInventory();
    const n = inv.counts.THREE_RED;
    const results = Array.from({ length: n + 2 }, () => consumePrize(AWARD_MAP.THREE_RED, inv));
    expect(results.filter((r) => r.granted)).toHaveLength(n);
    expect(results.filter((r) => r.exhausted)).toHaveLength(2);
    expect(inv.counts.THREE_RED).toBe(0);
  });
});

describe('grantChampionPrize · 结算发状元奖', () => {
  it('库存还有 1 个时发放成功并归零', () => {
    const inv = buildInventory();
    expect(inv.counts.CHAMPION).toBe(1);
    expect(grantChampionPrize(inv)).toBe(true);
    expect(inv.counts.CHAMPION).toBe(0);
  });

  it('已经发过就再也发不出去（幂等）', () => {
    const inv = buildInventory();
    expect(grantChampionPrize(inv)).toBe(true);
    expect(grantChampionPrize(inv)).toBe(false);
    expect(grantChampionPrize(inv)).toBe(false);
    expect(inv.counts.CHAMPION).toBe(0);
  });
});

describe('hasStock', () => {
  it('正确反映库存是否还有剩余', () => {
    const inv = buildInventory();
    expect(hasStock(inv, 'CHAMPION')).toBe(true);
    expect(hasStock(inv, 'ONE_SHOW')).toBe(true);
    inv.counts.ONE_SHOW = 0;
    expect(hasStock(inv, 'ONE_SHOW')).toBe(false);
  });
});
