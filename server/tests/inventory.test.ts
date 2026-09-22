/**
 * 奖品库存与发奖测试。
 *
 * 核心规则：
 *  - 库存 > 0 才扣库存、才加积分；
 *  - 库存 = 0 时骰型照常显示，但标为「已领完」，不发奖不加分；
 *  - Champion Tier 一律延后，只在结算时发给最终状元一个人。
 */
import { describe, expect, it } from 'vitest';
import { AWARD_MAP, PRIZE_KEYS } from '@bobing/shared';
import type { InventoryState, PrizeKey } from '@bobing/shared';

import { buildInventory, emptyInventory, previewInventory } from '../src/config/prizes';
import { consumePrize, grantChampionPrize, hasStock } from '../src/game/PrizeService';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/config/gameConfig';

const expectInventory = (inv: InventoryState, expected: Record<PrizeKey, number>): void => {
  expect(inv.counts).toEqual(expected);
};

describe('buildInventory · 库存配置', () => {
  it('4 人局：一秀16 二举8 三红4 四进2 对堂1 状元1', () => {
    expectInventory(buildInventory(4), {
      ONE_SHOW: 16,
      TWO_LIFT: 8,
      THREE_RED: 4,
      FOUR_ADVANCE: 2,
      DUITANG: 1,
      CHAMPION: 1,
    });
  });

  it('10 人局：一秀40 二举20 三红10 四进5 对堂2 状元1', () => {
    expectInventory(buildInventory(10), {
      ONE_SHOW: 40,
      TWO_LIFT: 20,
      THREE_RED: 10,
      FOUR_ADVANCE: 5,
      DUITANG: 2,
      CHAMPION: 1,
    });
  });

  it('所有人数下都严格满足题干给出的公式', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      const inv = buildInventory(n);
      expect(inv.counts.ONE_SHOW).toBe(4 * n);
      expect(inv.counts.TWO_LIFT).toBe(2 * n);
      expect(inv.counts.THREE_RED).toBe(n);
      expect(inv.counts.FOUR_ADVANCE).toBe(Math.ceil(n / 2));
      expect(inv.counts.DUITANG).toBe(Math.max(1, Math.ceil(n / 5)));
      expect(inv.counts.CHAMPION).toBe(1);
    }
  });

  it('状元永远只有一个——七种状元骰型共用这一份库存', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      expect(buildInventory(n).counts.CHAMPION).toBe(1);
    }
  });

  it('对堂至少 1 个（人少时也发得出去）', () => {
    expect(buildInventory(0).counts.DUITANG).toBe(1);
    expect(buildInventory(1).counts.DUITANG).toBe(1);
  });

  it('initial 是 counts 的快照，之后改动 counts 不会污染 initial', () => {
    const inv = buildInventory(4);
    inv.counts.ONE_SHOW = 0;
    expect(inv.initial.ONE_SHOW).toBe(16);
    expect(inv.initial).not.toBe(inv.counts);
  });

  it('每次调用都返回全新对象（不会共享引用）', () => {
    const a = buildInventory(4);
    const b = buildInventory(4);
    expect(a).not.toBe(b);
    expect(a.counts).not.toBe(b.counts);
    expect(a.counts).toEqual(b.counts);
  });

  it('emptyInventory / previewInventory 与 buildInventory 一致', () => {
    const empty = emptyInventory();
    expect(empty.counts.CHAMPION).toBe(1);
    expect(empty.counts.ONE_SHOW).toBe(0);
    expect(previewInventory(6)).toEqual(buildInventory(6).counts);
  });

  it('库存里只包含合法的奖品 key', () => {
    const inv = buildInventory(7);
    expect(Object.keys(inv.counts).sort()).toEqual([...PRIZE_KEYS].sort());
    for (const key of PRIZE_KEYS) {
      expect(Number.isInteger(inv.counts[key])).toBe(true);
      expect(inv.counts[key]).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('consumePrize · 普通奖项发奖', () => {
  it('库存充足时扣 1 个并判定为已发奖', () => {
    const inv = buildInventory(4);
    const res = consumePrize(AWARD_MAP.THREE_RED, inv);
    expect(res.granted).toBe(true);
    expect(res.exhausted).toBe(false);
    expect(res.deferred).toBe(false);
    expect(res.prizeKey).toBe('THREE_RED');
    expect(inv.counts.THREE_RED).toBe(3);
  });

  it('库存为 0 时判定为已领完，且库存不会变成负数', () => {
    const inv = buildInventory(4);
    inv.counts.THREE_RED = 0;
    const res = consumePrize(AWARD_MAP.THREE_RED, inv);
    expect(res.granted).toBe(false);
    expect(res.exhausted).toBe(true);
    expect(res.deferred).toBe(false);
    expect(res.prizeKey).toBe('THREE_RED');
    expect(inv.counts.THREE_RED).toBe(0);
  });

  it('无奖不发任何东西', () => {
    const inv = buildInventory(4);
    const before = { ...inv.counts };
    const res = consumePrize(AWARD_MAP.NONE, inv);
    expect(res.prizeKey).toBeNull();
    expect(res.granted).toBe(false);
    expect(res.exhausted).toBe(false);
    expect(res.deferred).toBe(false);
    expect(inv.counts).toEqual(before);
  });

  it('Champion Tier 一律延后，掷出当时不扣库存、不发奖', () => {
    const inv = buildInventory(4);
    for (const id of [
      'FOUR_FOUR',
      'FIVE_SCHOLAR',
      'FIVE_FOUR',
      'SIX_BLACK',
      'BROCADE',
      'SIX_FOUR',
      'CHAMPION_FLOWER',
    ] as const) {
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
    const inv = buildInventory(4);
    inv.counts.ONE_SHOW = 0;
    expect(consumePrize(AWARD_MAP.ONE_SHOW, inv).exhausted).toBe(true);
    expect(consumePrize(AWARD_MAP.TWO_LIFT, inv).granted).toBe(true);
    expect(consumePrize(AWARD_MAP.DUITANG, inv).granted).toBe(true);
  });

  it('连续领取直到领完，正好能发出 N 个三红', () => {
    const n = 4;
    const inv = buildInventory(n);
    const results = Array.from({ length: n + 2 }, () => consumePrize(AWARD_MAP.THREE_RED, inv));
    expect(results.filter((r) => r.granted)).toHaveLength(n);
    expect(results.filter((r) => r.exhausted)).toHaveLength(2);
    expect(inv.counts.THREE_RED).toBe(0);
  });
});

describe('grantChampionPrize · 结算发状元奖', () => {
  it('库存还有 1 个时发放成功并归零', () => {
    const inv = buildInventory(6);
    expect(inv.counts.CHAMPION).toBe(1);
    expect(grantChampionPrize(inv)).toBe(true);
    expect(inv.counts.CHAMPION).toBe(0);
  });

  it('已经发过就再也发不出去（幂等）', () => {
    const inv = buildInventory(6);
    expect(grantChampionPrize(inv)).toBe(true);
    expect(grantChampionPrize(inv)).toBe(false);
    expect(grantChampionPrize(inv)).toBe(false);
    expect(inv.counts.CHAMPION).toBe(0);
  });
});

describe('hasStock', () => {
  it('正确反映库存是否还有剩余', () => {
    const inv = buildInventory(4);
    expect(hasStock(inv, 'CHAMPION')).toBe(true);
    expect(hasStock(inv, 'ONE_SHOW')).toBe(true);
    inv.counts.ONE_SHOW = 0;
    expect(hasStock(inv, 'ONE_SHOW')).toBe(false);
  });
});
