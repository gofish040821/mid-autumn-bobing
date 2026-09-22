/**
 * PrizeInventory —— 奖品库存面板。
 *
 * 遍历 PRIZE_KEYS（一秀 / 二举 / 三红 / 四进 / 对堂 / 状元），
 * 每行一条金色细进度条 + 「剩余 / 初始」。状元全桌唯一，单独强调；
 * 领完的行整体压暗并压一条极细的朱砂划线。
 */
import { useMemo } from 'react';
import { PRIZE_KEYS, PRIZE_NAMES } from '@bobing/shared';
import type { GameSnapshot, PrizeKey } from '@bobing/shared';
import './PrizeInventory.css';

export interface PrizeInventoryProps {
  snapshot: GameSnapshot;
  className?: string;
}

interface PrizeRow {
  key: PrizeKey;
  name: string;
  /** 剩余库存 */
  remaining: number;
  /** 开局库存 */
  initial: number;
  /** 剩余比例 0~1 */
  ratio: number;
  empty: boolean;
  champion: boolean;
}

export default function PrizeInventory({ snapshot, className }: PrizeInventoryProps): JSX.Element {
  const rows = useMemo<PrizeRow[]>(() => {
    const { counts, initial } = snapshot.inventory;
    return PRIZE_KEYS.map((key) => {
      const initialCount = Math.max(0, initial[key]);
      const remainingCount = Math.max(0, Math.min(counts[key], initialCount));
      return {
        key,
        name: PRIZE_NAMES[key],
        remaining: remainingCount,
        initial: initialCount,
        ratio: initialCount > 0 ? remainingCount / initialCount : 0,
        empty: remainingCount <= 0,
        champion: key === 'CHAMPION',
      };
    });
  }, [snapshot.inventory]);

  const rootClass = ['scroll', 'scroll--plain', 'inv', className ?? ''].filter((t) => t !== '').join(' ');

  return (
    <section className={rootClass}>
      <div className="row-between inv__head">
        <span className="section-label grow">奖品库存</span>
      </div>

      <ul className="inv__rows">
        {rows.map((row) => {
          const rowClass = [
            'inv__row',
            row.champion ? 'inv__row--champion' : '',
            row.empty ? 'inv__row--empty' : '',
          ]
            .filter((t) => t !== '')
            .join(' ');

          return (
            <li key={row.key} className={rowClass}>
              <span className="inv__label">
                <span className="inv__name t-kai">{row.name}</span>
                {row.champion && <span className="inv__only">唯一</span>}
              </span>

              <span
                className="inv__bar"
                role="img"
                aria-label={`${row.name}剩余 ${row.remaining} 份，共 ${row.initial} 份`}
              >
                <span className="inv__bar-fill" style={{ transform: `scaleX(${row.ratio})` }} />
              </span>

              <span className="inv__count t-nums">
                <span className="inv__now">{row.remaining}</span>
                <span className="inv__sep"> / </span>
                <span className="inv__total">{row.initial}</span>
              </span>

              {row.empty && <span className="inv__strike" aria-hidden="true" />}
              {row.empty && <span className="sr-only">已领完</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
