/**
 * 可注入的时钟。
 *
 * 生产环境用 systemClock；测试里用 FakeClock 手动推进时间，
 * 于是「30 秒超时自动博饼」「掉线玩家自动博饼」都能被确定性地测出来。
 */
export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => {
    const handle = setTimeout(fn, ms);
    // 不要让定时器阻止进程退出
    if (typeof handle === 'object' && handle !== null && 'unref' in handle) {
      (handle as { unref: () => void }).unref();
    }
    return handle;
  },
  clearTimeout: (handle) => {
    if (handle !== null && handle !== undefined) clearTimeout(handle as NodeJS.Timeout);
  },
};

interface FakeTimer {
  id: number;
  at: number;
  fn: () => void;
}

export class FakeClock implements Clock {
  private current: number;
  private timers: FakeTimer[] = [];
  private nextId = 1;

  constructor(start = 1_700_000_000_000) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const id = this.nextId;
    this.nextId += 1;
    this.timers.push({ id, at: this.current + Math.max(0, ms), fn });
    return id;
  }

  clearTimeout(handle: unknown): void {
    const id = handle as number;
    this.timers = this.timers.filter((t) => t.id !== id);
  }

  /** 推进时间，按到期顺序依次触发回调。 */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((t) => t.id !== due.id);
      this.current = due.at;
      due.fn();
    }
    this.current = target;
  }

  get pendingTimers(): number {
    return this.timers.length;
  }
}
