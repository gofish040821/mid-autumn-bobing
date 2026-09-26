import { useEffect } from 'react';
import { AWARD_MAP } from '@bobing/shared';
import { useGameStore } from '../../stores/gameStore';

/** 开奖之后轻量提示；状元只加一层淡金底色。 */
export default function CelebrationLayer(): JSX.Element | null {
  const celebration = useGameStore((s) => s.celebration);
  const flash = useGameStore((s) => s.championFlash);
  const dismiss = useGameStore((s) => s.dismissCelebration);
  useEffect(() => {
    if (!celebration) return;
    const timer = window.setTimeout(dismiss, celebration.roll.isChampionTier ? 2000 : 850);
    return () => window.clearTimeout(timer);
  }, [celebration, dismiss]);
  if (!celebration) return null;
  const { roll } = celebration;
  return (
    <div className="cel-root">
      <div className={`quiet-award${roll.isChampionTier ? ' quiet-award--champion' : ''}`} role="status">
        <strong>{AWARD_MAP[roll.awardId].name}</strong>
        <p>{roll.nickname}{roll.prizeGranted ? ` · +${roll.scoreGained} 分` : roll.inventoryExhausted ? ' · 奖品已领完' : ''}</p>
        {flash && <p>金榜易主 · {flash.newNickname}</p>}
      </div>
    </div>
  );
}
