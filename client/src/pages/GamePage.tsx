/**
 * GamePage —— 对局进行中（普通博饼 / 追状元）。
 *
 * 服务端权威：这一页只做两件事 —— 把 snapshot 画出来，把「博饼」这一次点击发出去。
 * 骰子、奖项、积分、库存、状元归属全部来自服务端，客户端不自行判定任何结果。
 *
 * 布局（移动优先，DOM 顺序即手机单列顺序）：
 *   手机 < 640px  → 单列：状态条 → 倒计时 → 骰子 → 博饼 → 开奖回显 → 追状元 → 席位 → 题名榜 → 库存 → 记录
 *   平板 640~1023 → 主舞台跨满宽在上，下面左右分栏（席位 / 库存）
 *   桌面 >= 1024  → 三栏（席位 / 主舞台 / 库存）+ 题名榜·博饼记录两栏
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AWARD_MAP } from '@bobing/shared';
import type { RollRecord } from '@bobing/shared';

import TopBar from '../components/Common/TopBar';
import SiteFooter from '../components/Common/SiteFooter';
import TurnTimer from '../components/TurnTimer/TurnTimer';
import DiceStage from '../components/Dice/DiceStage';
import ChampionPanel from '../components/ChampionPanel/ChampionPanel';
import PlayerList from '../components/PlayerList/PlayerList';
import ScoreBoard from '../components/ScoreBoard/ScoreBoard';
import PrizeInventory from '../components/PrizeInventory/PrizeInventory';
import GameLog from '../components/GameLog/GameLog';

import { awardName } from '../lib/format';
import { selectCanRoll, selectIsMyTurn, useGameStore } from '../stores/gameStore';
import './GamePage.css';

/** 服务端回合时限，与 server/src/config/gameConfig.ts 的 TURN_TIMEOUT_MS 保持一致。 */
const TURN_TOTAL_MS = 5_000;
/** 未拿到服务端时长时的兜底骰子动画时长。 */
const FALLBACK_DICE_MS = 1400;

const PHASE_LABEL: Record<string, string> = {
  LOBBY: '候席',
  NORMAL_TURN: '博饼进行中',
  CHAMPION_CHASE: '追状元',
  SETTLING: '结算中',
  FINISHED: '本局终了',
};

interface LastRollLineProps {
  roll: RollRecord;
}

/** 手机上收起次要信息；切到宽屏时展开，用户仍可手动切换。 */
function GameFold({ className, title, children }: { className: string; title: string; children: ReactNode }) {
  const [expanded, setExpanded] = useState(() => window.matchMedia('(min-width: 640px)').matches);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 640px)');
    const update = () => setExpanded(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <details className={`${className} game-block game-fold`} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
    <summary>{title}</summary>
    {children}
  </details>;
}

/** 最近一次开奖的一行紧凑回显。 */
function LastRollLine({ roll }: LastRollLineProps) {
  const color = AWARD_MAP[roll.awardId]?.palette.primary ?? 'var(--ink)';
  const outcome = roll.prizeGranted
    ? `+${roll.scoreGained} 分`
    : roll.inventoryExhausted
      ? '奖品已领完'
      : '无奖';

  return (
    <div className="game-result panel panel--tight" role="status">
      <span className="game-result__name">{roll.nickname}</span>
      <span className="game-result__sep" aria-hidden="true">
        ·
      </span>
      <span className="game-result__award t-kai" style={{ color }}>
        {awardName(roll.awardId)}
      </span>
      <span className="game-result__sep" aria-hidden="true">
        ·
      </span>
      <span className="game-result__outcome">{outcome}</span>
      {roll.auto && <span className="badge">代掷</span>}
    </div>
  );
}

export default function GamePage(): JSX.Element {
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, []);
  const snapshot = useGameStore((s) => s.snapshot);
  const myId = useGameStore((s) => s.identity.playerId);
  const canRoll = useGameStore(selectCanRoll);
  const isMyTurn = useGameStore(selectIsMyTurn);
  const rollAnim = useGameStore((s) => s.rollAnim);
  const serverTimeOffset = useGameStore((s) => s.serverTimeOffset);
  const doRoll = useGameStore((s) => s.roll);
  const rollPending = useGameStore((s) => s.rollPending);
  const championFlash = useGameStore((s) => s.championFlash);
  const connection = useGameStore((s) => s.connection);

  // 快照可能在这一刻是空的：房主离席会把整桌作废，store 里的 snapshot 随之清空，
  // 而 AnimatePresence 的退场动画期间这个组件还挂着（它正要在那 340ms 里淡出）。
  // 少了这一句，退场那一瞬间就会读到 null 的属性、当场抛异常，
  // 整棵组件树跟着崩掉 —— 用户看到的是一片白，而不是「这一桌散了」。
  if (!snapshot) return <></>;

  const currentTurn = snapshot.currentTurn;
  const isChase = snapshot.phase === 'CHAMPION_CHASE';
  const lastRoll = snapshot.lastRoll;

  const lastRollIsCurrent =
    lastRoll !== null && currentTurn !== null && lastRoll.rollIndex === currentTurn.rollIndex;

  let hint: string;
  if (!currentTurn) {
    hint = '等待下一位入席……';
  } else if (lastRollIsCurrent && lastRoll.auto) {
    hint = '本回合由系统代掷';
  } else if (!isMyTurn) {
    hint = `「${currentTurn.nickname}」正在博饼`;
  } else {
    hint = '轮到你出手，倒计时结束后由系统代掷';
  }

  const pageClass = `page game${isChase ? ' game--chase' : ''}${isMyTurn ? ' game--mine' : ''}`;

  return (
    <div className={pageClass}>
      <TopBar />

      {/* 无障碍播报：轮到自己时提示一次 */}
      <span className="sr-only" aria-live="polite">
        {isMyTurn ? '轮到你了' : ''}
      </span>

      <div className="game__grid">
        {/* 2 当前玩家 / 状态条 */}
        <div className="game__status game-block">
          <div className="game__call-wrap">
            <AnimatePresence mode="wait" initial={false}>
              {isMyTurn ? (
                <motion.p
                  key="mine"
                  className="game__call game__call--mine t-kai"
                  initial={{ opacity: 0, scale: 0.86 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ type: 'spring', stiffness: 280, damping: 22 }}
                >
                  轮到你了
                </motion.p>
              ) : (
                <motion.p
                  key={`wait-${currentTurn?.playerId ?? 'none'}`}
                  className="game__call t-kai"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
                >
                  等待「{currentTurn?.nickname ?? '下一位'}」博饼……
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          <div className="game__meta row wrap">
            <span className={`badge${isChase ? ' badge--champion' : ''}`}>
              {PHASE_LABEL[snapshot.phase] ?? '对局中'}
            </span>
            {currentTurn && <span className="badge t-nums">第 {currentTurn.rollIndex} 次</span>}
            {connection !== 'connected' && <span className="badge">连线中…</span>}
          </div>

          {isChase && currentTurn && (
            <p className="game__chase-line t-gold t-nums">
              追状元 · 第 {currentTurn.chaseIndex} 位挑战
            </p>
          )}

          <AnimatePresence>
            {championFlash && (
              <motion.p
                key={championFlash.key}
                className="game__flash t-cinnabar"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {championFlash.previousNickname
                  ? `金榜易主：「${championFlash.previousNickname}」的状元被「${championFlash.newNickname}」夺去`
                  : `「${championFlash.newNickname}」登上状元席`}
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        {/* 3 倒计时 */}
        <div className="game__timer game-block">
          <TurnTimer
            deadlineAt={currentTurn?.deadlineAt ?? null}
            serverTimeOffset={serverTimeOffset}
            totalMs={TURN_TOTAL_MS}
            mine={isMyTurn}
          />
        </div>

        {/* 4 骰子 */}
        <div className="game__dice game-block">
          <DiceStage
            dice={rollAnim?.dice ?? snapshot.lastRoll?.dice ?? null}
            awardId={snapshot.lastRoll?.awardId}
            rolling={!!rollAnim?.rolling}
            durationMs={rollAnim?.durationMs ?? FALLBACK_DICE_MS}
            animKey={rollAnim?.key ?? 0}
            highlight={!!snapshot.lastRoll?.isChampionTier}
          />
        </div>

        {/* 5 博饼按钮 */}
        <div className="game__roll game-block">
          <button
            type="button"
            className={`btn-roll${canRoll ? ' btn-roll--live' : ''}`}
            disabled={!canRoll || rollPending}
            aria-label="博饼"
            onClick={() => {
              if (canRoll) void doRoll();
            }}
          >
            {rollPending ? '博饼中…' : '博 饼'}
          </button>
          <p className="game__roll-hint t-fang">{hint}</p>
        </div>

        {/* 6 最近一次开奖回显 */}
        <div className="game__result game-block">
          {rollAnim?.rolling ? <p className="game__result-empty t-muted">六骰未定，静候佳音。</p> : lastRoll ? (
            <LastRollLine roll={lastRoll} />
          ) : (
            <p className="game__result-empty t-muted">今夜尚无记录，静候第一声骰响。</p>
          )}
        </div>

        {/* 7 追状元状态 */}
        <div className="game__champ game-block">
          <ChampionPanel snapshot={snapshot} />
        </div>

        {/* 8 玩家轮转 */}
        <div className="game__players game-block">
          <PlayerList snapshot={snapshot} myPlayerId={myId} />
        </div>

        {/* 9 积分榜 */}
        <GameFold className="game__score" title="查看题名榜">
          <ScoreBoard snapshot={snapshot} myPlayerId={myId} title="单局题名榜" />
        </GameFold>

        {/* 10 库存 */}
        <div className="game__inv game-block">
          <PrizeInventory snapshot={snapshot} />
        </div>

        {/* 11 游戏日志 */}
        <GameFold className="game__log" title="查看博饼记录">
          <GameLog snapshot={snapshot} />
        </GameFold>
      </div>
      <SiteFooter />
    </div>
  );
}
