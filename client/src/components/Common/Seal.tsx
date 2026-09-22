/**
 * Seal —— 朱砂印章。
 *
 * 方正圆角、朱砂描边、内部楷体朱砂字，整体微微倾斜 -3°，
 * 表面叠一层极淡的 radial-gradient 噪点做「斑驳石材」质感。
 *
 * 排版规则：
 *   1 字 → 单字居中（最大字号）
 *   2 字 → 竖排两行
 *   3 字 → 竖排三行
 *   4 字 → 两行两列（田字格）
 *   >4 字 → 单行横排，字号按字数自动收缩，绝不溢出
 */
import './Common.css';

export type SealSize = 'sm' | 'md' | 'lg';
export type SealTone = 'cinnabar' | 'gold';

export interface SealProps {
  /** 印章正文，2~4 字最佳 */
  text: string;
  /** 印章下方的小字（如「中秋」「博饼」） */
  sub?: string;
  size?: SealSize;
  tone?: SealTone;
  className?: string;
}

/** 三档基准边长（px）：sm 34 / md 52 / lg 76 */
const SIZE_PX: Record<SealSize, number> = { sm: 34, md: 52, lg: 76 };

type SealLayout = 'single' | 'column' | 'grid';

interface SealMetrics {
  layout: SealLayout;
  fontPx: number;
}

/** 按字数选排版方式与字号，保证任何字数都不会撑破印章。 */
function metricsFor(count: number, base: number): SealMetrics {
  if (count <= 1) return { layout: 'single', fontPx: Math.round(base * 0.54) };
  if (count === 2) return { layout: 'column', fontPx: Math.round(base * 0.34) };
  if (count === 3) return { layout: 'column', fontPx: Math.round(base * 0.28) };
  if (count === 4) return { layout: 'grid', fontPx: Math.round(base * 0.29) };
  // 五字以上：单行横排，字号随字数收缩（下限 9px，配合上限兼顾可读性）
  const shrunk = Math.round((base * 1.5) / count);
  return { layout: 'single', fontPx: Math.max(9, Math.min(Math.round(base * 0.22), shrunk)) };
}

/** 按码点拆字，去掉空白（印章里不留空格）。 */
function splitChars(text: string): string[] {
  return Array.from(text).filter((ch) => !/\s/.test(ch));
}

export default function Seal({
  text,
  sub,
  size = 'md',
  tone = 'cinnabar',
  className,
}: SealProps): JSX.Element {
  const base = SIZE_PX[size];
  const chars = splitChars(text);
  const { layout, fontPx } = metricsFor(chars.length, base);
  const subText = (sub ?? '').trim();

  const classes = [
    'seal',
    size === 'sm' ? 'seal--sm' : '',
    `common-seal--${size}`,
    tone === 'gold' ? 'seal--gold common-seal--gold' : 'common-seal--cinnabar',
    'common-seal',
    className ?? '',
  ]
    .filter((c) => c.length > 0)
    .join(' ');

  return (
    <span
      className={classes}
      title={subText ? `${text} · ${subText}` : text}
      style={{
        minWidth: base,
        minHeight: base,
        fontSize: fontPx,
        padding: Math.max(3, Math.round(base * 0.09)),
      }}
    >
      <span className={`common-seal__body common-seal__body--${layout}`}>
        {layout === 'single' ? (
          <span className="common-seal__line">{chars.join('')}</span>
        ) : (
          chars.map((ch, i) => (
            <span className="common-seal__char" key={`${ch}-${i}`}>
              {ch}
            </span>
          ))
        )}
      </span>

      {subText ? (
        <span
          className="common-seal__sub"
          style={{ fontSize: Math.max(9, Math.round(fontPx * 0.46)) }}
        >
          {subText}
        </span>
      ) : null}

      <span className="common-seal__grain" aria-hidden="true" />
    </span>
  );
}
