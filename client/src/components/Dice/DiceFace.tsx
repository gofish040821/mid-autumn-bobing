/**
 * DiceFace —— 一颗中式骰子。
 *
 * 象牙白底 + 墨线勾边 + 朱砂点数，四角压一丝极淡的祥云弧，
 * 全部用内联 SVG 画出来，不依赖任何外部图片。
 *
 * 坐标系直接以 px 为单位（viewBox = 0 0 size size），
 * 所以外部用 CSS 缩放时整套比例依旧成立。
 */
import { useId } from 'react';
import './Dice.css';

export interface DiceFaceProps {
  /** 1~6 */
  value: number;
  /** 边长 px，默认 52 */
  size?: number;
  className?: string;
}

/** 标准骰子排布，坐标是边长的比例（0~1）。 */
const FACE_DOTS: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
  [], // 0：空骰面
  [[0.5, 0.5]], // 1：中
  [
    [0.28, 0.28],
    [0.72, 0.72],
  ], // 2：对角
  [
    [0.28, 0.28],
    [0.5, 0.5],
    [0.72, 0.72],
  ], // 3：对角 + 中
  [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.72],
    [0.72, 0.72],
  ], // 4：四角
  [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.5, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ], // 5：四角 + 中
  [
    [0.28, 0.28],
    [0.72, 0.28],
    [0.28, 0.5],
    [0.72, 0.5],
    [0.28, 0.72],
    [0.72, 0.72],
  ], // 6：两列各三
];

const NO_DOTS: ReadonlyArray<readonly [number, number]> = [];

/** 骰身描边宽度（viewBox 单位 = px，不随 size 缩放）。骰身内缩量由它推导。 */
const RIM_STROKE = 1.5;

/** 统一保留两位小数，避免属性里出现一长串浮点噪声。 */
function n(value: number): number {
  return Math.round(value * 100) / 100;
}

export default function DiceFace({ value, size = 52, className }: DiceFaceProps): JSX.Element {
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, '');
  const s = Number.isFinite(size) && size > 0 ? size : 52;

  const valid = Number.isInteger(value) && value >= 1 && value <= 6;
  const dots = valid ? FACE_DOTS[value] : NO_DOTS;

  /** 一点、四点用实心朱砂大圆；其余点数用略深略小的朱砂点，整体仍是一套。 */
  const isSolid = valid && (value === 1 || value === 4);
  const pipR = n(s * (isSolid ? 0.078 : 0.072));

  const rx = n(s * 0.18);
  /**
   * 骰身相对 viewBox 内缩半个描边宽（rim 的 strokeWidth 为 1.5），免得描边被裁掉。
   * 这里必须是「半个描边宽」这个绝对量，不能乘 s：viewBox 的单位就是 px，
   * 描边宽不随 size 缩放；一旦按比例内缩，width 会变成 s - 1.5s = 负数，
   * 骰身整块画不出来（只剩点数浮在碗里）。
   */
  const edge = RIM_STROKE / 2;

  // 四角云纹：一小段绕角弧线，只作点缀
  const c = n(s * 0.07);
  const p = n(s * 0.18);
  const cloudWidth = n(Math.max(0.8, s * 0.022));
  const clouds = [
    `M ${p} ${c} Q ${c} ${c} ${c} ${p}`,
    `M ${n(s - p)} ${c} Q ${n(s - c)} ${c} ${n(s - c)} ${p}`,
    `M ${n(s - c)} ${n(s - p)} Q ${n(s - c)} ${n(s - c)} ${n(s - p)} ${n(s - c)}`,
    `M ${c} ${n(s - p)} Q ${c} ${n(s - c)} ${p} ${n(s - c)}`,
  ];

  const box = `0 0 ${s} ${s}`;
  const faceRect = {
    x: edge,
    y: edge,
    width: n(s - edge * 2),
    height: n(s - edge * 2),
    rx,
    ry: rx,
  } as const;

  const root = className ? `dice-face ${className}` : 'dice-face';

  return (
    <svg
      className={root}
      width={s}
      height={s}
      viewBox={box}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        {/* 象牙白底：左上偏暖，右下转米黄 */}
        <linearGradient id={`${uid}-body`} x1="0.05" y1="0" x2="0.95" y2="1">
          <stop offset="0" stopColor="#FFFDF4" />
          <stop offset="0.55" stopColor="#F8F1E0" />
          <stop offset="1" stopColor="#EFE4CB" />
        </linearGradient>

        {/* 左上高光 */}
        <linearGradient id={`${uid}-hl`} x1="0.09" y1="0.04" x2="0.78" y2="0.92">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity="0.82" />
          <stop offset="0.42" stopColor="#FFFFFF" stopOpacity="0.2" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>

        {/* 右下淡阴影，做出厚度 */}
        <radialGradient id={`${uid}-sh`} cx="0.86" cy="0.9" r="0.82">
          <stop offset="0" stopColor="#29251F" stopOpacity="0.16" />
          <stop offset="0.55" stopColor="#29251F" stopOpacity="0.05" />
          <stop offset="1" stopColor="#29251F" stopOpacity="0" />
        </radialGradient>

        {/* 朱砂点：中心偏上一点亮，像釉面上的一滴颜料 */}
        <radialGradient id={`${uid}-pip`} cx="0.36" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#C0392B" />
          <stop offset="1" stopColor="#A33A2B" />
        </radialGradient>
      </defs>

      {/* 骰身 */}
      <rect {...faceRect} fill={`url(#${uid}-body)`} />
      <rect {...faceRect} fill={`url(#${uid}-hl)`} />
      <rect {...faceRect} fill={`url(#${uid}-sh)`} />

      {/* 四角祥云（极细，不抢眼） */}
      <g className="dice-face__cloud" strokeWidth={cloudWidth} fill="none" strokeLinecap="round">
        {clouds.map((d, i) => (
          <path key={i} d={d} />
        ))}
      </g>

      {/* 点数 */}
      {dots.map(([dx, dy], i) => (
        <circle
          key={i}
          cx={n(dx * s)}
          cy={n(dy * s)}
          r={pipR}
          className={isSolid ? 'dice-face__pip' : 'dice-face__pip dice-face__pip--deep'}
        />
      ))}

      {/* 墨线勾边 */}
      <rect {...faceRect} className="dice-face__rim" strokeWidth={RIM_STROKE} />
    </svg>
  );
}
