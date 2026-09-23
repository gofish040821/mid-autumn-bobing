/**
 * LobbyPage —— 入席页。
 *
 * 同一个组件承担两种状态：
 *   A) 还没入席：匿名取号、进大厅；
 *   B) 已经入席：圆桌（桌面端）/ 纵向名单（手机端）+ 开席控制。
 */
import { useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { motion } from 'framer-motion';

import {
  NICKNAME_MAX,
  NICKNAME_MIN,
  ROOM_CODE_LENGTH,
  isValidRoomCode,
  normalizeRoomCode,
  pickRandomNickname,
} from '@bobing/shared';
import type { PlayerState } from '@bobing/shared';

import TopBar from '../components/Common/TopBar';
import PlayerList from '../components/PlayerList/PlayerList';
import { useGameStore, selectIsHost } from '../stores/gameStore';
import { buildInviteLink } from '../lib/roomLink';
import { countdownText, initialOf } from '../lib/format';
import { useCountdown } from '../hooks/useCountdown';
import './LobbyPage.css';

const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

/** 手机端阈值：圆桌在窄屏上施展不开，降级成纵向名单。 */
const NARROW_QUERY = '(max-width: 640px)';

/** 圆桌上名牌离圆心多远（占轨道边长的百分比）。 */
const SEAT_RADIUS = 46;

/* ------------------------------------------------------------------ *
 * 圆桌上的名牌
 * ------------------------------------------------------------------ */

interface SeatPlateProps {
  player: PlayerState;
  isMe: boolean;
}

function SeatPlate({ player, isMe }: SeatPlateProps): JSX.Element {
  return (
    <div
      className={`lobby-seat${isMe ? ' lobby-seat--me' : ''}${
        player.online ? '' : ' lobby-seat--offline'
      }`}
      title={`${player.seat} 号 · ${player.nickname}${player.online ? '' : '（暂离）'}`}
    >
      <span className="lobby-seat__avatar t-kai" aria-hidden="true">
        {initialOf(player.nickname)}
      </span>
      <span className="lobby-seat__info">
        <span className="lobby-seat__name">{player.nickname}</span>
        <span className="lobby-seat__meta">
          <span className="t-nums">{player.seat} 号</span>
          <span className={`dot ${player.online ? 'dot--on' : 'dot--off'}`} aria-hidden="true" />
          {player.isHost && <span className="lobby-seat__tag lobby-seat__tag--host">主</span>}
          {isMe && <span className="lobby-seat__tag lobby-seat__tag--me">我</span>}
        </span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 页面
 * ------------------------------------------------------------------ */

export default function LobbyPage(): JSX.Element {
  const hasJoined = useGameStore((s) => s.hasJoined);
  const snapshot = useGameStore((s) => s.snapshot);
  const identity = useGameStore((s) => s.identity);
  const serverTimeOffset = useGameStore((s) => s.serverTimeOffset);
  const joining = useGameStore((s) => s.joining);
  const lastError = useGameStore((s) => s.lastError);
  const join = useGameStore((s) => s.join);
  const rename = useGameStore((s) => s.rename);
  const startGame = useGameStore((s) => s.startGame);
  const clearError = useGameStore((s) => s.clearError);
  const roomCode = useGameStore((s) => s.roomCode);
  const createRoom = useGameStore((s) => s.createRoom);
  const useRoomCode = useGameStore((s) => s.useRoomCode);
  const creatingRoom = useGameStore((s) => s.creatingRoom);
  const isHost = useGameStore(selectIsHost);

  const [nickname, setNickname] = useState<string>(identity.nickname);
  const [starting, setStarting] = useState<boolean>(false);
  const [renameOpen, setRenameOpen] = useState<boolean>(false);
  const [renameValue, setRenameValue] = useState<string>(identity.nickname);
  const [codeInput, setCodeInput] = useState<string>('');
  const [codeOpen, setCodeOpen] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(NARROW_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(NARROW_QUERY);
    const onChange = (event: MediaQueryListEvent): void => setNarrow(event.matches);
    setNarrow(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const autoStartAt = snapshot?.autoStartAt ?? null;
  const autoCountdown = useCountdown(autoStartAt, serverTimeOffset, 5000);

  /* ---------------- A) 还没入席 ---------------- */

  const trimmed = nickname.trim();
  const lengthOk = trimmed.length >= NICKNAME_MIN && trimmed.length <= NICKNAME_MAX;
  const hasRoom = roomCode !== null;
  const canJoin = lengthOk && hasRoom && !joining;
  const validationText =
    trimmed.length > 0 && trimmed.length < NICKNAME_MIN ? `雅号至少 ${NICKNAME_MIN} 个字` : null;
  const errorText = lastError ?? validationText;

  const takenNicknames = (snapshot?.players ?? []).map((p) => p.nickname);

  const handleNicknameChange = (event: ChangeEvent<HTMLInputElement>): void => {
    setNickname(event.target.value);
    if (lastError) clearError();
  };

  const handleRandom = (): void => {
    setNickname(pickRandomNickname(takenNicknames));
    if (lastError) clearError();
  };

  const handleCreateRoom = async (): Promise<void> => {
    if (lastError) clearError();
    await createRoom();
  };

  const handleCodeSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (lastError) clearError();
    if (useRoomCode(codeInput)) setCodeOpen(false);
  };

  const handleCopyInvite = async (): Promise<void> => {
    if (!roomCode) return;
    const link = buildInviteLink(roomCode);
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 剪贴板不可用（非 https、或浏览器拒绝）时退而求其次：把链接选中让人自己复制
      window.prompt('复制这条链接发给朋友：', link);
    }
  };

  const handleJoinSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canJoin) return;
    await join(trimmed);
  };

  /* ---------------- B) 已经入席 ---------------- */

  const players = snapshot?.players ?? [];
  const total = players.length;
  const seatCount = Math.max(1, total);
  const minPlayers = snapshot?.minPlayers ?? 2;
  const maxPlayers = snapshot?.maxPlayers ?? 15;
  const myId = identity.playerId;

  const statusText =
    total >= maxPlayers
      ? `满员 · 共 ${maxPlayers} 位，即刻开席`
      : total < minPlayers
        ? `当前 ${total} / ${maxPlayers} 人 · 还需要 ${minPlayers - total} 位朋友才能开席`
        : `当前 ${total} / ${maxPlayers} 人 · 人已齐，房主可以开席`;

  const canStart = isHost && total >= minPlayers;

  const handleStart = async (): Promise<void> => {
    if (!canStart || starting) return;
    setStarting(true);
    try {
      await startGame();
    } finally {
      setStarting(false);
    }
  };

  const trimmedRename = renameValue.trim();
  const canRename = trimmedRename.length >= NICKNAME_MIN && trimmedRename.length <= NICKNAME_MAX;

  const openRename = (): void => {
    setRenameValue(identity.nickname);
    setRenameOpen(true);
  };

  const handleRenameSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canRename) return;
    await rename(trimmedRename);
    setRenameOpen(false);
  };

  /* ---------------- 渲染 ---------------- */

  if (!hasJoined) {
    return (
      <div className="page lobby-page">
        <TopBar />

        <motion.section
          className="scroll scroll--rod lobby-join"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: EASE }}
        >
          <h1 className="t-kai lobby-join__title">入席</h1>
          <p className="lobby-join__lede">取个雅号，与朋友们同坐一桌。</p>
          <hr className="hairline" />

          {/* ---- 选桌：链接带码就免了这一步，否则先开一桌或输码 ---- */}
          <section className="lobby-room">
            {hasRoom ? (
              <>
                <div className="lobby-room__label t-muted">这一桌的房间码</div>
                <div className="lobby-room__code-row">
                  <span className="lobby-room__code t-nums">{roomCode}</span>
                  <button type="button" className="btn btn--gold btn--sm" onClick={handleCopyInvite}>
                    {copied ? '已复制' : '复制邀请链接'}
                  </button>
                </div>
                <p className="lobby-room__note">把链接发给朋友，他们打开就能坐进同一桌。</p>
              </>
            ) : codeOpen ? (
              <form className="lobby-room__code-form" onSubmit={handleCodeSubmit}>
                <label className="lobby-room__label t-muted" htmlFor="lobby-room-code">
                  输入朋友的房间码
                </label>
                <div className="lobby-room__code-row">
                  <input
                    id="lobby-room-code"
                    className="lobby-room__input t-nums"
                    type="text"
                    value={codeInput}
                    onChange={(event) => {
                      setCodeInput(normalizeRoomCode(event.target.value));
                      if (lastError) clearError();
                    }}
                    maxLength={ROOM_CODE_LENGTH}
                    placeholder={'·'.repeat(ROOM_CODE_LENGTH)}
                    aria-label="房间码"
                    autoComplete="off"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    inputMode="text"
                  />
                  <button
                    type="submit"
                    className="btn btn--gold btn--sm"
                    disabled={!isValidRoomCode(codeInput)}
                  >
                    加入
                  </button>
                </div>
                <button
                  type="button"
                  className="lobby-room__back t-muted"
                  onClick={() => {
                    setCodeOpen(false);
                    if (lastError) clearError();
                  }}
                >
                  ← 改成自己开一桌
                </button>
              </form>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--gold btn--block lobby-room__create"
                  onClick={() => {
                    void handleCreateRoom();
                  }}
                  disabled={creatingRoom}
                >
                  {creatingRoom ? '正在开桌……' : '开一张新桌'}
                </button>
                <button
                  type="button"
                  className="lobby-room__join-existing t-muted"
                  onClick={() => {
                    setCodeOpen(true);
                    if (lastError) clearError();
                  }}
                >
                  朋友已经开好桌了？用房间码加入
                </button>
              </>
            )}
          </section>

          <hr className="hairline" />

          <form className="lobby-join__form" onSubmit={handleJoinSubmit}>
            <label className="lobby-join__label t-kai" htmlFor="lobby-nickname">
              雅号
            </label>
            <div className="lobby-join__field">
              <input
                id="lobby-nickname"
                className="lobby-join__input"
                type="text"
                name="nickname"
                value={nickname}
                onChange={handleNicknameChange}
                maxLength={NICKNAME_MAX}
                placeholder="取个雅号，如：月下客"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                enterKeyHint="go"
              />
              <button
                type="button"
                className="btn btn--ghost lobby-join__random"
                onClick={handleRandom}
              >
                随机取名
              </button>
            </div>

            <button
              type="submit"
              className="btn btn--primary btn--block lobby-join__submit"
              disabled={!canJoin}
            >
              {joining ? '入席中……' : hasRoom ? '进入大厅' : '请先开桌或加入一桌'}
            </button>
          </form>

          {errorText !== null && (
            <p className="lobby-join__error" role="alert">
              {errorText}
            </p>
          )}

          <p className="lobby-join__hint">无需注册，昵称与座位只保存在你自己的浏览器里</p>
        </motion.section>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="page lobby-page">
        <TopBar />
        <div className="scroll scroll--plain lobby-loading t-muted">正在入席，请稍候……</div>
      </div>
    );
  }

  return (
    <div className="page lobby-page">
      <TopBar />

      <header className="lobby-head">
        <h1 className="t-title lobby-head__title">月满中秋 · 今夜博饼局</h1>
        <p className="lobby-head__count t-nums">
          当前人数 <strong>{total}</strong> / {maxPlayers}
        </p>
        {roomCode && (
          <p className="lobby-head__room t-nums">
            房间 <strong>{roomCode}</strong>
          </p>
        )}
      </header>

      {narrow ? (
        <PlayerList snapshot={snapshot} myPlayerId={myId} compact />
      ) : (
        <div className="lobby-round">
          <div className="lobby-round__orbit">
            <div className="lobby-round__rim" aria-hidden="true" />
            <div className="lobby-round__felt" aria-hidden="true">
              <span className="lobby-round__moon t-kai">月</span>
              <span className="lobby-round__count t-nums">
                {total} / {maxPlayers}
              </span>
            </div>

            {players.map((player) => {
              const angle = -90 + (player.seat / seatCount) * 360;
              const rad = (angle * Math.PI) / 180;
              const left = 50 + SEAT_RADIUS * Math.cos(rad);
              const top = 50 + SEAT_RADIUS * Math.sin(rad);
              return (
                <div
                  className="lobby-seat-slot"
                  key={player.id}
                  style={{ left: `${left}%`, top: `${top}%` }}
                >
                  <SeatPlate player={player} isMe={player.id === myId} />
                </div>
              );
            })}
          </div>
        </div>
      )}

      <section className="panel lobby-status">
        <p className="lobby-status__text">{statusText}</p>

        {autoStartAt !== null && !autoCountdown.expired && (
          <p className="lobby-status__auto t-nums" role="status">
            <span className="lobby-status__auto-num">{countdownText(autoCountdown.remainingMs)}</span>
            秒后自动开席
          </p>
        )}

        <div className="lobby-status__actions">
          {isHost ? (
            <button
              type="button"
              className="btn btn--primary btn--block lobby-start"
              onClick={() => {
                void handleStart();
              }}
              disabled={!canStart || starting}
            >
              {starting ? '开席中……' : '开始游戏'}
            </button>
          ) : (
            <p className="lobby-status__wait">等待房主开席……</p>
          )}
        </div>

        <p className="lobby-status__foot">骰子由服务器掷出，所有人同时看到结果</p>
      </section>

      {roomCode && (
        <section className="panel panel--tight lobby-invite">
          <div className="lobby-invite__row">
            <span className="lobby-invite__label t-muted">
              还差人？把这桌的链接发出去
            </span>
            <button
              type="button"
              className="btn btn--gold btn--sm"
              onClick={handleCopyInvite}
            >
              {copied ? '已复制' : '复制邀请链接'}
            </button>
          </div>
        </section>
      )}

      <section className="panel panel--tight lobby-rename">
        {renameOpen ? (
          <form className="lobby-rename__form" onSubmit={handleRenameSubmit}>
            <input
              className="lobby-rename__input"
              type="text"
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              maxLength={NICKNAME_MAX}
              placeholder="新的雅号"
              aria-label="新的雅号"
              autoComplete="off"
              spellCheck={false}
            />
            <button type="submit" className="btn btn--gold btn--sm" disabled={!canRename}>
              确定
            </button>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => setRenameOpen(false)}
            >
              取消
            </button>
          </form>
        ) : (
          <div className="row-between lobby-rename__idle">
            <span className="lobby-rename__label t-muted">雅号不合适？随时可以改。</span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={openRename}>
              改名
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
