/** Six CSS 3D cubes. Authoritative faces enter the DOM only on reveal. */
import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AwardId } from '@bobing/shared';
import { orderDiceForAward } from '../../lib/diceOrder';
import { diceChinese } from '../../lib/format';
import { useGameStore } from '../../stores/gameStore';
import DiceFace from './DiceFace';
import './Dice.css';
import './Dice3D.css';

export interface DiceStageProps {
  dice: number[] | null;
  awardId?: AwardId;
  rolling: boolean;
  durationMs: number;
  animKey: number;
  highlight?: boolean;
}

const SIDES = ['front', 'back', 'right', 'left', 'top', 'bottom'] as const;
const FACES = [1, 6, 3, 4, 2, 5];

function settledFace(front: number, side: number): number {
  if (!front) return 0;
  const remaining = [1, 2, 3, 4, 5, 6].filter((value) => value !== front && value !== 7 - front);
  return [front, 7 - front, remaining[0], 7 - remaining[0], remaining[1], 7 - remaining[1]][side];
}

export default function DiceStage({ dice, awardId, rolling, durationMs, animKey }: DiceStageProps): JSX.Element {
  const reduced = useGameStore((s) => s.reducedMotion);
  const [systemReduced, setSystemReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setSystemReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  const quiet = reduced || systemReduced;
  // Reduced motion must wait for exactly the same reveal as a normal animation.
  const settled = rolling ? [] : orderDiceForAward(dice ?? [], awardId);
  const hasResult = settled.length === 6;
  const label = rolling ? '骰子正在翻滚，等待落定' : hasResult ? `骰子落定，点数 ${diceChinese(settled)}` : '六骰待掷';

  return (
    <div className={`dice-stage dice-stage--3d${rolling ? ' is-rolling' : ''}${quiet ? ' is-quiet' : ''}`} data-rolling={rolling}>
      <div className="dice-stage__board">
        <span className="dice-stage__bowl" aria-hidden="true" />
        <div className="dice-stage__dice" role="img" aria-label={label}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={`${animKey}-${index}`} className="dice-stage__die" aria-hidden="true"
              style={{ '--roll-duration': `${durationMs}ms`, '--tilt': `${index % 2 ? -1 : 1}`, '--jump': `${32 + index * 4}px` } as CSSProperties}>
              <div className="die-cube">
                {SIDES.map((side, faceIndex) => (
                  <div key={side} className={`die-cube__face die-cube__face--${side}`}>
                    <DiceFace value={rolling ? (quiet ? 0 : FACES[faceIndex]) : settledFace(settled[index] ?? 0, faceIndex)} size={48} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="dice-stage__hint" aria-live="polite">{label}</p>
    </div>
  );
}
