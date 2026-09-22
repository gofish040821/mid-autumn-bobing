/**
 * DiceStage —— 白瓷碗里的六颗骰子。
 *
 * 全场最重要的动画：跃起 → 翻滚 → 落定。
 * 骰子点数在翻滚期间以 70~90ms 的间隔随机跳动，
 * 到 durationMs（来自 shared 的 diceMsFor）之后准时停手，
 * 把落定的点数交给外层展示。
 *
 * 只用 transform / opacity 做动画；不碰 canvas，不碰 3D 引擎。
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import DiceFace from './DiceFace';
import { diceChinese, diceDigits } from '../../lib/format';
import { useGameStore } from '../../stores/gameStore';
import './Dice.css';

export interface DiceStageProps {
  /** 落定后的六颗点数；null 表示本局还没博过 */
  dice: number[] | null;
  /** 是否正在翻滚 */
  rolling: boolean;
  /** 本次动画时长（毫秒），来自 shared 的 diceMsFor() */
  durationMs: number;
  /** 每次博饼递增，用于重启动画 */
  animKey: number;
  /** 是否为大奖（Champion Tier），影响光晕强度 */
  highlight?: boolean;
}

const DICE_COUNT = 6;

/** 落定 / 跃起 / 翻滚 / 归位 四个关键帧的时间点 */
const MOTION_TIMES: number[] = [0, 0.28, 0.63, 1];

const EASE_ROLL: [number, number, number, number] = [0.2, 0.62, 0.32, 1];
const EASE_SETTLE: [number, number, number, number] = [0.34, 1.26, 0.64, 1];

interface DieMotion {
  y: number[];
  rotate: number[];
  scale: number[];
  delay: number;
}

/** 固定种子的伪随机：同一个 animKey 每次渲染都得到同一套动作，避免抖动。 */
function makeRng(seed: number): () => number {
  let s = Math.floor(Math.abs(seed)) % 2147483646;
  if (s <= 0) s = 20260922;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function buildMotions(seed: number): DieMotion[] {
  const rng = makeRng(seed);
  const list: DieMotion[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) {
    const direction = rng() < 0.5 ? -1 : 1;
    const jump = 30 + rng() * 30; // 跃起 30 ~ 60px
    const spin = direction * 1080; // 整整三圈，停下时必然是正面
    list.push({
      y: [0, -jump, -jump * 0.36, 0],
      rotate: [0, spin * 0.34, spin * 0.72, spin],
      scale: [1, 1.14, 1.05, 1],
      delay: i * 0.035 + rng() * 0.05,
    });
  }
  return list;
}

function randomFaces(): number[] {
  const list: number[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) {
    list.push(1 + Math.floor(Math.random() * 6));
  }
  return list;
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** 把外部的 dice 补齐成固定 6 颗；非法值退化成空骰面（0）。 */
function normalize(dice: number[] | null): number[] {
  if (!dice || dice.length === 0) return [];
  const list: number[] = [];
  for (let i = 0; i < DICE_COUNT; i += 1) {
    const v = dice[i];
    list.push(Number.isInteger(v) && v >= 1 && v <= 6 ? v : 0);
  }
  return list;
}

export default function DiceStage({
  dice,
  rolling,
  durationMs,
  animKey,
  highlight = false,
}: DiceStageProps): JSX.Element {
  const reduceMotion = useGameStore((s) => s.reducedMotion);
  const [systemReduce, setSystemReduce] = useState<boolean>(prefersReducedMotion);

  // 系统层面的「减少动态效果」也要尊重
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = (): void => setSystemReduce(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const reduce = reduceMotion || systemReduce;
  const dur = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 1200;
  const spinning = rolling && !reduce;

  const [faces, setFaces] = useState<number[]>(randomFaces);

  // 翻滚期间：每 70~90ms 换一副随机骰面，到点必须停手（卸载同样要清干净）
  useEffect(() => {
    if (!spinning) return undefined;
    let stopped = false;
    let tickTimer = 0;

    const tick = (): void => {
      if (stopped) return;
      setFaces(randomFaces());
      tickTimer = window.setTimeout(tick, 70 + Math.random() * 20);
    };

    tickTimer = window.setTimeout(tick, 60);
    const stopTimer = window.setTimeout(() => {
      stopped = true;
      window.clearTimeout(tickTimer);
    }, dur);

    return () => {
      stopped = true;
      window.clearTimeout(tickTimer);
      window.clearTimeout(stopTimer);
    };
  }, [spinning, dur, animKey]);

  const diceKey = dice ? dice.join('-') : 'none';
  const settled = useMemo(() => normalize(dice), [diceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // 稳定展示数组：翻滚时用随机面，落定后用真实点数
  const shown = useMemo<number[]>(
    () => (spinning ? faces : settled),
    [spinning, faces, settled],
  );

  const display = useMemo<number[]>(() => {
    const list: number[] = [];
    for (let i = 0; i < DICE_COUNT; i += 1) {
      const v = shown[i];
      list.push(Number.isInteger(v) && v >= 1 && v <= 6 ? v : 0);
    }
    return list;
  }, [shown]);

  const motions = useMemo(() => buildMotions(animKey * 7919 + 1), [animKey]);

  const waiting = !spinning && settled.length === 0;
  const hasResult = settled.length > 0;

  const label = spinning
    ? '骰子正在翻滚'
    : hasResult
      ? `骰子点数 ${diceChinese(settled)}`
      : '骰子尚未掷出，六颗骰子点数朝下';

  const announce =
    !spinning && hasResult
      ? `骰子落定，点数 ${diceChinese(settled)}，号码 ${diceDigits(settled)}`
      : '';

  const stageClass = highlight ? 'dice-stage dice-stage--highlight' : 'dice-stage';
  const bowlClass = spinning ? 'dice-stage__bowl dice-stage__bowl--shaking' : 'dice-stage__bowl';

  return (
    <div className={stageClass}>
      <div className="dice-stage__board">
        {/* 墨迹晕开：翻滚起始时在碗下一闪即逝 */}
        {spinning && (
          <span key={`ink-${animKey}`} className="dice-stage__inkclip" aria-hidden="true">
            <span className="dice-stage__ink" />
          </span>
        )}

        {/* 白瓷碗 */}
        <span className={bowlClass} aria-hidden="true" />

        <div className="dice-stage__dice" role="img" aria-label={label}>
          {display.map((value, i) => {
            const die = motions[i];
            const dieClass = [
              'dice-stage__die',
              waiting ? 'dice-stage__die--down' : '',
              spinning ? 'dice-stage__die--flying' : '',
            ]
              .filter(Boolean)
              .join(' ');

            return (
              <motion.div
                key={`${spinning ? 'spin' : 'still'}-${animKey}-${i}`}
                className={dieClass}
                initial={spinning ? { y: 0, rotate: 0, scale: 1 } : false}
                animate={
                  spinning
                    ? { y: die.y, rotate: die.rotate, scale: die.scale }
                    : { y: 0, rotate: 0, scale: 1 }
                }
                transition={
                  spinning
                    ? {
                        duration: dur / 1000,
                        times: MOTION_TIMES,
                        delay: die.delay,
                        ease: EASE_ROLL,
                      }
                    : { duration: 0.24, ease: EASE_SETTLE }
                }
              >
                <DiceFace value={value} size={48} />
              </motion.div>
            );
          })}
        </div>
      </div>

      {waiting && <p className="dice-stage__hint">静候月华</p>}

      <span className="sr-only" aria-live="polite">
        {announce}
      </span>
    </div>
  );
}
