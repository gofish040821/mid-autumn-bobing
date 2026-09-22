/**
 * ChampionFlash —— 「金榜易主」全屏浮层。
 *
 * 只在追状元阶段有人反超时触发（服务端 champion:updated → replaced = true）。
 * 整层 pointer-events: none，不挡任何操作；全程约 2.2 秒，与 store 里的
 * 2300ms 自动清除同步，下一次触发用 key 强制重播。
 */
import { useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../stores/gameStore';
import './ChampionFlash.css';

/* ------------------------------------------------------------------ *
 * 印章（就地实现，尺寸由 use 场景决定）
 * ------------------------------------------------------------------ */

interface SealProps {
  text: string;
  size?: 'sm' | 'lg';
}

function Seal({ text, size = 'sm' }: SealProps): JSX.Element {
  return (
    <span
      className={'seal' + (size === 'lg' ? ' championflash__seal--lg' : ' seal--sm')}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * 桂花粒子
 * ------------------------------------------------------------------ */

interface Petal {
  left: number;
  size: number;
  delay: number;
  duration: number;
  spin: number;
  sway: number;
}

const PETAL_COUNT = 14;

/** 用 key 做种子的确定性伪随机，保证同一次演出每帧稳定、不需要 state。 */
function buildPetals(seedKey: number): Petal[] {
  let seed = (seedKey * 9301 + 49297) % 233280;
  const random = (): number => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };

  const petals: Petal[] = [];
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    petals.push({
      left: Math.round(random() * 96) + 2,
      size: 7 + Math.round(random() * 7),
      delay: Math.round(random() * 70) / 100,
      duration: 1.5 + Math.round(random() * 90) / 100,
      spin: Math.round(random() * 360) - 180,
      sway: Math.round(random() * 40) - 20,
    });
  }
  return petals;
}

/* ------------------------------------------------------------------ *
 * 组件
 * ------------------------------------------------------------------ */

export default function ChampionFlash(): JSX.Element | null {
  const flash = useGameStore((s) => s.championFlash);
  const reducedMotion = useGameStore((s) => s.reducedMotion);

  const flashKey = flash?.key ?? 0;
  const petals = useMemo(() => buildPetals(flashKey), [flashKey]);

  const previousNickname = flash?.previousNickname ?? null;
  const newNickname = flash?.newNickname ?? '';

  /** 减少动画时只保留最朴素的淡入淡出。 */
  const t = (duration: number, delay = 0): { duration: number; delay: number } => ({
    duration: reducedMotion ? 0.01 : duration,
    delay: reducedMotion ? 0 : delay,
  });

  return (
    <AnimatePresence>
      {flash && (
        <motion.div
          className="championflash"
          key={flash.key}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={t(0.24)}
        >
          <motion.div
            className="championflash__veil"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={t(0.42)}
          />

          {/* 金色桂花粒子 */}
          {!reducedMotion &&
            petals.map((petal, index) => (
              <motion.span
                className="championflash__petal"
                key={index}
                style={{ left: `${petal.left}%`, width: petal.size, height: petal.size }}
                initial={{ y: '-14vh', x: 0, opacity: 0, rotate: 0 }}
                animate={{
                  y: ['-14vh', '8vh', '68vh', '106vh'],
                  x: [0, petal.sway, -petal.sway, 0],
                  opacity: [0, 0.95, 0.85, 0],
                  rotate: petal.spin,
                }}
                transition={{
                  duration: petal.duration,
                  delay: petal.delay,
                  times: [0, 0.18, 0.72, 1],
                  ease: 'linear',
                }}
              />
            ))}

          {/* 金色横幅 */}
          <motion.div
            className="championflash__banner"
            initial={{ y: '-140%', opacity: 0 }}
            animate={{ y: '0%', opacity: 1 }}
            exit={{ y: '-140%', opacity: 0 }}
            transition={
              reducedMotion
                ? { duration: 0.01 }
                : { type: 'spring', stiffness: 210, damping: 22, mass: 0.7 }
            }
          >
            <span className="championflash__banner-text">金榜易主！</span>
          </motion.div>

          {/* 旧状元 → 新状元 */}
          <div className="championflash__stage">
            {previousNickname !== null && (
              <motion.div
                className="championflash__old"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: [0, 1, 1, 0], y: [-6, 0, 9, 30] }}
                transition={{
                  duration: reducedMotion ? 0.01 : 1.15,
                  delay: reducedMotion ? 0 : 0.2,
                  times: [0, 0.2, 0.55, 1],
                }}
              >
                {previousNickname}
              </motion.div>
            )}

            {previousNickname !== null && (
              <motion.div
                className="championflash__arrow"
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: [0, 1, 1, 0.8], scale: [0.7, 1.06, 1, 1] }}
                transition={{
                  duration: reducedMotion ? 0.01 : 0.95,
                  delay: 0.45,
                  times: [0, 0.35, 0.8, 1],
                }}
                aria-hidden="true"
              >
                <svg viewBox="0 0 48 48" width="100%" height="100%" focusable="false">
                  {/* 祥云托底 */}
                  <path
                    d="M6 34c-2.6 0-4.4-1.9-4.4-4.2 0-2 1.4-3.6 3.4-4.1-.2-.6-.4-1.3-.4-2 0-3 2.5-5.4 5.6-5.4 1 0 2 .3 2.9.8C14.2 15.4 17.5 13 21.4 13c4.4 0 8 3.2 8.6 7.3 1.5-1.7 3.8-2.8 6.3-2.8 4.7 0 8.4 3.6 8.4 8.1 0 .8-.1 1.6-.4 2.3 1.5.5 2.5 1.9 2.5 3.5 0 2.1-1.8 3.6-4.1 3.6H6z"
                    fill="rgba(232, 199, 122, 0.3)"
                    stroke="rgba(232, 199, 122, 0.85)"
                    strokeWidth="1.4"
                  />
                  <path
                    d="M24 6.5v17M24 12l-5.4-4.6M24 12l5.4-4.6"
                    fill="none"
                    stroke="#e8c77a"
                    strokeWidth="2.6"
                    strokeLinecap="round"
                  />
                  <path d="M18.4 31.4 24 38l5.6-6.6" fill="none" stroke="#e8c77a" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </motion.div>
            )}

            <div className="championflash__new-wrap">
              <motion.div
                className="championflash__new"
                initial={{ opacity: 0, y: 28, scale: 0.92 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={
                  reducedMotion
                    ? { duration: 0.01 }
                    : { delay: 0.85, duration: 0.5, ease: [0.22, 0.61, 0.36, 1] }
                }
              >
                {newNickname}
              </motion.div>

              <motion.div
                className="championflash__stamp"
                initial={{ opacity: 0, scale: 2.2, rotate: -18 }}
                animate={{ opacity: 1, scale: 1, rotate: -9 }}
                transition={
                  reducedMotion
                    ? { duration: 0.01, delay: 0.9 }
                    : { delay: 1.32, type: 'spring', stiffness: 340, damping: 13, mass: 0.6 }
                }
              >
                <Seal text="状元" size="lg" />
              </motion.div>
            </div>

            <motion.div
              className="championflash__caption"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0, 1] }}
              transition={{
                duration: reducedMotion ? 0.01 : 0.7,
                delay: reducedMotion ? 0 : 1.45,
                times: [0, 0.75, 1],
              }}
            >
              新科状元
            </motion.div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
