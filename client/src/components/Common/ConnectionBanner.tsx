/**
 * ConnectionBanner —— 断线 / 重连时的顶部细横幅。
 *
 * 首次连上不打扰：只有「连上过之后又掉线」，或者「首次连接慢到异常」才出现。
 * 文案统一为「月色暂隐，正在重新连接……」，离线时补一行「请检查网络」。
 * 左侧一枚极小的旋转月牙（纯 CSS 画的，无外部资源）。
 */
import './Common.css';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

import { useGameStore } from '../../stores/gameStore';

/** 首次连接超过这么久还没成功，才认为是真的连不上。 */
const SLOW_CONNECT_MS = 2600;
/** 与退出动画时长一致，动画走完再把整块卸载。 */
const EXIT_MS = 340;

export default function ConnectionBanner(): JSX.Element | null {
  const connection = useGameStore((s) => s.connection);

  const everConnectedRef = useRef(false);
  const [slowConnecting, setSlowConnecting] = useState(false);

  useEffect(() => {
    if (connection === 'connected') {
      everConnectedRef.current = true;
      setSlowConnecting(false);
      return;
    }
    if (connection === 'connecting' && !everConnectedRef.current) {
      const timer = window.setTimeout(() => setSlowConnecting(true), SLOW_CONNECT_MS);
      return () => window.clearTimeout(timer);
    }
    setSlowConnecting(false);
    return;
  }, [connection]);

  const offline = connection === 'offline';
  const show =
    connection === 'reconnecting' || offline || (connection === 'connecting' && slowConnecting);

  // 让退出动画有机会播完，再真正卸载这一块。
  const [mounted, setMounted] = useState(show);
  useEffect(() => {
    if (show) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [show]);

  if (!mounted) return null;

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className={`common-banner ${offline ? 'common-banner--offline' : 'common-banner--busy'}`}
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: '-100%' }}
          animate={{ opacity: 1, y: '0%' }}
          exit={{ opacity: 0, y: '-100%' }}
          transition={{ duration: 0.32, ease: [0.22, 0.61, 0.36, 1] }}
        >
          <span className="common-banner__moon" aria-hidden="true" />
          <span className="common-banner__lines">
            <span className="common-banner__text">月色暂隐，正在重新连接……</span>
            {offline ? <span className="common-banner__hint">请检查网络</span> : null}
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
