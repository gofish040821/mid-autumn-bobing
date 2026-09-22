/**
 * Background —— 固定全屏的装饰层。
 *
 * 整层都是「画」：宣纸窗棂、淡墨远山、右上满月、如意祥云、朱砂灯笼、飘落桂花。
 * 全部用 CSS 与内联 SVG 绘制，不引用任何外部图片 / 字体 / CDN。
 *
 * 设计约束：
 * - position: fixed; inset: 0; z-index: 0; pointer-events: none，永远不吃点击；
 * - 动画只用 transform / opacity，无 JS 定时器；
 * - 元素总数控制在 40 个以内，尺寸用 vw / vmin / clamp，375px 下不产生横向滚动；
 * - prefers-reduced-motion 下全部动画停止（见 Background.css 末尾）。
 */
import './Background.css';

/** 一朵桂花 */
interface Petal {
  /** 水平位置，百分比 */
  left: number;
  /** 飘落周期，秒 */
  duration: number;
  /** 负延时，让花瓣一开始就散布在途中 */
  delay: number;
  /** 相对大小 */
  scale: 'sm' | 'md';
  /** 透明度 */
  opacity: number;
}

/** 8 片桂花，错落分布，避免集中在中间遮挡正文 */
const PETALS: readonly Petal[] = [
  { left: 6, duration: 22, delay: -2, scale: 'md', opacity: 0.5 },
  { left: 15, duration: 28, delay: -11, scale: 'sm', opacity: 0.42 },
  { left: 3, duration: 19, delay: -16, scale: 'sm', opacity: 0.38 },
  { left: 27, duration: 26, delay: -6, scale: 'sm', opacity: 0.36 },
  { left: 88, duration: 24, delay: -19, scale: 'md', opacity: 0.5 },
  { left: 95, duration: 30, delay: -8, scale: 'sm', opacity: 0.4 },
  { left: 72, duration: 21, delay: -14, scale: 'sm', opacity: 0.35 },
  { left: 58, duration: 27, delay: -23, scale: 'md', opacity: 0.45 },
];

/** 一片四瓣桂花：四个椭圆花瓣共用一条 path，一个 svg 只有 1 个节点 */
const PETAL_PATH =
  'M0 0a3.4 5 0 1 1 0 -10a3.4 5 0 1 1 0 10Z' +
  'M0 0a5 3.4 0 1 1 10 0a5 3.4 0 1 1 -10 0Z' +
  'M0 0a3.4 5 0 1 1 0 10a3.4 5 0 1 1 0 -10Z' +
  'M0 0a5 3.4 0 1 1 -10 0a5 3.4 0 1 1 10 0Z';

/**
 * 一朵如意祥云：云身一条 path（圆浑的云头 + 平底），左右各一条线描云钩。
 * 三个节点画完一整朵云。
 */
function RuyiCloud({ className }: { className: string }): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 220 96"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        className="scenery__cloud-body"
        d="M34 80L186 80A11 11 0 0 0 186 58A26 26 0 0 0 150 30A30 30 0 0 0 100 20A26 26 0 0 0 56 34A18 18 0 0 0 34 58A11 11 0 0 0 34 80Z"
      />
      <path
        className="scenery__cloud-curl"
        d="M38 74c-13 0-21-8-21-18c0-10 8-16 17-16c6 0 11 4 11 10c0 5-4 8-8 8c-3 0-6-2-6-5"
      />
      <path
        className="scenery__cloud-curl"
        d="M182 74c13 0 21-8 21-18c0-10-8-16-17-16c-6 0-11 4-11 10c0 5 4 8 8 8c3 0 6-2 6-5"
      />
    </svg>
  );
}

export default function Background(): JSX.Element {
  return (
    <div className="scenery" aria-hidden="true">
      {/* 古典窗棂：四角与边缘的极淡格子，中间镂空不挡正文 */}
      <div className="scenery__lattice" />

      {/* 右上角满月：奶白到淡金，几层柔光，非常淡 */}
      <div className="scenery__moon" />

      {/* 祥云：缓缓横向漂移 */}
      <RuyiCloud className="scenery__cloud scenery__cloud--a" />
      <RuyiCloud className="scenery__cloud scenery__cloud--b" />
      <RuyiCloud className="scenery__cloud scenery__cloud--c" />

      {/* 灯笼：左上、右中偏上，极轻摇摆 */}
      <div className="scenery__lantern scenery__lantern--left">
        <span className="scenery__lantern-cord" />
        <span className="scenery__lantern-body" />
        <span className="scenery__lantern-tassel" />
      </div>
      <div className="scenery__lantern scenery__lantern--right">
        <span className="scenery__lantern-cord" />
        <span className="scenery__lantern-body" />
        <span className="scenery__lantern-tassel" />
      </div>

      {/* 桂花飘落 */}
      {PETALS.map((petal, index) => (
        <svg
          key={`petal-${index}`}
          className={`scenery__osmanthus scenery__osmanthus--${petal.scale}`}
          viewBox="-11 -11 22 22"
          aria-hidden="true"
          focusable="false"
          style={{
            left: `${petal.left}%`,
            opacity: petal.opacity,
            animationDelay: `${petal.delay}s`,
            animationDuration: `${petal.duration}s`,
          }}
        >
          <path d={PETAL_PATH} />
        </svg>
      ))}

      {/* 远景淡墨山水：两层剪影，一远一近，远山带水墨晕染 */}
      <svg
        className="scenery__hills"
        viewBox="0 0 1440 320"
        preserveAspectRatio="none"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <filter id="scenery-ink-blur" x="-8%" y="-40%" width="116%" height="200%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
        </defs>
        <path
          className="scenery__hills-far"
          filter="url(#scenery-ink-blur)"
          d="M0 236Q74 168 148 208Q208 240 268 186Q330 130 400 190Q458 240 524 198Q592 146 664 202Q730 254 800 208Q862 166 930 212Q1000 258 1070 212Q1132 170 1200 210Q1268 250 1338 208Q1394 172 1440 206L1440 320L0 320Z"
        />
        <path
          className="scenery__hills-near"
          d="M0 278Q92 222 184 252Q272 282 360 244Q444 208 528 246Q612 284 700 250Q786 218 866 254Q944 288 1032 254Q1114 222 1194 256Q1274 288 1352 258Q1404 240 1440 262L1440 320L0 320Z"
        />
      </svg>
    </div>
  );
}
