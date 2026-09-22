/**
 * PlayerList —— 古代宴席式席位表。
 *
 * 只读组件：把服务端快照里的 players / currentTurn / champion 画成一张
 * 「席间诸位」的名册。所有状态都来自 props，组件内部不订阅 store，
 * 因此大厅页、游戏页、结算页都可以直接复用。
 */
import { useMemo } from 'react';
import type { GameSnapshot, PlayerState } from '@bobing/shared';
import './PlayerList.css';

export interface PlayerListProps {
  snapshot: GameSnapshot;
  myPlayerId: string | null;
  /** 紧凑模式（手机端） */
  compact?: boolean;
  className?: string;
}

/** 一至十席用圈号，超过十席退回阿拉伯数字 */
const SEAT_MARKS = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'] as const;

function seatMark(seat: number): string {
  return SEAT_MARKS[seat - 1] ?? String(seat);
}

interface PlayerRowProps {
  player: PlayerState;
  /** 是我的席位 */
  isMe: boolean;
  /** 正轮到这一席投骰 */
  isTurn: boolean;
  /** 正在追状元 */
  isChasing: boolean;
  /** 当前状元候选 */
  isChampion: boolean;
  compact: boolean;
}

function PlayerRow({ player, isMe, isTurn, isChasing, isChampion, compact }: PlayerRowProps): JSX.Element {
  const rowClass = [
    'plist__row',
    isMe ? 'plist__row--me' : '',
    isTurn ? 'plist__row--turn' : '',
    player.online ? '' : 'plist__row--offline',
  ]
    .filter((token) => token !== '')
    .join(' ');

  return (
    <li className={rowClass}>
      <span className="plist__seat">
        <span className="sr-only">{`第 ${player.seat} 席`}</span>
        <span className="plist__seat-mark" aria-hidden="true">
          {seatMark(player.seat)}
        </span>
        {isTurn && <span className="plist__seat-ring" aria-hidden="true" />}
      </span>

      <span className="plist__mid">
        <span className="plist__name t-kai">{player.nickname}</span>
        {isMe && <span className="badge badge--me">我</span>}
        {player.isHost && <span className="badge badge--host">房主</span>}
        {isChampion && (
          <span className="seal seal--sm seal--gold plist__seal" title="当前状元候选">
            状元
          </span>
        )}
        {isChasing && <span className="plist__chase">追状元</span>}
        {!player.online && <span className="plist__offline t-muted">离线</span>}
      </span>

      <span className="plist__right">
        <span className={`dot ${player.online ? 'dot--on' : 'dot--off'}`} aria-hidden="true" />
        <span className="plist__score t-nums">
          {player.score}
          {!compact && <span className="plist__unit">分</span>}
        </span>
      </span>
    </li>
  );
}

export default function PlayerList({
  snapshot,
  myPlayerId,
  compact = false,
  className,
}: PlayerListProps): JSX.Element {
  const { players, currentTurn, champion, phase, minPlayers, maxPlayers } = snapshot;

  const ordered = useMemo(() => [...players].sort((a, b) => a.seat - b.seat), [players]);

  const shortBy = Math.max(0, minPlayers - players.length);
  const showHint = phase === 'LOBBY' && shortBy > 0;

  const rootClass = ['scroll', 'scroll--plain', 'plist', compact ? 'plist--compact' : '', className ?? '']
    .filter((token) => token !== '')
    .join(' ');

  return (
    <section className={rootClass}>
      <div className="row-between plist__head">
        <span className="section-label grow">席间诸位</span>
        <span className="plist__count t-nums">
          {players.length} / {maxPlayers}
        </span>
      </div>

      {ordered.length === 0 ? (
        <p className="plist__empty t-fang">尚无人入席，虚位以待</p>
      ) : (
        <ul className="plist__rows scroll-y">
          {ordered.map((player) => (
            <PlayerRow
              key={player.id}
              player={player}
              isMe={myPlayerId !== null && player.id === myPlayerId}
              isTurn={currentTurn !== null && currentTurn.playerId === player.id}
              isChasing={currentTurn !== null && currentTurn.playerId === player.id && currentTurn.kind === 'CHASE'}
              isChampion={champion.playerId !== null && champion.playerId === player.id}
              compact={compact}
            />
          ))}
        </ul>
      )}

      {showHint && (
        <p className="plist__hint t-fang">还需要 {shortBy} 位朋友才能开席</p>
      )}
    </section>
  );
}
