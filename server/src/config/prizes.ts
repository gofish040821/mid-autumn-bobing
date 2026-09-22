/**
 * 奖品库存。
 *
 *   一秀 = 4N
 *   二举 = 2N
 *   三红 = N
 *   四进 = ceil(N / 2)
 *   对堂 = max(1, ceil(N / 5))
 *   状元 = 1   ← 所有 Champion Tier 共用这一个库存
 */
import type { InventoryState, PrizeKey } from '@bobing/shared';

export function buildInventory(playerCount: number): InventoryState {
  const n = Math.max(0, Math.floor(playerCount));
  const counts: Record<PrizeKey, number> = {
    ONE_SHOW: 4 * n,
    TWO_LIFT: 2 * n,
    THREE_RED: n,
    FOUR_ADVANCE: Math.ceil(n / 2),
    DUITANG: Math.max(1, Math.ceil(n / 5)),
    CHAMPION: 1,
  };
  return { counts, initial: { ...counts } };
}

export function emptyInventory(): InventoryState {
  return buildInventory(0);
}

/** 供测试与 UI 预览使用。 */
export function previewInventory(playerCount: number): Record<PrizeKey, number> {
  return buildInventory(playerCount).counts;
}
