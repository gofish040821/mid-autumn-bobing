/**
 * Moon —— 月华进度（月相）。
 *
 * 底圈是一枚暗色描边的空月，亮面用 clipPath 从下往上填满，表示月华进度。
 * IDLE 只有极细描边；CHARGING 随进度渐满并轻微呼吸发光；FULL 满月、外圈柔光脉动；
 * DONE 满月之外在月心落一枚朱砂「桂」印，静止不闪。
 *
 * 样式与 keyframes 写在与本组件同目录的 Background.css 中（本目录不新建 css 文件）。
 * 动画只有 transform / opacity。
 */
import { useId } from 'react';
import './Background.css';

export interface MoonProps {
  /** 0~1，月华进度；1 表示月满 */
  progress: number;
  /** 阶段：IDLE 不明显 / CHARGING 渐满 / FULL 将满 / DONE 已出状元 */
  stage: 'IDLE' | 'CHARGING' | 'FULL' | 'DONE';
  /** 直径，默认 64 */
  size?: number;
  className?: string;
}

type MoonStage = MoonProps['stage'];

const STAGE_CLASS: Record<MoonStage, string> = {
  IDLE: 'moon-field--idle',
  CHARGING: 'moon-field--charging',
  FULL: 'moon-field--full',
  DONE: 'moon-field--done',
};

/** 月盘半径（viewBox 100×100 内的用户单位） */
const R = 44;
/** 月心 */
const C = 50;
/** 月盘上下沿 */
const TOP_Y = C - R;
const BOTTOM_Y = C + R;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function labelFor(stage: MoonStage, progress: number): string {
  if (stage === 'IDLE') return '月华未起';
  if (stage === 'DONE') return '月满，状元已出';
  if (stage === 'FULL') return '月华将满';
  return `月华 ${Math.round(progress * 10)} 成`;
}

export default function Moon({ progress, stage, size = 64, className }: MoonProps): JSX.Element {
  // useId 生成的 id 含冒号，会干扰 CSS 选择器解析，这里去掉
  const uid = useId().replace(/:/g, '');
  const clipId = `moon-clip-${uid}`;
  const fillId = `moon-fill-${uid}`;

  const p = clamp01(progress);
  const px = Number.isFinite(size) && size > 0 ? size : 64;

  // 亮面矩形：从月盘底部往上长，p=1 时恰好覆盖整轮
  const fillHeight = 2 * R * p;
  const fillY = BOTTOM_Y - fillHeight;

  const stageClass = STAGE_CLASS[stage] ?? STAGE_CLASS.IDLE;
  const wrapperClass = `moon-field ${stageClass}${className ? ` ${className}` : ''}`;

  return (
    <div
      className={wrapperClass}
      style={{ width: px, height: px }}
      role="img"
      aria-label={labelFor(stage, p)}
    >
      <span className="moon-field__halo" aria-hidden="true" />
      <svg
        className="moon-field__svg"
        viewBox="0 0 100 100"
        width={px}
        height={px}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <clipPath id={clipId}>
            <circle cx={C} cy={C} r={R} />
          </clipPath>
          <linearGradient id={fillId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#FFF8E1" />
            <stop offset="56%" stopColor="#F7E7B8" />
            <stop offset="100%" stopColor="#E8C77A" />
          </linearGradient>
        </defs>

        {/* 暗月 */}
        <circle className="moon-field__disc" cx={C} cy={C} r={R} />

        {/* 亮面 */}
        {fillHeight > 0 ? (
          <g clipPath={`url(#${clipId})`}>
            <rect x="0" y={fillY} width="100" height={fillHeight} fill={`url(#${fillId})`} />
          </g>
        ) : null}

        {/* 月轮描边 */}
        <circle className="moon-field__rim" cx={C} cy={C} r={R} />

        {/* 状元已出：月心朱砂桂印 */}
        {stage === 'DONE' ? (
          <g>
            <circle className="moon-field__seal-ring" cx={C} cy={C} r="16" />
            <text
              className="moon-field__seal-text"
              x={C}
              y={C}
              textAnchor="middle"
              dominantBaseline="central"
            >
              桂
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
