import type { AwardId } from '@bobing/shared';

/** 只调整展示顺序，保留服务端的原始骰子数据与判奖结果。 */
export function orderDiceForAward(dice: readonly number[], awardId?: AwardId): number[] {
  if (awardId === 'DUITANG') return [...dice].sort((a, b) => a - b);

  let leadingFace: number | undefined;
  switch (awardId) {
    case 'CHAMPION_FLOWER':
    case 'SIX_FOUR':
    case 'FIVE_FOUR':
    case 'FOUR_FOUR':
    case 'THREE_RED':
    case 'TWO_LIFT':
    case 'ONE_SHOW':
      leadingFace = 4;
      break;
    case 'FOUR_ADVANCE':
    case 'FIVE_SCHOLAR': {
      const count = awardId === 'FOUR_ADVANCE' ? 4 : 5;
      leadingFace = dice.find((face) => face !== 4 && dice.filter((d) => d === face).length === count);
      break;
    }
  }

  if (leadingFace === undefined) return [...dice];
  return [
    ...dice.filter((face) => face === leadingFace),
    ...dice.filter((face) => face !== leadingFace),
  ];
}
