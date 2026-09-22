/**
 * 倒计时 hook。
 *
 * 客户端倒计时**只用于展示**，服务端才是时间权威。
 * 我们用 serverTimeOffset 把本地时钟对齐到服务端，避免手机时间不准导致显示错乱。
 */
import { useEffect, useRef, useState } from 'react';

export interface Countdown {
  /** 剩余毫秒 */
  remainingMs: number;
  /** 剩余秒数（向上取整，用于显示 30 29 28…） */
  seconds: number;
  /** 0~1，剩余比例 */
  ratio: number;
  /** 是否已经超时（等服务器裁决，客户端不做任何事） */
  expired: boolean;
}

export function useCountdown(
  deadlineAt: number | null | undefined,
  serverTimeOffset: number,
  totalMs: number,
): Countdown {
  const compute = (): Countdown => {
    if (!deadlineAt) {
      return { remainingMs: 0, seconds: 0, ratio: 0, expired: false };
    }
    const now = Date.now() + serverTimeOffset;
    const remainingMs = Math.max(0, deadlineAt - now);
    const safeTotal = Math.max(1, totalMs);
    return {
      remainingMs,
      seconds: Math.ceil(remainingMs / 1000),
      ratio: Math.min(1, Math.max(0, remainingMs / safeTotal)),
      expired: remainingMs <= 0,
    };
  };

  const [state, setState] = useState<Countdown>(compute);
  const offsetRef = useRef(serverTimeOffset);
  offsetRef.current = serverTimeOffset;

  useEffect(() => {
    setState(compute());
    if (!deadlineAt) return undefined;
    const timer = window.setInterval(() => {
      setState(compute());
    }, 200);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlineAt, serverTimeOffset, totalMs]);

  return state;
}
