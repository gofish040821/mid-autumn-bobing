/**
 * AwardCelebration —— 一次开奖的完整演出。
 *
 * 从下到上四层：
 *   1) 幕布（墨色压场，浓度按奖项等级：无奖几乎不压，Champion Tier 最深）
 *   2) 专属特效层（满月、灯笼、屏风、桂花…，见 effects.tsx）
 *   3) 中央金榜卷轴：从中间横向展开，写奖项名、得主、骰子回显与得分
 *   4) 四角朱砂印章 + 首中状元/金榜易主/代掷等小字
 *
 * 演出时长严格取自 shared 的 celebrationMsFor(awardId)，与骰子动画同一条时间轴，
 * 服务端推进下一回合的节奏才不会和画面对不上。减少动画时压缩到 500ms。
 *
 * 整层 pointer-events: none，绝不挡住下一轮点击。
 */
import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { AWARD_MAP, celebrationMsFor } from '@bobing/shared';
import type { AwardPalette, RollRecord } from '@bobing/shared';

import { useGameStore } from '../../stores/gameStore';
import { randomNoneMessage } from '../../lib/format';
import DiceFace from '../Dice/DiceFace';
import { orderDiceForAward } from '../../lib/diceOrder';
import Seal from '../Common/Seal';
import { EffectLayer } from './effects';
import './celebration.css';

export interface AwardCelebrationProps {
  roll: RollRecord;
  /** 演出结束后调用（组件自己按 durationMs 计时，不要在动画未结束时调用） */
  onDone: () => void;
}

/** 收尾淡出的时长（包含在总时长之内，用于提前进入退场）。 */
const EXIT_MS = 260;

/** 减少动画时的总时长。 */
const REDUCED_MS = 500;

/** 把 CSS 自定义属性塞进 style（CSSProperties 不含 --* 键）。 */
function vars(input: Record<string, string>): CSSProperties {
  return input as unknown as CSSProperties;
}

/** #A33A2B → rgba(163, 58, 43, a)；解析失败时回落到墨色。 */
function withAlpha(hex: string, alpha: number): string {
  const raw = hex.replace('#', '').trim();
  const full =
    raw.length === 3
      ? raw
          .split('')
          .map((c) => c + c)
          .join('')
      : raw;
  const value = Number.parseInt(full, 16);
  if (full.length !== 6 || !Number.isFinite(value)) return `rgba(41, 37, 31, ${alpha})`;
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** 幕布浓度：无奖几乎透明，普通奖中等，状元级最深。 */
function curtainAlphaFor(tier: RollRecord['tier']): number {
  if (tier === 'CHAMPION') return 0.82;
  if (tier === 'NORMAL') return 0.42;
  return 0.14;
}

function curtainStyleFor(palette: AwardPalette, tier: RollRecord['tier']): CSSProperties {
  const alpha = curtainAlphaFor(tier);
  return {
    background: [
      `radial-gradient(circle at 50% 44%, ${withAlpha(palette.primary, 0.18)}, ${withAlpha(
        palette.primary,
        0,
      )} 62%)`,
      `radial-gradient(circle at 50% 50%, ${withAlpha(palette.ink, alpha * 0.38)}, ${withAlpha(
        '#17140f',
        alpha,
      )} 84%)`,
    ].join(', '),
  };
}

export default function AwardCelebration({ roll, onDone }: AwardCelebrationProps): JSX.Element {
  const reduced = useGameStore((s) => s.reducedMotion);

  const definition = AWARD_MAP[roll.awardId];
  const palette = definition.palette;
  const duration = reduced ? REDUCED_MS : celebrationMsFor(roll.awardId);

  const [leaving, setLeaving] = useState(false);

  // 到点收场：先淡出，再通知 store 摘下浮层
  useEffect(() => {
    setLeaving(false);
    const exitAt = Math.max(120, duration - EXIT_MS);
    const leaveTimer = window.setTimeout(() => setLeaving(true), exitAt);
    const doneTimer = window.setTimeout(() => onDone(), duration);
    return () => {
      window.clearTimeout(leaveTimer);
      window.clearTimeout(doneTimer);
    };
  }, [duration, onDone, roll.id]);

  // 无奖的俏皮话每次开奖只挑一句，不在重渲染时乱跳
  const noneText = useMemo(() => randomNoneMessage(), [roll.id]);

  // 演出越短，入场动作就要越快：无奖只有 0.85 秒，卷轴必须当场开完
  const unrollMs = Math.round(Math.min(460, duration * 0.34));
  const riseMs = Math.round(Math.min(420, duration * 0.3));
  const sealDelayMs = Math.round(duration * 0.18);
  const sealMs = Math.round(Math.min(560, duration * 0.36));
  const awardDelayMs = Math.round(duration * 0.09);
  const whoDelayMs = Math.round(duration * 0.17);

  const curtainClasses = ['cel-curtain', reduced ? '' : 'cel-anim-curtain']
    .filter((c) => c.length > 0)
    .join(' ');
  const scrollClasses = ['cel-scroll', reduced ? '' : 'cel-anim-unroll']
    .filter((c) => c.length > 0)
    .join(' ');
  const sealClasses = ['cel-seal', reduced ? '' : 'cel-anim-seal']
    .filter((c) => c.length > 0)
    .join(' ');
  const riseClass = reduced ? '' : 'cel-anim-rise';
  const riseVars = { '--cel-rise-dur': `${riseMs}ms` };

  let statusNode: JSX.Element;
  if (roll.awardId === 'NONE') {
    statusNode = <span className="cel-none">{noneText}</span>;
  } else if (roll.inventoryExhausted) {
    statusNode = <span className="cel-void">奖品已领完</span>;
  } else if (roll.prizeGranted && roll.scoreGained > 0) {
    statusNode = <span className="cel-score">+{roll.scoreGained} 分</span>;
  } else {
    statusNode = <span className="cel-rule">{definition.rule}</span>;
  }

  const flags: JSX.Element[] = [];
  if (roll.becameFirstChampion) {
    flags.push(
      <span className="cel-flag cel-flag--win" key="first">
        首中状元
      </span>,
    );
  }
  if (roll.replacedChampion) {
    flags.push(
      <span className="cel-flag cel-flag--win" key="replaced">
        金榜易主
      </span>,
    );
  }
  if (roll.auto) {
    flags.push(
      <span className="cel-flag cel-flag--auto" key="auto">
        系统代掷
      </span>,
    );
  }

  return (
    <motion.div
      className="cel-stage"
      initial={{ opacity: 0 }}
      animate={{ opacity: leaving ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.24, ease: 'easeOut' }}
    >
      <div className={curtainClasses} style={curtainStyleFor(palette, roll.tier)} />

      <EffectLayer effect={definition.effect} palette={palette} reduced={reduced} />

      <div className={scrollClasses} style={vars({ '--cel-unroll-dur': `${unrollMs}ms` })}>
        <span className="cel-rod cel-rod--top" />

        <div className="cel-board">
          <p
            className={['cel-kicker', riseClass].filter((c) => c.length > 0).join(' ')}
            style={vars(riseVars)}
          >
            {definition.title}
          </p>

          <h2
            className={['cel-award', riseClass].filter((c) => c.length > 0).join(' ')}
            style={vars({ ...riseVars, color: palette.primary, '--cel-delay': `${awardDelayMs}ms` })}
          >
            {definition.name}
          </h2>

          <p
            className={['cel-who', riseClass].filter((c) => c.length > 0).join(' ')}
            style={vars({ ...riseVars, '--cel-delay': `${whoDelayMs}ms` })}
          >
            <span>{roll.nickname}</span>
            <span className="cel-seat">{roll.seat} 号座</span>
          </p>

          <div className="cel-dice">
            {orderDiceForAward(roll.dice, roll.awardId).map((value, i) => (
              <DiceFace key={i} value={value} size={36} />
            ))}
          </div>

          <p className="cel-status">{statusNode}</p>

          {flags.length > 0 ? <div className="cel-flags">{flags}</div> : null}
        </div>

        <span className="cel-rod cel-rod--bottom" />

        <span
          className={sealClasses}
          style={vars({ '--cel-seal-delay': `${sealDelayMs}ms`, '--cel-seal-dur': `${sealMs}ms` })}
        >
          <Seal
            text={definition.name}
            sub={definition.subtitle}
            size="md"
            tone={definition.tier === 'CHAMPION' ? 'cinnabar' : 'gold'}
          />
        </span>
      </div>
    </motion.div>
  );
}
