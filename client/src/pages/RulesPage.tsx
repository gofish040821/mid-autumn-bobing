/**
 * RulesPage —— 第一次打开网页时的落地页。
 *
 * 只做三件事：说清「博饼是什么」、给出三个步骤、把人送进大厅。
 * 页面本身不渲染 TopBar（App 已统一处理顶部浮层与路由）。
 */
import { motion } from 'framer-motion';
import type { Variants } from 'framer-motion';

import { useGameStore } from '../stores/gameStore';
import SiteFooter from '../components/Common/SiteFooter';
import './RulesPage.css';

/** 与 theme.css 的 --ease-soft 保持一致的缓动曲线。 */
const EASE: [number, number, number, number] = [0.22, 0.61, 0.36, 1];

interface Step {
  key: string;
  ordinal: string;
  title: string;
  desc: string;
  Icon: () => JSX.Element;
}

/* ------------------------------------------------------------------ *
 * 自绘小图标（全部内联 SVG，不引用任何外部资源）
 * ------------------------------------------------------------------ */

/** 一轮满月，压着两缕云。 */
function MoonIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="rules-moon-g" cx="36%" cy="30%" r="76%">
          <stop offset="0%" stopColor="#FBF2D2" />
          <stop offset="58%" stopColor="#EFD79B" />
          <stop offset="100%" stopColor="#CBA765" />
        </radialGradient>
      </defs>
      <circle cx="32" cy="27" r="16.5" fill="url(#rules-moon-g)" stroke="#B18A55" strokeWidth="1.3" />
      <circle cx="26" cy="21.5" r="3.4" fill="#E3CB92" opacity="0.85" />
      <circle cx="37.5" cy="31.5" r="2.4" fill="#E3CB92" opacity="0.7" />
      <circle cx="29.5" cy="35" r="1.7" fill="#E3CB92" opacity="0.62" />
      <path
        d="M5 48c6-4 10 0 15-1s8-5 14-3 8 4 14 2"
        fill="none"
        stroke="#8A8578"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.72"
      />
      <path
        d="M11 55c5-3 9 .5 14-.5s7-4 12-2.5"
        fill="none"
        stroke="#8A8578"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.46"
      />
    </svg>
  );
}

/** 一颗骰子，三点朝上。 */
function DiceIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="11" y="13" width="42" height="42" rx="10" fill="#FDF8EA" stroke="#8D6A3C" strokeWidth="1.7" />
      <rect
        x="16.5"
        y="18.5"
        width="31"
        height="31"
        rx="6.5"
        fill="none"
        stroke="#B18A55"
        strokeWidth="1"
        opacity="0.65"
      />
      <circle cx="23" cy="25" r="3.3" fill="#A33A2B" />
      <circle cx="32" cy="34" r="3.3" fill="#A33A2B" />
      <circle cx="41" cy="43" r="3.3" fill="#A33A2B" />
      <path
        d="M8 51c6 3 12-3 18-1.5"
        fill="none"
        stroke="#8A8578"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

/** 一轴摊开的卷轴。 */
function ScrollIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect x="15" y="11" width="34" height="42" rx="3" fill="#FBF5E4" stroke="#B18A55" strokeWidth="1.4" />
      <path
        d="M23 21h18M23 29h18M23 37h12"
        fill="none"
        stroke="#8A8578"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.7"
      />
      <rect x="6" y="8" width="11" height="48" rx="5.5" fill="#D8B878" stroke="#8D6A3C" strokeWidth="1.3" />
      <rect x="47" y="8" width="11" height="48" rx="5.5" fill="#D8B878" stroke="#8D6A3C" strokeWidth="1.3" />
    </svg>
  );
}

const STEPS: readonly Step[] = [
  {
    key: 'join',
    ordinal: '一',
    title: '匿名进入同一桌',
    desc: '无需注册，取个雅号就能和朋友们坐进同一张圆桌。',
    Icon: MoonIcon,
  },
  {
    key: 'turn',
    ordinal: '二',
    title: '按座位轮流博饼',
    desc: '从一号座位起，依次掷出六颗骰子，人人有份。',
    Icon: DiceIcon,
  },
  {
    key: 'award',
    ordinal: '三',
    title: '依骰子组合得奖',
    desc: '一秀到状元各有其名，凑齐一套还有额外彩头。',
    Icon: ScrollIcon,
  },
];

const container: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.13, delayChildren: 0.12 },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.44, ease: EASE } },
};

export default function RulesPage(): JSX.Element {
  const setRulesSeen = useGameStore((s) => s.setRulesSeen);
  const openRules = useGameStore((s) => s.openRules);

  return (
    <motion.div
      className="page rules-page"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      <header className="rules-head">
        <span className="rules-head__moon" aria-hidden="true">
          <MoonIcon />
        </span>
        <h1 className="t-title rules-head__title">月满中秋 · 博饼</h1>
        <p className="t-sub rules-head__sub">六骰听月落，一桌争状元</p>
        <hr className="hairline rules-head__rule" />
        <p className="rules-intro">
          博饼是中秋传统民俗游戏，大家轮流掷六颗骰子，根据骰子组合获得不同奖项。
        </p>
      </header>

      <motion.ul className="rules-steps" variants={container} initial="hidden" animate="show">
        {STEPS.map((step) => (
          <motion.li className="rules-step" key={step.key} variants={item}>
            <span className="rules-step__icon" aria-hidden="true">
              <step.Icon />
            </span>
            <div className="rules-step__body">
              <span className="rules-step__ordinal t-kai">{step.ordinal}</span>
              <h2 className="rules-step__title t-kai">{step.title}</h2>
              <p className="rules-step__desc">{step.desc}</p>
            </div>
          </motion.li>
        ))}
      </motion.ul>

      <div className="rules-actions">
        <button
          type="button"
          className="btn btn--primary btn--block rules-actions__main"
          onClick={setRulesSeen}
        >
          我已了解，开始博饼
        </button>
        <div className="rules-actions__row">
          <button type="button" className="btn btn--ghost" onClick={setRulesSeen}>
            跳过
          </button>
          <button type="button" className="btn btn--ghost" onClick={openRules}>
            查看完整规则
          </button>
        </div>
      </div>

      <p className="rules-foot">本桌最多十五人 · 一局约十到十五分钟 · 匿名参与，无需注册</p>

      <SiteFooter />
    </motion.div>
  );
}
