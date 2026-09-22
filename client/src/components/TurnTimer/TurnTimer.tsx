/**
 * 回合倒计时 —— 一只克制的环。
 *
 * 环的墨色随时间由黛青 → 金棕 → 朱砂过渡，只做「提示」，不做惊吓：
 * 没有闪烁、没有滴答声、永远不显示负秒数。
 * 超时后由服务器代掷，这里只写一句小字。
 */
import { useCountdown } from '../../hooks/useCountdown';
import './TurnTimer.css';

export interface TurnTimerProps {
  /** 服务端下发的回合截止时间戳；null 表示没有回合 */
  deadlineAt: number | null;
  /** store 的 serverTimeOffset */
  serverTimeOffset: number;
  /** 回合总时长，默认 30000 */
  totalMs?: number;
  /** 是否是我的回合（决定视觉强度） */
  mine?: boolean;
  className?: string;
}

type Rgb = readonly [number, number, number];

const DAI: Rgb = [61, 89, 96];
const GOLD: Rgb = [177, 138, 85];
const CINNABAR: Rgb = [163, 58, 43];

const VIEW = 68;
const RADIUS = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function mix(from: Rgb, to: Rgb, t: number): string {
  const k = clamp01(t);
  const r = Math.round(from[0] + (to[0] - from[0]) * k);
  const g = Math.round(from[1] + (to[1] - from[1]) * k);
  const b = Math.round(from[2] + (to[2] - from[2]) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

/** 剩余比例 1 → 黛青，0.5 → 金棕，0 → 朱砂 */
function arcColor(ratio: number): string {
  const r = clamp01(ratio);
  if (r >= 0.5) return mix(DAI, GOLD, (1 - r) / 0.5);
  return mix(GOLD, CINNABAR, (0.5 - r) / 0.5);
}

export default function TurnTimer({
  deadlineAt,
  serverTimeOffset,
  totalMs = 30000,
  mine = false,
  className,
}: TurnTimerProps): JSX.Element {
  const hasTurn = typeof deadlineAt === 'number' && Number.isFinite(deadlineAt);
  const { seconds, ratio, expired } = useCountdown(hasTurn ? deadlineAt : null, serverTimeOffset, totalMs);

  const shownRatio = hasTurn ? clamp01(ratio) : 1;
  const shownSeconds = expired ? 0 : Math.max(0, seconds);
  const strokeColor = hasTurn ? arcColor(shownRatio) : 'var(--ink-faint)';

  const caption = !hasTurn ? '暂无回合' : expired ? '超时 · 系统代掷' : mine ? '轮到你了' : '等待中';

  const rootClass = [
    'tt',
    mine && hasTurn && !expired ? 'tt--mine' : '',
    !hasTurn || expired ? 'tt--calm' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={rootClass} role="timer" aria-label={`回合倒计时 ${hasTurn ? `${shownSeconds} 秒` : '未开始'}`}>
      <div className="tt__ringWrap">
        <svg
          className="tt__ring"
          viewBox={`0 0 ${VIEW} ${VIEW}`}
          width={VIEW}
          height={VIEW}
          aria-hidden="true"
          focusable="false"
        >
          <circle className="tt__track" cx={VIEW / 2} cy={VIEW / 2} r={RADIUS} />
          <circle
            className="tt__arc"
            cx={VIEW / 2}
            cy={VIEW / 2}
            r={RADIUS}
            style={{
              stroke: strokeColor,
              strokeDasharray: CIRCUMFERENCE,
              strokeDashoffset: CIRCUMFERENCE * (1 - shownRatio),
            }}
            transform={`rotate(-90 ${VIEW / 2} ${VIEW / 2})`}
          />
        </svg>

        <span className="tt__num t-nums">
          {hasTurn ? shownSeconds : '—'}
          {hasTurn && <i className="tt__unit">秒</i>}
        </span>
      </div>

      <span className={mine && hasTurn && !expired ? 'tt__caption tt__caption--mine' : 'tt__caption'}>
        {caption}
      </span>
    </div>
  );
}
