/**
 * ScoreBoard —— 金榜式排行榜。
 *
 * 排序规则与服务端一致：积分降序，同分按座位升序。
 * 前三名用金 / 黛青 / 淡墨三色榜帖，其余名次保持素净。
 */
import { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { GameSnapshot, PlayerState } from '@bobing/shared';
import { rankLabel } from '../../lib/format';
import './ScoreBoard.css';

export interface ScoreBoardProps {
  snapshot: GameSnapshot;
  myPlayerId: string | null;
  /** 最多显示几条，默认全部 */
  limit?: number;
  title?: string;
  className?: string;
}

interface RankRow {
  player: PlayerState;
  rank: number;
}

export default function ScoreBoard({
  snapshot,
  myPlayerId,
  limit,
  title = '单局题名榜',
  className,
}: ScoreBoardProps): JSX.Element {
  const rows = useMemo<RankRow[]>(() => {
    return [...snapshot.players]
      .sort((a, b) => b.score - a.score || a.seat - b.seat)
      .map((player, index) => ({ player, rank: index + 1 }));
  }, [snapshot.players]);

  const visible = useMemo<RankRow[]>(() => {
    if (limit === undefined || limit < 0) return rows;
    return rows.slice(0, limit);
  }, [rows, limit]);

  const championId = snapshot.champion.playerId;
  const nobodyScored = rows.every((row) => row.player.score <= 0);

  const rootClass = ['scroll', 'scroll--plain', 'board', className ?? ''].filter((t) => t !== '').join(' ');

  return (
    <section className={rootClass}>
      <div className="row-between board__head">
        <span className="section-label grow">{title}</span>
        {rows.length > 0 && (
          <span className="board__count t-nums">
            {visible.length} / {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 || nobodyScored ? (
        <p className="board__empty t-fang">静候第一炉桂香</p>
      ) : (
        <ol className="board__rows scroll-y">
          {visible.map(({ player, rank }) => {
            const isMe = myPlayerId !== null && player.id === myPlayerId;
            const isCandidate = championId !== null && championId === player.id;
            const rowClass = [
              'board__row',
              rank <= 3 ? `board__row--${rank}` : '',
              isMe ? 'board__row--me' : '',
            ]
              .filter((t) => t !== '')
              .join(' ');

            return (
              <motion.li
                key={player.id}
                className={rowClass}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.22, 0.61, 0.36, 1] }}
              >
                <span className="board__rank t-kai">{rankLabel(rank)}</span>

                <span className="board__who">
                  <span className="board__name t-kai">{player.nickname}</span>
                  {isCandidate && (
                    <span className="badge badge--host board__candidate" title="当前状元候选">
                      状元候选
                    </span>
                  )}
                  {isMe && <span className="badge badge--me">我</span>}
                </span>

                <span className="board__score t-nums">
                  {player.score}
                  <span className="board__unit">分</span>
                </span>
              </motion.li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
