/**
 * RuleModal —— 「博饼规则」卷轴弹窗。
 *
 * 展开方式：上下两根木轴 + 中间宣纸卷面，整卷从中间向上下展开（scaleY 0 → 1）。
 * 内容全部来自 @bobing/shared 的 AWARDS，规则文案与库存公式跟服务端同一份真相，
 * 不会出现「说明和实际算法不一致」的情况。
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AWARDS, PRIZE_KEYS, PRIZE_NAMES } from '@bobing/shared';
import type { AwardDefinition, PrizeKey } from '@bobing/shared';
import { useGameStore } from '../../stores/gameStore';
import './RuleModal.css';

/** 名次序号（1 起）→ 中文数字，用于左侧圆牌。 */
const CN_ORDINALS: readonly string[] = [
  '',
  '一',
  '二',
  '三',
  '四',
  '五',
  '六',
  '七',
  '八',
  '九',
  '十',
  '十一',
  '十二',
];

/** 对堂的「一点到六点各一颗」示意。 */
const DICE_FACES: readonly string[] = ['一', '二', '三', '四', '五', '六'];

/** 奖品数量公式：与 server/src/config/prizes.ts 保持一致。 */
const PRIZE_FORMULAS: Record<PrizeKey, string> = {
  ONE_SHOW: '4 × 人数',
  TWO_LIFT: '2 × 人数',
  THREE_RED: '人数',
  FOUR_ADVANCE: '⌈人数 ÷ 2⌉',
  DUITANG: 'max(1, ⌈人数 ÷ 5⌉)',
  CHAMPION: '1',
};

/** 入门三步。 */
const STEPS: readonly string[] = [
  '匿名进入同一桌',
  '按座位轮流博饼',
  '根据六颗骰子的组合获得奖项',
];

interface AwardRowProps {
  award: AwardDefinition;
  /** 名次序号（= award.order） */
  ordinal: number;
}

function AwardRow({ award, ordinal }: AwardRowProps): JSX.Element {
  const isChampion = award.tier === 'CHAMPION';
  const isNone = award.tier === 'NONE';

  return (
    <li
      className={
        'rulemodal__row' +
        (isChampion ? ' rulemodal__row--champion' : '') +
        (isNone ? ' rulemodal__row--none' : '')
      }
    >
      <span
        className={
          'rulemodal__disc t-nums' +
          (isChampion ? ' rulemodal__disc--champion' : '') +
          (isNone ? ' rulemodal__disc--none' : '')
        }
        aria-hidden="true"
      >
        {isNone ? '—' : (CN_ORDINALS[ordinal] ?? String(ordinal))}
      </span>

      <span className="rulemodal__col">
        <span className="rulemodal__name-row">
          <span className="rulemodal__name">{award.name}</span>
          {isChampion && <span className="rulemodal__tag">状元候选</span>}
        </span>
        <span className="rulemodal__rule">{award.rule}</span>
        {award.id === 'DUITANG' && (
          <span className="rulemodal__dice" aria-label="一点到六点各一颗">
            {DICE_FACES.map((face) => (
              <span key={face} className="rulemodal__die" aria-hidden="true">
                {face}
              </span>
            ))}
          </span>
        )}
      </span>

      <span className={'rulemodal__score t-nums' + (isChampion ? ' rulemodal__score--gold' : '')}>
        {award.score > 0 ? `+${award.score} 分` : '0 分'}
      </span>
    </li>
  );
}

export default function RuleModal(): JSX.Element {
  const ruleOpen = useGameStore((s) => s.ruleOpen);
  const closeRules = useGameStore((s) => s.closeRules);
  const reducedMotion = useGameStore((s) => s.reducedMotion);
  const playerCount = useGameStore((s) => s.snapshot?.players.length ?? null);

  /* 打开时锁住 body 滚动，关闭 / 卸载时还原 */
  useEffect(() => {
    if (!ruleOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [ruleOpen]);

  /* Esc 关闭 */
  useEffect(() => {
    if (!ruleOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') closeRules();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [ruleOpen, closeRules]);

  const championAwards = AWARDS.filter((a) => a.tier === 'CHAMPION');
  const normalAwards = AWARDS.filter((a) => a.tier === 'NORMAL');
  const noneAwards = AWARDS.filter((a) => a.tier === 'NONE');

  const unrollMs = reducedMotion ? 0.01 : 0.45;
  const fadeDelay = reducedMotion ? 0 : 0.22;

  return (
    <AnimatePresence>
      {ruleOpen && (
        <motion.div
          className="rulemodal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0.01 : 0.22 }}
        >
          {/* 遮罩：点击空白处关闭 */}
          <div className="rulemodal__veil" onClick={closeRules} aria-hidden="true" />

          <div className="rulemodal__stage">
            <motion.button
              type="button"
              className="rulemodal__close"
              onClick={closeRules}
              aria-label="关闭规则"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0.01 : 0.26, delay: fadeDelay + 0.16 }}
            >
              ×
            </motion.button>

            <motion.div
              className="rulemodal__scroll"
              role="dialog"
              aria-modal="true"
              aria-labelledby="rule-modal-title"
              initial={{ scaleY: 0, opacity: 0.3 }}
              animate={{ scaleY: 1, opacity: 1 }}
              exit={{ scaleY: 0, opacity: 0 }}
              transition={{ duration: unrollMs, ease: [0.34, 1.26, 0.64, 1] }}
            >
              <div className="rulemodal__rod rulemodal__rod--top" aria-hidden="true" />

              <div className="rulemodal__paper">
                <motion.div
                  className="rulemodal__fade"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reducedMotion ? 0.01 : 0.3, delay: fadeDelay }}
                >
                  <div className="rulemodal__body scroll-y">
                    <div className="rulemodal__head">
                      <h2 className="rulemodal__title" id="rule-modal-title">
                        博饼规则
                      </h2>
                      <p className="rulemodal__subtitle">月满中秋 · 文人雅集</p>
                    </div>

                    <p className="rulemodal__text">
                      博饼是中秋传统民俗游戏，大家轮流掷六颗骰子，根据骰子组合获得不同奖项。
                    </p>

                    <section className="rulemodal__section">
                      <h3 className="section-label">入门三步</h3>
                      <ol className="rulemodal__steps">
                        {STEPS.map((step, index) => (
                          <li className="rulemodal__step" key={step}>
                            <span className="rulemodal__step-num" aria-hidden="true">
                              {index + 1}
                            </span>
                            <span className="rulemodal__step-text">{step}</span>
                          </li>
                        ))}
                      </ol>
                    </section>

                    <section className="rulemodal__section">
                      <h3 className="section-label">奖项一览</h3>

                      <p className="rulemodal__group">状元档 · 第 1 ~ 7 档（金色圆牌）</p>
                      <ul className="rulemodal__list">
                        {championAwards.map((award) => (
                          <AwardRow key={award.id} award={award} ordinal={award.order} />
                        ))}
                      </ul>
                      <p className="rulemodal__note rulemodal__note--gold">
                        这七档共用一个「状元」奖品，最终只有一个状元。
                      </p>

                      <p className="rulemodal__group">其余奖项 · 第 8 ~ 12 档</p>
                      <ul className="rulemodal__list">
                        {normalAwards.map((award) => (
                          <AwardRow key={award.id} award={award} ordinal={award.order} />
                        ))}
                        {noneAwards.map((award) => (
                          <AwardRow key={award.id} award={award} ordinal={award.order} />
                        ))}
                      </ul>
                    </section>

                    <section className="rulemodal__section">
                      <h3 className="section-label">奖品数量</h3>
                      <ul className="rulemodal__prizes">
                        {PRIZE_KEYS.map((key) => (
                          <li
                            className={
                              'rulemodal__prize' +
                              (key === 'CHAMPION' ? ' rulemodal__prize--champion' : '')
                            }
                            key={key}
                          >
                            <span className="rulemodal__prize-name">{PRIZE_NAMES[key]}</span>
                            <span className="rulemodal__prize-count t-nums">
                              = {PRIZE_FORMULAS[key]}
                            </span>
                          </li>
                        ))}
                      </ul>
                      <p className="rulemodal__note">
                        库存按人数 N 计算{playerCount !== null ? `（当前 N = ${playerCount} 人）` : ''}
                        。库存领完不补；同一等级再次博出时只显示骰型，不再发奖、不加分。
                      </p>
                    </section>

                    <section className="rulemodal__block">
                      <h3 className="rulemodal__block-title">月华加持</h3>
                      <p className="rulemodal__text rulemodal__text--tight">
                        为控制单局时长，本游戏设有「月华加持」机制：首位状元出现之前，月华会随着桌上一次次掷骰慢慢蓄满，
                        出状元的机会也随之渐近，因此不必担心久等不来。第一轮完全按正常六面骰随机，月华不起作用；
                        第二轮之后月华才开始加持，且追状元阶段不再干预。
                      </p>
                      <p className="rulemodal__note">
                        月华只在场上以月相示意，不显示具体数字——愿者自至，不必掐算。
                      </p>
                    </section>

                    <section className="rulemodal__block rulemodal__block--dai">
                      <h3 className="rulemodal__block-title rulemodal__block-title--dai">追状元</h3>
                      <p className="rulemodal__text rulemodal__text--tight">
                        首位状元出现后，其余每位玩家按座位顺序各追加一次；出现更高等级的状元候选可以反超，同等级先出现者优先；只追一圈，不延长。
                      </p>
                    </section>

                    <p className="rulemodal__foot-note">骰子由服务端权威掷出，客户端只负责演出。</p>
                  </div>

                  <div className="rulemodal__footer">
                    <button
                      type="button"
                      className="btn btn--primary btn--block"
                      onClick={closeRules}
                    >
                      知道了
                    </button>
                  </div>
                </motion.div>
              </div>

              <div className="rulemodal__rod rulemodal__rod--bottom" aria-hidden="true" />
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
