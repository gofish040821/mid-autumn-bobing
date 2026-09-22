/**
 * 雅集纪事 —— 古典卷轴式日志。
 *
 * 最新的在最上面（倒序），新条目落笔后容器自动回到顶部，
 * 这样玩家抬手就能看见刚刚发生了什么。
 */
import { useEffect, useRef } from 'react';
import type { GameSnapshot, LogEntry } from '@bobing/shared';

import { clockText } from '../../lib/format';
import './GameLog.css';

export interface GameLogProps {
  snapshot: GameSnapshot;
  className?: string;
  maxHeight?: number;
}

export default function GameLog({
  snapshot,
  className,
  maxHeight = 240,
}: GameLogProps): JSX.Element {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const entries = snapshot.gameLog.slice().reverse();
  const count = snapshot.gameLog.length;

  // 新的在最上，所以「滚到底」= scrollTop 归零
  useEffect(() => {
    const box = boxRef.current;
    if (box) box.scrollTop = 0;
  }, [count]);

  const rootClass = ['log', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} aria-label="雅集纪事">
      <span className="section-label t-kai">雅 集 纪 事</span>

      <div
        ref={boxRef}
        className="log__box scroll-y"
        style={{ maxHeight }}
        role="log"
        aria-live="off"
      >
        {entries.length === 0 ? (
          <p className="log__empty t-muted">今夜尚无动静</p>
        ) : (
          <ul className="log__list">
            {entries.map((entry: LogEntry) => (
              <li key={entry.id} className={`log__item log__item--${entry.tone}`}>
                <span className="log__time t-nums">{clockText(entry.at)}</span>
                <span className="log__text">{entry.text}</span>
                {entry.tone === 'champion' && (
                  <span className="seal seal--sm seal--gold log__seal" aria-hidden="true">
                    状元
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
