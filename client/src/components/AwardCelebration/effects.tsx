/**
 * 开奖专属特效层 —— 每一种 AwardDefinition.effect 对应一个纯 CSS / 内联 SVG 的动画组件。
 *
 * 三条硬约束：
 *  1. 不引用任何外部图片 / 字体 / CDN，全部自己画（SVG path、渐变、box-shadow 静态装饰）；
 *  2. 动画只走 transform / opacity，元素数量控制在 24 个以内（粒子类最多 12 个一组）；
 *  3. reduced = true 时一律退化成静态呈现：动画类名整体不挂，元素自带「最终态」样式。
 *
 * 层次：.fx-back 在幕布之上、卷轴之下（满月、屏风、灯笼、祥云）；
 *       .fx-front 在卷轴之上（骰子定格、印章落下、花瓣与金屑）。
 */
import type { CSSProperties } from 'react';

export interface EffectPalette {
  primary: string;
  secondary: string;
  ink: string;
  glow: string;
}

export interface EffectProps {
  palette: EffectPalette;
  reduced: boolean;
}

/* ------------------------------------------------------------------ *
 * 小工具
 * ------------------------------------------------------------------ */

/** 把 CSS 自定义属性塞进 style（React 的 CSSProperties 不含 --* 键）。 */
function vars(input: Record<string, string>): CSSProperties {
  return input as unknown as CSSProperties;
}

/** 减少动画时不挂动画类名，元素直接以最终态出现。 */
function anim(reduced: boolean, name: string): string {
  return reduced ? '' : name;
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i);
}

/* ------------------------------------------------------------------ *
 * 基础图形
 * ------------------------------------------------------------------ */

/** 1~6 的点位（viewBox 24×24）。 */
const PIPS: Readonly<Record<number, ReadonlyArray<readonly [number, number]>>> = {
  1: [[12, 12]],
  2: [
    [7.6, 7.6],
    [16.4, 16.4],
  ],
  3: [
    [7.6, 7.6],
    [12, 12],
    [16.4, 16.4],
  ],
  4: [
    [7.6, 7.6],
    [16.4, 7.6],
    [7.6, 16.4],
    [16.4, 16.4],
  ],
  5: [
    [7.6, 7.6],
    [16.4, 7.6],
    [12, 12],
    [7.6, 16.4],
    [16.4, 16.4],
  ],
  6: [
    [7.6, 7.6],
    [16.4, 7.6],
    [7.6, 12],
    [16.4, 12],
    [7.6, 16.4],
    [16.4, 16.4],
  ],
};

const NO_PIPS: ReadonlyArray<readonly [number, number]> = [];

/** 演出用的小骰子（比 Dice/DiceFace 更轻，只有底 + 点）。 */
function FxDie({
  value,
  tone = 'paper',
  size = 30,
  className = '',
  style,
}: {
  value: number;
  tone?: 'paper' | 'red' | 'ink';
  size?: number;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  const pips = PIPS[value] ?? NO_PIPS;
  const classes = ['fx-die', `fx-die--${tone}`, className].filter((c) => c.length > 0).join(' ');
  return (
    <svg
      className={classes}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <rect className="fx-die__body" x="1.1" y="1.1" width="21.8" height="21.8" rx="5.4" />
      {PIPS[value] === undefined
        ? null
        : pips.map((pip, i) => (
            <circle key={i} className="fx-die__pip" cx={pip[0]} cy={pip[1]} r={2.15} />
          ))}
    </svg>
  );
}

/** 四瓣桂花（金桂）。颜色走 currentColor。 */
function Flower({
  size = 16,
  className = '',
  style,
}: {
  size?: number;
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <svg
      className={['fx-flower', className].filter((c) => c.length > 0).join(' ')}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <g className="fx-flower__petals">
        <ellipse cx="12" cy="6.4" rx="3.2" ry="4.6" />
        <ellipse cx="17.6" cy="12" rx="4.6" ry="3.2" />
        <ellipse cx="12" cy="17.6" rx="3.2" ry="4.6" />
        <ellipse cx="6.4" cy="12" rx="4.6" ry="3.2" />
      </g>
      <circle className="fx-flower__core" cx="12" cy="12" r="2" />
    </svg>
  );
}

/** 满月：圆盘 + 淡淡环形山，外层一圈光晕。 */
function Moon({ className = '', style }: { className?: string; style?: CSSProperties }): JSX.Element {
  return (
    <span
      className={['fx-pt', 'fx-moon', className].filter((c) => c.length > 0).join(' ')}
      style={style}
      aria-hidden="true"
    />
  );
}

/** 红灯笼：上下金盖 + 灯身 + 流苏。 */
function Lantern({
  className = '',
  style,
}: {
  className?: string;
  style?: CSSProperties;
}): JSX.Element {
  return (
    <span
      className={['fx-lantern', className].filter((c) => c.length > 0).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <span className="fx-lantern__cap" />
      <span className="fx-lantern__body" />
      <span className="fx-lantern__cap fx-lantern__cap--bottom" />
      <span className="fx-lantern__tassel" />
    </span>
  );
}

/** 如意祥云（金色）。 */
function Cloud({ className = '', style }: { className?: string; style?: CSSProperties }): JSX.Element {
  return (
    <span
      className={['fx-cloud', className].filter((c) => c.length > 0).join(' ')}
      style={style}
      aria-hidden="true"
    />
  );
}

/** 金榜：一条横卷，上下两根金轴。 */
function Banner({ className = '', style }: { className?: string; style?: CSSProperties }): JSX.Element {
  return (
    <span
      className={['fx-banner', className].filter((c) => c.length > 0).join(' ')}
      style={style}
      aria-hidden="true"
    >
      <span className="fx-banner__edge" />
      <span className="fx-banner__edge fx-banner__edge--bottom" />
    </span>
  );
}

/** 金色微粒：从中心向外飞散（最多 12 枚）。 */
function Specks({
  count,
  reduced,
  seed = 0,
}: {
  count: number;
  reduced: boolean;
  seed?: number;
}): JSX.Element {
  return (
    <>
      {range(Math.min(count, 12)).map((i) => {
        const angle = (i / count) * Math.PI * 2 + seed;
        const dist = 30 + ((i * 37) % 24);
        return (
          <span
            key={i}
            className={['fx-pt', 'fx-speck', anim(reduced, 'fx-anim-speck')]
              .filter((c) => c.length > 0)
              .join(' ')}
            style={vars({
              '--fx-size': `${6 + (i % 4) * 2}px`,
              '--fx-dx': `${Math.round(Math.cos(angle) * dist)}vmin`,
              '--fx-dy': `${Math.round(Math.sin(angle) * dist)}vmin`,
              '--fx-delay': `${i * 70}ms`,
            })}
          />
        );
      })}
    </>
  );
}

/** 朱砂花瓣：旋转着向外飘散（最多 12 枚）。 */
function Petals({
  count,
  reduced,
  tone = 'red',
  seed = 0,
}: {
  count: number;
  reduced: boolean;
  tone?: 'red' | 'gold';
  seed?: number;
}): JSX.Element {
  const color = tone === 'red' ? '#C0392B' : '#E8C77A';
  return (
    <>
      {range(Math.min(count, 12)).map((i) => {
        const angle = (i / count) * Math.PI * 2 + seed;
        const dist = 32 + ((i * 29) % 26);
        return (
          <span
            key={i}
            className={['fx-pt', 'fx-petal', anim(reduced, 'fx-anim-petal')]
              .filter((c) => c.length > 0)
              .join(' ')}
            style={vars({
              '--fx-size': '14px',
              '--fx-dx': `${Math.round(Math.cos(angle) * dist)}vmin`,
              '--fx-dy': `${Math.round(Math.sin(angle) * dist)}vmin`,
              '--fx-delay': `${i * 90}ms`,
              '--fx-rot': i % 2 === 0 ? '-220deg' : '200deg',
              color,
            })}
          >
            <Flower size={14} />
          </span>
        );
      })}
    </>
  );
}

/** 由素色骰子「变成」朱砂红骰子（十字淡入，不重排）。 */
function DieSwap({
  value,
  delay,
  size,
  reduced,
}: {
  value: number;
  delay: number;
  size: number;
  reduced: boolean;
}): JSX.Element {
  if (reduced) return <FxDie value={value} tone="red" size={size} />;
  return (
    <span className="fx-swap" style={vars({ '--fx-delay': `${delay}ms` })}>
      <FxDie value={value} tone="paper" size={size} />
      <span className="fx-swap__top fx-anim-swap">
        <FxDie value={value} tone="red" size={size} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * 无奖
 * ------------------------------------------------------------------ */

/** 淡墨涟漪扩散 + 一片桂花飘落。 */
export function NoneEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      <span
        className={['fx-pt', 'fx-ripple', anim(reduced, 'fx-anim-ripple')]
          .filter((c) => c.length > 0)
          .join(' ')}
        style={vars({ '--fx-size': 'min(72vw, 380px)' })}
      />
      <span
        className={['fx-pt', 'fx-ripple', anim(reduced, 'fx-anim-ripple')]
          .filter((c) => c.length > 0)
          .join(' ')}
        style={vars({ '--fx-size': 'min(52vw, 260px)', '--fx-delay': '360ms' })}
      />
      <span className={['fx-fall', anim(reduced, 'fx-anim-fall')].filter((c) => c.length > 0).join(' ')}>
        <Flower size={18} style={{ color: palette.secondary }} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 一秀 —— 桂香初绽
 * ------------------------------------------------------------------ */

const OSMANTHUS_SPOTS: ReadonlyArray<{ x: number; y: number; s: number }> = [
  { x: 24, y: 64, s: 17 },
  { x: 33, y: 41, s: 13 },
  { x: 45, y: 77, s: 18 },
  { x: 52, y: 52, s: 14 },
  { x: 60, y: 29, s: 12 },
  { x: 69, y: 66, s: 16 },
  { x: 78, y: 44, s: 13 },
  { x: 41, y: 25, s: 11 },
];

/** 一枝桂花：枝条 + 叶片，花朵由调用方按 spots 摆放。 */
function BranchSvg({ reduced }: { reduced: boolean }): JSX.Element {
  return (
    <svg
      className={['fx-branch__svg', anim(reduced, 'fx-anim-fade')].filter((c) => c.length > 0).join(' ')}
      viewBox="0 0 240 170"
      aria-hidden="true"
      focusable="false"
    >
      <path className="fx-branch__line" d="M14 156 C 62 146, 96 122, 122 88 C 142 62, 166 40, 226 24" />
      <path className="fx-branch__line fx-branch__line--thin" d="M92 122 C 74 104, 62 98, 38 92" />
      <path className="fx-branch__line fx-branch__line--thin" d="M132 78 C 152 70, 168 70, 190 80" />
      <path className="fx-branch__leaf" d="M150 96 C 166 84, 184 82, 200 90 C 186 104, 166 106, 150 96 Z" />
      <path className="fx-branch__leaf" d="M108 140 C 122 128, 140 126, 156 134 C 142 148, 122 150, 108 140 Z" />
      <path className="fx-branch__leaf" d="M74 74 C 82 58, 96 50, 112 52 C 106 70, 92 80, 74 74 Z" />
    </svg>
  );
}

/** 一枝桂花从中心缓缓展开，四瓣小花逐个绽放。 */
export function OsmanthusEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      <div className="fx-branch">
        <BranchSvg reduced={reduced} />

        {OSMANTHUS_SPOTS.map((spot, i) => (
          <span
            key={i}
            className={['fx-bloom', anim(reduced, 'fx-anim-bloom')].filter((c) => c.length > 0).join(' ')}
            style={vars({
              '--fx-x': `${spot.x}%`,
              '--fx-y': `${spot.y}%`,
              '--fx-delay': `${140 + i * 110}ms`,
            })}
          >
            <Flower size={spot.s} style={{ color: palette.glow }} />
          </span>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 二举 —— 双喜临门
 * ------------------------------------------------------------------ */

/** 两盏红灯笼从两侧升起亮起。 */
export function LanternsEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      <Lantern
        className={['fx-lantern--l', anim(reduced, 'fx-anim-lantern')].filter((c) => c.length > 0).join(' ')}
        style={vars({ '--fx-from': 'translate3d(-7vw, 42px, 0)', '--fx-delay': '40ms' })}
      />
      <Lantern
        className={['fx-lantern--r', anim(reduced, 'fx-anim-lantern')].filter((c) => c.length > 0).join(' ')}
        style={vars({ '--fx-from': 'translate3d(7vw, 42px, 0)', '--fx-delay': '200ms' })}
      />
      <Specks count={6} reduced={reduced} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 三红 —— 三元报喜
 * ------------------------------------------------------------------ */

const SEAL_CHARS: readonly string[] = ['福', '禄', '寿'];

/** 三枚朱砂印章依次落下（旋转 -8° + 轻微回弹）+ 红色桂花飞舞。 */
export function SealsEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      <div className="fx-seal-row">
        {SEAL_CHARS.map((text, i) => (
          <span
            key={text}
            className={['fx-seal', anim(reduced, 'fx-anim-stamp')].filter((c) => c.length > 0).join(' ')}
            style={vars({ '--fx-delay': `${i * 160}ms` })}
          >
            {text}
          </span>
        ))}
      </div>
      <Petals count={6} reduced={reduced} tone="red" />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 四进 —— 四方进喜
 * ------------------------------------------------------------------ */

const COIN_SHAPES: ReadonlyArray<{ from: string; to: string }> = [
  { from: 'translate3d(-38vw, -20vh, 0)', to: 'translate3d(-4.4vmin, -4.4vmin, 0)' },
  { from: 'translate3d(38vw, -20vh, 0)', to: 'translate3d(4.4vmin, -4.4vmin, 0)' },
  { from: 'translate3d(-38vw, 20vh, 0)', to: 'translate3d(-4.4vmin, 4.4vmin, 0)' },
  { from: 'translate3d(38vw, 20vh, 0)', to: 'translate3d(4.4vmin, 4.4vmin, 0)' },
];

/** 四枚铜钱从四方汇聚到中心。 */
export function CoinsEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      {COIN_SHAPES.map((coin, i) => (
        <span
          key={i}
          className={['fx-pt', 'fx-coin', anim(reduced, 'fx-anim-slide')]
            .filter((c) => c.length > 0)
            .join(' ')}
          style={vars({
            '--fx-size': 'clamp(38px, 11vw, 54px)',
            '--fx-from': coin.from,
            '--fx-to': coin.to,
            '--fx-delay': `${i * 110}ms`,
          })}
        />
      ))}
      <Specks count={8} reduced={reduced} seed={0.6} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 对堂 —— 六子齐聚
 * ------------------------------------------------------------------ */

const PANEL_ROTS: readonly number[] = [-19, -11, -4, 4, 11, 19];

/** 六扇古典屏风依次打开，1~6 六颗骰子依次亮起，中央升起满月。 */
export function ScreenEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <>
      <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
        <Moon
          className={['fx-moon--rise', anim(reduced, 'fx-anim-moon')].filter((c) => c.length > 0).join(' ')}
          style={vars({ '--fx-size': 'clamp(88px, 27vw, 140px)', '--fx-delay': '100ms' })}
        />
        <div className="fx-screens">
          {PANEL_ROTS.map((rot, i) => (
            <span
              key={i}
              className={['fx-panel', anim(reduced, 'fx-anim-panel')].filter((c) => c.length > 0).join(' ')}
              style={vars({ '--fx-rot': `${rot}deg`, '--fx-delay': `${i * 80}ms` })}
            />
          ))}
        </div>
      </div>
      <div className="fx fx-front">
        <div className="fx-dice-row">
          {[1, 2, 3, 4, 5, 6].map((value, i) => (
            <span
              key={value}
              className={['fx-die-lit', anim(reduced, 'fx-anim-lit')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({ '--fx-delay': `${320 + i * 110}ms` })}
            >
              <FxDie value={value} tone="paper" size={30} />
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 四点红 —— 状元候选（首个 Champion Tier）
 * ------------------------------------------------------------------ */

/** 金榜卷轴快速展开 + 月亮明显变亮。 */
export function ScrollEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      <Moon
        className={['fx-moon--rise', anim(reduced, 'fx-anim-moon')].filter((c) => c.length > 0).join(' ')}
        style={vars({ '--fx-size': 'clamp(104px, 32vw, 160px)', '--fx-delay': '60ms' })}
      />
      <Moon
        className={['fx-moon--halo', anim(reduced, 'fx-anim-glow')]
          .filter((c) => c.length > 0)
          .join(' ')}
        style={vars({ '--fx-size': 'clamp(150px, 46vw, 230px)', '--fx-delay': '220ms' })}
      />
      <Banner
        className={anim(reduced, 'fx-anim-unrollx')}
        style={vars({ '--fx-delay': '140ms', '--fx-dur': '720ms' })}
      />
      <Specks count={8} reduced={reduced} seed={1.2} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 五子登科 —— 五道金色祥云汇聚
 * ------------------------------------------------------------------ */

const CLOUD_SHAPES: ReadonlyArray<{ from: string; to: string; w: string; d: number }> = [
  { from: 'translate3d(-46vw, -18vh, 0)', to: 'translate3d(-13vmin, -9vmin, 0)', w: 'clamp(74px, 22vw, 108px)', d: 0 },
  { from: 'translate3d(46vw, -14vh, 0)', to: 'translate3d(13vmin, -10vmin, 0)', w: 'clamp(64px, 19vw, 94px)', d: 110 },
  { from: 'translate3d(-44vw, 18vh, 0)', to: 'translate3d(-14vmin, 9vmin, 0)', w: 'clamp(68px, 20vw, 98px)', d: 220 },
  { from: 'translate3d(44vw, 16vh, 0)', to: 'translate3d(13vmin, 10vmin, 0)', w: 'clamp(60px, 18vw, 90px)', d: 330 },
  { from: 'translate3d(0, -32vh, 0)', to: 'translate3d(0, 0, 0)', w: 'clamp(84px, 25vw, 124px)', d: 440 },
];

/** 五道金色祥云汇聚。 */
export function CloudsEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
      {CLOUD_SHAPES.map((cloud, i) => (
        <Cloud
          key={i}
          className={['fx-pt', anim(reduced, 'fx-anim-slide')].filter((c) => c.length > 0).join(' ')}
          style={vars({
            '--fx-size': cloud.w,
            '--fx-from': cloud.from,
            '--fx-to': cloud.to,
            '--fx-delay': `${cloud.d}ms`,
          })}
        />
      ))}
      <Specks count={8} reduced={reduced} seed={2.1} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 五红 —— 五红映月
 * ------------------------------------------------------------------ */

/** 五枚朱砂红骰逐一点亮 + 红色花瓣与桂花旋转。 */
export function PetalsEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <>
      <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
        <Petals count={10} reduced={reduced} tone="red" seed={0.4} />
      </div>
      <div className="fx fx-front">
        <div className="fx-dice-row">
          {range(5).map((i) => (
            <span
              key={i}
              className={['fx-die-lit', anim(reduced, 'fx-anim-lit')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({ '--fx-delay': `${140 + i * 130}ms` })}
            >
              <FxDie value={4} tone="red" size={34} />
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 六抔黑 —— 六子同辉
 * ------------------------------------------------------------------ */

/** 水墨突然铺满画面，随后中央破墨，金屑迸出。 */
export function InkEffect({ palette, reduced }: EffectProps): JSX.Element {
  const inkClass = ['fx-ink', anim(reduced, 'fx-anim-ink-flood'), reduced ? 'fx-ink--still' : '']
    .filter((c) => c.length > 0)
    .join(' ');
  return (
    <div className="fx fx-front" style={vars({ '--fx-primary': palette.primary })}>
      <span className={inkClass} style={vars({ '--fx-dir': '-72vw', '--fx-delay': '0ms' })} />
      <span className={inkClass} style={vars({ '--fx-dir': '72vw', '--fx-delay': '60ms' })} />
      <Specks count={12} reduced={reduced} seed={0.9} />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * 遍地锦 —— 遍地生锦
 * ------------------------------------------------------------------ */

/** 金色锦缎从中心铺开 + 大量细小金色桂花。 */
export function BrocadeEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <>
      <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
        <span
          className={['fx-brocade', anim(reduced, 'fx-anim-brocade')]
            .filter((c) => c.length > 0)
            .join(' ')}
          style={vars({ '--fx-delay': '40ms', '--fx-dur': '900ms' })}
        />
      </div>
      <div className="fx fx-front">
        <Specks count={12} reduced={reduced} seed={1.7} />
        <Petals count={8} reduced={reduced} tone="gold" seed={0.2} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 六杯红 —— 六杯齐红
 * ------------------------------------------------------------------ */

/** 六颗「四」依次变成朱砂红 + 红灯笼全部亮起 + 满月升起 + 金榜展开。 */
export function SixRedEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <>
      <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
        <Moon
          className={['fx-moon--rise', anim(reduced, 'fx-anim-moon')].filter((c) => c.length > 0).join(' ')}
          style={vars({ '--fx-size': 'clamp(92px, 28vw, 146px)', '--fx-delay': '80ms' })}
        />
        <div className="fx-lantern-row">
          {range(4).map((i) => (
            <Lantern
              key={i}
              className={['fx-lantern--sm', anim(reduced, 'fx-anim-lantern')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({ '--fx-from': 'translate3d(0, 34px, 0)', '--fx-delay': `${i * 110}ms` })}
            />
          ))}
        </div>
        <Banner
          className={anim(reduced, 'fx-anim-unrollx')}
          style={vars({ '--fx-delay': '260ms', '--fx-dur': '760ms' })}
        />
      </div>
      <div className="fx fx-front">
        <div className="fx-dice-row">
          {range(6).map((i) => (
            <span
              key={i}
              className={['fx-die-lit', anim(reduced, 'fx-anim-lit')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({ '--fx-delay': `${i * 120}ms` })}
            >
              <DieSwap value={4} delay={120 + i * 120} size={32} reduced={reduced} />
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 状元插金花 —— 必须最华丽
 * ------------------------------------------------------------------ */

const GRAND_DICE: readonly number[] = [4, 4, 4, 4, 1, 1];

/**
 * 状元插金花：屏幕略暗 → 圆月变亮 → 两侧桂花盛开 → 四红四 + 两一点定格
 * → 金色祥云汇聚 → 巨大金榜展开 → 朱砂「状元」印章落下 → 花瓣与金屑纷飞。
 * 全序列在 2.6 秒内跑完。
 */
export function GrandEffect({ palette, reduced }: EffectProps): JSX.Element {
  return (
    <>
      <div className="fx fx-back" style={vars({ '--fx-primary': palette.primary })}>
        <span
          className={['fx-dim', anim(reduced, 'fx-anim-dim')].filter((c) => c.length > 0).join(' ')}
          style={vars({ '--fx-delay': '0ms', '--fx-dur': '420ms' })}
        />
        <Moon
          className={['fx-moon--grand', anim(reduced, 'fx-anim-moon')]
            .filter((c) => c.length > 0)
            .join(' ')}
          style={vars({ '--fx-size': 'clamp(120px, 36vw, 186px)', '--fx-delay': '140ms' })}
        />
        <div className="fx-branch fx-branch--l">
          <BranchSvg reduced={reduced} />
          {OSMANTHUS_SPOTS.slice(0, 5).map((spot, i) => (
            <span
              key={i}
              className={['fx-bloom', anim(reduced, 'fx-anim-bloom')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({
                '--fx-x': `${spot.x}%`,
                '--fx-y': `${spot.y}%`,
                '--fx-delay': `${280 + i * 90}ms`,
              })}
            >
              <Flower size={spot.s} style={{ color: palette.glow }} />
            </span>
          ))}
        </div>
        <div className="fx-branch fx-branch--r">
          <BranchSvg reduced={reduced} />
          {OSMANTHUS_SPOTS.slice(3).map((spot, i) => (
            <span
              key={i}
              className={['fx-bloom', anim(reduced, 'fx-anim-bloom')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({
                '--fx-x': `${spot.x}%`,
                '--fx-y': `${spot.y}%`,
                '--fx-delay': `${340 + i * 90}ms`,
              })}
            >
              <Flower size={spot.s} style={{ color: palette.glow }} />
            </span>
          ))}
        </div>
        {CLOUD_SHAPES.slice(0, 5).map((cloud, i) => (
          <Cloud
            key={i}
            className={['fx-pt', anim(reduced, 'fx-anim-slide')].filter((c) => c.length > 0).join(' ')}
            style={vars({
              '--fx-size': cloud.w,
              '--fx-from': cloud.from,
              '--fx-to': cloud.to,
              '--fx-delay': `${520 + i * 70}ms`,
            })}
          />
        ))}
        <Banner
          className={['fx-banner--grand', anim(reduced, 'fx-anim-unrollx')]
            .filter((c) => c.length > 0)
            .join(' ')}
          style={vars({ '--fx-delay': '780ms', '--fx-dur': '620ms' })}
        />
      </div>

      <div className="fx fx-front" style={vars({ '--fx-primary': palette.primary })}>
        <div className="fx-dice-row fx-dice-row--grand">
          {GRAND_DICE.map((value, i) => (
            <span
              key={i}
              className={['fx-die-lit', anim(reduced, 'fx-anim-lit')]
                .filter((c) => c.length > 0)
                .join(' ')}
              style={vars({ '--fx-delay': `${460 + i * 80}ms` })}
            >
              <FxDie value={value} tone={value === 4 ? 'red' : 'ink'} size={34} />
            </span>
          ))}
        </div>
        <span
          className={['fx-grand-seal', anim(reduced, 'fx-anim-grand-seal')]
            .filter((c) => c.length > 0)
            .join(' ')}
          style={vars({ '--fx-delay': '1420ms' })}
        >
          状元
        </span>
        <Petals count={10} reduced={reduced} tone="red" seed={0.3} />
        <Specks count={12} reduced={reduced} seed={2.4} />
      </div>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * 分派
 * ------------------------------------------------------------------ */

/** 按 AwardDefinition.effect 分派；未知 effect 回落到淡墨涟漪。 */
export function EffectLayer({ effect, palette, reduced }: EffectProps & { effect: string }): JSX.Element {
  switch (effect) {
    case 'osmanthus':
      return <OsmanthusEffect palette={palette} reduced={reduced} />;
    case 'lanterns':
      return <LanternsEffect palette={palette} reduced={reduced} />;
    case 'seals':
      return <SealsEffect palette={palette} reduced={reduced} />;
    case 'coins':
      return <CoinsEffect palette={palette} reduced={reduced} />;
    case 'screen':
      return <ScreenEffect palette={palette} reduced={reduced} />;
    case 'scroll':
      return <ScrollEffect palette={palette} reduced={reduced} />;
    case 'clouds':
      return <CloudsEffect palette={palette} reduced={reduced} />;
    case 'petals':
      return <PetalsEffect palette={palette} reduced={reduced} />;
    case 'ink':
      return <InkEffect palette={palette} reduced={reduced} />;
    case 'brocade':
      return <BrocadeEffect palette={palette} reduced={reduced} />;
    case 'six-red':
      return <SixRedEffect palette={palette} reduced={reduced} />;
    case 'grand':
      return <GrandEffect palette={palette} reduced={reduced} />;
    case 'none':
    default:
      return <NoneEffect palette={palette} reduced={reduced} />;
  }
}
