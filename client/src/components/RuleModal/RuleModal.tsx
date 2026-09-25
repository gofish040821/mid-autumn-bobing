/**
 * RuleModal —— 「博饼规则」卷轴弹窗。
 *
 * 展开方式：上下两根木轴 + 中间宣纸卷面，整卷从中间向上下展开（scaleY 0 → 1）。
 * 内容全部来自 @bobing/shared 的 AWARDS，奖品份数直接读服务端下发的开局库存，
 * 不会出现「说明和实际算法不一致」的情况。
 */
import { useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AWARDS, PRIZE_KEYS, PRIZE_NAMES } from '@bobing/shared';
import type { AwardDefinition, InventoryState, PrizeKey } from '@bobing/shared';
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

/**
 * 一桌饼的份数。
 *
 * 份数**不在这里写死**，而是直接读服务端下发的开局库存
 * （`snapshot.inventory.initial`）—— 说明和实际发牌不可能再对不上。
 * 开局前库存全是 0，此时返回 null，界面只显示奖品名、不显示份数。
 */
function prizeCount(initial: InventoryState | null, key: PrizeKey): string | null {
  const n = initial?.counts[key] ?? 0;
  return n > 0 ? `${n} 份` : null;
}

/**
 * 某奖项在本桌的积分。开房配置没下发（快照未就绪）时回落到判奖表默认值。
 * 状元档的 prizeKey 是 CHAMPION，NONE 没有 prizeKey。
 */
function scoreOf(
  award: AwardDefinition,
  prizeScores: Record<PrizeKey, number> | null,
): number {
  const key = award.prizeKey;
  if (!key) return 0;
  return prizeScores?.[key] ?? award.score;
}

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
  /** 本桌实际积分（来自开房配置），NONE 为 0 */
  score: number;
}

function AwardRow({ award, ordinal, score }: AwardRowProps): JSX.Element {
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
        {score > 0 ? `+${score} 分` : '0 分'}
      </span>
    </li>
  );
}

export default function RuleModal(): JSX.Element {
  const ruleOpen = useGameStore((s) => s.ruleOpen);
  const closeRules = useGameStore((s) => s.closeRules);
  const reducedMotion = useGameStore((s) => s.reducedMotion);
  const inventory = useGameStore((s) => s.snapshot?.inventory ?? null);
  const prizeScores = useGameStore((s) => s.snapshot?.prizeScores ?? null);

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
                          <AwardRow
                            key={award.id}
                            award={award}
                            ordinal={award.order}
                            score={scoreOf(award, prizeScores)}
                          />
                        ))}
                      </ul>
                      <p className="rulemodal__note rulemodal__note--gold">
                        这七档共用一个「状元」奖品，最终只有一个状元。
                      </p>

                      <p className="rulemodal__group">其余奖项 · 第 8 ~ 12 档</p>
                      <ul className="rulemodal__list">
                        {normalAwards.map((award) => (
                          <AwardRow
                            key={award.id}
                            award={award}
                            ordinal={award.order}
                            score={scoreOf(award, prizeScores)}
                          />
                        ))}
                        {noneAwards.map((award) => (
                          <AwardRow
                            key={award.id}
                            award={award}
                            ordinal={award.order}
                            score={scoreOf(award, prizeScores)}
                          />
                        ))}
                      </ul>
                    </section>

                    <section className="rulemodal__section">
                      <h3 className="section-label">奖品数量</h3>
                      <ul className="rulemodal__prizes">
                        {PRIZE_KEYS.map((key) => {
                          const count = prizeCount(inventory, key);
                          return (
                            <li
                              className={
                                'rulemodal__prize' +
                                (key === 'CHAMPION' ? ' rulemodal__prize--champion' : '')
                              }
                              key={key}
                            >
                              <span className="rulemodal__prize-name">{PRIZE_NAMES[key]}</span>
                              {count !== null && (
                                <span className="rulemodal__prize-count t-nums">{count}</span>
                              )}
                            </li>
                          );
                        })}
                      </ul>
                      <p className="rulemodal__note">
                        一桌饼是定量的，人多人少都是这一张，份数与会饼人数无关。默认份数按传统会饼配
                        （1 : 2 : 4 : 8 : 16 : 32），所以一秀最多、状元只有一个；房主开房时可自定义每样
                        份数与积分。库存领完不补；同一等级再次博出时只显示骰型，不再发奖、不加分。
                      </p>
                    </section>

                    <section className="rulemodal__block">
                      <h3 className="rulemodal__block-title">博到饼尽</h3>
                      <p className="rulemodal__text rulemodal__text--tight">
                        本局不设固定轮数，也没有任何保底：一秀、二举、三红、四进、对堂这五样饼全部博完，本局收席。
                        六颗骰子每掷一次都是均匀的 1~6，不论一秀还是状元都只看运气。
                      </p>
                      <p className="rulemodal__note">
                        状元是彩头、不是排期：博出状元照常开一轮追状元，追完接着博，直到饼尽为止。
                        因此一局快慢全看手气，也有的局到最后都没有状元。
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
