/**
 * TopBar —— 页面顶部的工具条。
 *
 * 左侧标题（楷体），右侧「规则」「音效」两个按钮。
 * sticky 吸顶、半透明宣纸底 + 毛玻璃，底部一条极淡金线。
 * 375px 宽度下标题不换行、不溢出，按钮可点区域 >= 44px。
 */
import './Common.css';

import { useGameStore } from '../../stores/gameStore';

export interface TopBarProps {
  /** 左侧标题，默认「月满中秋 · 博饼」 */
  title?: string;
  /** 是否显示标题下方的副标题「六骰听月落，一桌争状元」 */
  showSubtitle?: boolean;
}

/** 极简卷轴图标（内联 SVG，不依赖任何外部资源）。 */
function ScrollIcon(): JSX.Element {
  return (
    <svg
      className="common-topbar__icon"
      viewBox="0 0 16 16"
      width="15"
      height="15"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="2.6"
        y="3.2"
        width="10.8"
        height="9.6"
        rx="1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <path
        d="M5.2 6.3h5.6M5.2 8.6h5.6M5.2 10.9h3.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function TopBar({
  title = '月满中秋 · 博饼',
  showSubtitle = false,
}: TopBarProps): JSX.Element {
  const openRules = useGameStore((s) => s.openRules);
  const audioEnabled = useGameStore((s) => s.audioEnabled);
  const setAudioEnabled = useGameStore((s) => s.setAudioEnabled);
  const ruleOpen = useGameStore((s) => s.ruleOpen);

  return (
    <header className="common-topbar">
      <div className="common-topbar__inner">
        <div className="common-topbar__titles">
          <h1 className="common-topbar__title t-kai" title={title}>
            {title}
          </h1>
          {showSubtitle ? (
            <p className="common-topbar__sub t-fang">六骰听月落，一桌争状元</p>
          ) : null}
        </div>

        <div className="common-topbar__actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost common-topbar__btn"
            onClick={openRules}
            aria-label="查看博饼规则"
            aria-pressed={ruleOpen}
            aria-haspopup="dialog"
            aria-expanded={ruleOpen}
          >
            <ScrollIcon />
            <span>规则</span>
          </button>

          <button
            type="button"
            className={`btn btn--sm common-topbar__btn common-topbar__btn--audio ${
              audioEnabled ? 'btn--gold' : 'btn--ghost'
            }`}
            onClick={() => setAudioEnabled(!audioEnabled)}
            aria-label={audioEnabled ? '关闭音效' : '开启音效'}
            aria-pressed={audioEnabled}
          >
            <span className="common-topbar__emoji" aria-hidden="true">
              {audioEnabled ? '🔊' : '🔇'}
            </span>
            <span>{audioEnabled ? '音效' : '静音'}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
