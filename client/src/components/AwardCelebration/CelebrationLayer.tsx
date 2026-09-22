/**
 * CelebrationLayer —— 全局开奖浮层。
 *
 * 只做三件事：从 store 读当前演出、在固定浮层里播放它、演完通知 store 收场。
 * 浮层本身 position:fixed 且 pointer-events:none，所以开奖期间玩家照样能
 * 点到下面的按钮（尤其是「博饼」）。真正需要点击的元素才单独开 pointer-events。
 */
import { AnimatePresence } from 'framer-motion';

import { useGameStore } from '../../stores/gameStore';
import AwardCelebration from './AwardCelebration';
import './celebration.css';

export default function CelebrationLayer(): JSX.Element | null {
  const celebration = useGameStore((s) => s.celebration);
  const dismissCelebration = useGameStore((s) => s.dismissCelebration);

  if (!celebration) return null;

  return (
    <div className="cel-root">
      <AnimatePresence initial={false}>
        <AwardCelebration
          key={celebration.key}
          roll={celebration.roll}
          onDone={dismissCelebration}
        />
      </AnimatePresence>
    </div>
  );
}
