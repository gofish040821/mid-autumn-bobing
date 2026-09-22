/**
 * ToastStack —— 底部提示条（卷轴小条）。
 *
 * 固定在底部安全区之上，居中排列，最多同时渲染最后 3 条；
 * 左侧一条竖色带区分语气：info=黛蓝 / warn=金 / error=朱砂。
 * 点击任意一条即可关闭（store 里也会在 4.2s 后自动关闭）。
 */
import './Common.css';

import { AnimatePresence, motion } from 'framer-motion';

import { useGameStore } from '../../stores/gameStore';

/** 最多同时显示 3 条。 */
const MAX_VISIBLE = 3;

/** 语气对应的中文提示，用于无障碍朗读。 */
const TONE_LABEL: Record<'info' | 'warn' | 'error', string> = {
  info: '提示',
  warn: '注意',
  error: '出错',
};

export default function ToastStack(): JSX.Element {
  const toasts = useGameStore((s) => s.toasts);
  const dismissToast = useGameStore((s) => s.dismissToast);

  const visible = toasts.length > MAX_VISIBLE ? toasts.slice(toasts.length - MAX_VISIBLE) : toasts;

  return (
    <div className="common-toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {visible.map((toast) => (
          <motion.button
            key={toast.id}
            type="button"
            className={`common-toast common-toast--${toast.tone}`}
            onClick={() => dismissToast(toast.id)}
            aria-label={`${TONE_LABEL[toast.tone]}：${toast.text}，点击关闭`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.26, ease: [0.22, 0.61, 0.36, 1] }}
          >
            <span className="common-toast__band" aria-hidden="true" />
            <span className="common-toast__text">{toast.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
