/**
 * 追状元面板 —— 黄榜高悬，看谁的骰子能压过众人。
 *
 * 只有进入 CHAMPION_CHASE 阶段才展开完整内容；
 * 其他阶段只留一行低调的「尚无状元」，避免抢走主舞台的注意力。
 */
import { AnimatePresence, motion } from 'framer-motion';
import type { GameSnapshot } from '@bobing/shared';
import { getAward } from '@bobing/shared';

import DiceFace from '../Dice/DiceFace';
import { awardName, diceDigits, initialOf } from '../../lib/format';
import './ChampionPanel.css';

export interface ChampionPanelProps {
  snapshot: GameSnapshot;
  className?: string;
}

/** 两侧云纹：内联 SVG 手绘，不依赖任何外部资源。 */
function CloudMark({ flip = false }: { flip?: boolean }): JSX.Element {
  return (
    <svg
      className={flip ? 'cp__cloud cp__cloud--flip' : 'cp__cloud'}
      viewBox="0 0 48 20"
      width="48"
      height="20"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M2 15c4 0 5.4-4 9-4 2.6 0 3.8 1.8 5.8 1.8 3 0 3.8-4 7.6-4 3.4 0 4.6 3 6.8 3 2.6 0 3.4-2 6.2-2 3 0 4.6 2.2 6.6 5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M9 18.2c4.6 0 7.6-1.8 12.4-1.8 4.8 0 6.8 1.8 11.6 1.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

export default function ChampionPanel({ snapshot, className }: ChampionPanelProps): JSX.Element {
  const { champion, players, phase } = snapshot;

  const active = phase === 'CHAMPION_CHASE';
  const nickname = champion.nickname;
  const accent = champion.awardId ? getAward(champion.awardId).palette.primary : 'var(--gold)';
  const dice = champion.dice ?? [];

  const total = Math.max(0, champion.chaseTotal);
  const done = Math.min(Math.max(0, champion.chaseDone), total || Number.MAX_SAFE_INTEGER);
  const ratio = total > 0 ? Math.min(1, done / total) : 0;

  const nameById = new Map<string, string>();
  for (const p of players) nameById.set(p.id, p.nickname);

  const challengers = champion.chaseQueue.map((id) => ({
    id,
    nickname: nameById.get(id) ?? '宾客',
  }));

  const rootClass = ['cp', active ? 'cp--active' : 'cp--idle', className].filter(Boolean).join(' ');

  return (
    <section className={rootClass} aria-label="追状元">
      <div className="cp__banner">
        <CloudMark />
        <h3 className="cp__bannerText t-kai">追 状 元</h3>
        <CloudMark flip />
      </div>

      {nickname ? (
        <div className="cp__seat">
          <div className="cp__seatHead">
            <span className="cp__seatNick t-kai" title={nickname}>
              {nickname}
            </span>
            <span className="cp__seatAward" style={{ color: accent, borderColor: accent }}>
              {champion.awardId ? awardName(champion.awardId) : '虚位以待'}
            </span>
          </div>

          {dice.length > 0 && (
            <div className="cp__dice" aria-label={`状元骰面 ${diceDigits(dice)}`}>
              {dice.map((face, i) => (
                <DiceFace key={`${i}-${face}`} value={face} size={18} />
              ))}
            </div>
          )}

          {champion.seat !== null && (
            <span className="cp__seatMeta t-muted t-nums">{champion.seat} 号座</span>
          )}
        </div>
      ) : (
        <p className="cp__empty t-muted">
          <span className="cp__emptyDot" aria-hidden="true" />
          尚无状元
        </p>
      )}

      <AnimatePresence initial={false}>
        {active && (
          <motion.div
            key="cp-chase"
            className="cp__body"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <hr className="hairline" />

            <div className="cp__block">
              <span className="cp__label t-fang">剩余挑战者</span>
              {challengers.length > 0 ? (
                <div className="cp__pills">
                  {challengers.map((c) => (
                    <span key={c.id} className="cp__pill" title={c.nickname}>
                      <i className="cp__pillAvatar" aria-hidden="true">
                        {initialOf(c.nickname)}
                      </i>
                      <span className="cp__pillName">{c.nickname}</span>
                    </span>
                  ))}
                </div>
              ) : (
                <p className="cp__done t-gold">挑战已尽</p>
              )}
            </div>

            <div className="cp__block">
              <div className="row-between">
                <span className="cp__label t-fang">追榜进度</span>
                <span className="cp__count t-nums t-muted">
                  已追 {done} / {total}
                </span>
              </div>
              <div
                className="cp__track"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={Math.max(1, total)}
                aria-valuenow={done}
                aria-label="追状元进度"
              >
                <div className="cp__fill" style={{ transform: `scaleX(${ratio})` }} />
              </div>
            </div>

            {champion.replacements > 0 && (
              <p className="cp__replace t-cinnabar t-nums">
                金榜已易主 {champion.replacements} 次
              </p>
            )}

            <p className="cp__note t-muted">追状元只追这一圈，不延长。</p>
          </motion.div>
        )}
      </AnimatePresence>

      {!active && (
        <p className="cp__idleNote t-muted">
          {nickname ? '追榜之礼，待鸣锣而启' : '状元未出，饼还在博'}
        </p>
      )}
    </section>
  );
}
