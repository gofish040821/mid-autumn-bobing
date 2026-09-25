/**
 * PrizeService —— 库存扣减。
 *
 * 规则：
 *  - 普通奖项库存 > 0 才扣库存发奖、才加积分；
 *  - 库存 = 0 时骰型依然照常显示，但标为「奖品已领完」，不发奖不加分；
 *  - Champion Tier 一律延后（deferred），等追状元结束只发一次给最终状元。
 */
import type { AwardDefinition, InventoryState, PrizeKey } from '@bobing/shared';
import { ENDING_PRIZE_KEYS } from '../config/prizes.js';

export interface PrizeResolution {
  prizeKey: PrizeKey | null;
  /** 是否真的扣了库存并进入玩家奖品清单 */
  granted: boolean;
  /** 骰型达到了奖项，但库存已经领完 */
  exhausted: boolean;
  /** Champion Tier：延后到结算时统一发放 */
  deferred: boolean;
}

/**
 * 判定并（在发奖时）扣减库存。
 *
 * 注意：`inventory` 是服务端状态对象，库存充足时本函数会就地扣减。
 */
export function consumePrize(award: AwardDefinition, inventory: InventoryState): PrizeResolution {
  if (award.tier === 'CHAMPION') {
    return { prizeKey: 'CHAMPION', granted: false, exhausted: false, deferred: true };
  }
  const key = award.prizeKey;
  if (!key) {
    return { prizeKey: null, granted: false, exhausted: false, deferred: false };
  }
  if (inventory.counts[key] > 0) {
    inventory.counts[key] -= 1;
    return { prizeKey: key, granted: true, exhausted: false, deferred: false };
  }
  return { prizeKey: key, granted: false, exhausted: true, deferred: false };
}

/**
 * 结算时给最终状元发唯一的状元奖（库存 1 → 0）。
 * @returns 是否成功发出
 */
export function grantChampionPrize(inventory: InventoryState): boolean {
  if (inventory.counts.CHAMPION > 0) {
    inventory.counts.CHAMPION -= 1;
    return true;
  }
  return false;
}

export function hasStock(inventory: InventoryState, key: PrizeKey): boolean {
  return inventory.counts[key] > 0;
}

/**
 * 饼是否博尽了 —— 五样普通饼全部为 0，本局就该收席。
 *
 * 只看 ENDING_PRIZE_KEYS，**不看状元**：Champion Tier 的库存要到 settle
 * 才扣（consumePrize 返回 deferred），在这里看它等于这道闸门永远打不开。
 */
export function isInventoryExhausted(inventory: InventoryState): boolean {
  return ENDING_PRIZE_KEYS.every((key) => inventory.counts[key] <= 0);
}
