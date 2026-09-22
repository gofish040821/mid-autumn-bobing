/**
 * 月华值 —— 只用月相与渐满的细线来表达「机缘渐近」。
 *
 * 设计原则：
 *  1. 绝不出现「下一把必出状元」这类明示保底的文案；
 *  2. 绝不把概率数字（rate）写给玩家看，rate 只用来决定线的深浅；
 *  3. 第一轮（IDLE）整块压到最暗，不显示进度。
 */
import { motion } from 'framer-motion';
import type { GameSnapshot, MoonBlessingView } from '@bobing/shared';

import Moon from '../Scenery/Moon';
import './MoonBlessing.css';

export interface MoonBlessingProps {
  snapshot: GameSnapshot;
  className?: string;
}

/** 各阶段的副题：只写意境，不写机制。 */
const STAGE_HINT: Record<MoonBlessingView['stage'], string> = {
  IDLE: '',
  CHARGING: '桂香渐浓，机缘自生',
  FULL: '月满中天，金榜将开',
  DONE: '月华归隐，静候新局',
};

export default function MoonBlessing({ snapshot, className }: MoonBlessingProps): JSX.Element {
  const blessing = snapshot.moonBlessing;

  const idle = blessing.stage === 'IDLE';
  const near = !idle && blessing.nearGuarantee;
  const progress = idle ? 0 : Math.min(1, Math.max(0, blessing.progress));

  // rate 只影响线的浓淡，不落到任何数字文案上。
  const depth = Math.min(1, Math.max(0, blessing.rate));
  const fillOpacity = 0.58 + depth * 0.42;

  const text = idle ? '月华未起' : blessing.text;
  const hint = STAGE_HINT[blessing.stage];

  const rootClass = [
    'mb',
    idle ? 'mb--idle' : 'mb--live',
    near ? 'mb--near' : '',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <section className={rootClass} aria-label={`月华值：${text}`}>
      <span className="section-label t-kai">月 华 值</span>

      <div className="mb__row">
        <div className="mb__moon" aria-hidden="true">
          <Moon progress={progress} stage={blessing.stage} size={40} />
        </div>

        <div className="mb__body">
          <p className="mb__text t-kai">{text}</p>

          {!idle && (
            <div
              className="mb__bar"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(progress * 100)}
              aria-label="月华渐满的程度"
            >
              <span className="mb__cap mb__cap--start" aria-hidden="true" />
              <span className="mb__line">
                <motion.span
                  className="mb__fill"
                  style={{ opacity: fillOpacity }}
                  initial={false}
                  animate={{ scaleX: progress }}
                  transition={{ duration: 0.55, ease: [0.22, 0.61, 0.36, 1] }}
                />
              </span>
              <span className="mb__cap mb__cap--end" aria-hidden="true" />
            </div>
          )}

          {!idle && hint && <p className="mb__hint t-fang">{hint}</p>}
        </div>
      </div>
    </section>
  );
}
