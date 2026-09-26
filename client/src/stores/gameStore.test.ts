import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameSnapshot, RollRecord } from '@bobing/shared';

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (data: any) => void>(),
  play: vi.fn(),
}));
vi.mock('../audio/AudioManager', () => ({ audio: {
  setEnabled: vi.fn(), setVolume: vi.fn(), play: mocks.play,
  playDiceSequence: vi.fn(), unlock: vi.fn(),
} }));
vi.mock('../socket/socketClient', () => ({
  getSocket: () => ({ on: (name: string, fn: (data: any) => void) => mocks.handlers.set(name, fn), io: { on: vi.fn() } }),
}));

const initial = {
  roomId: 'ABCDE', stateVersion: 1, serverTime: 1000,
  players: [{ id: 'p1', nickname: '月客', score: 0 }],
  inventory: { yixiu: 4 }, champion: { nickname: null }, logs: [], lastRoll: null,
} as unknown as GameSnapshot;
const roll = { playerId: 'p1', nickname: '月客', seat: 1, auto: false,
  dice: [4, 4, 4, 4, 1, 1], awardId: 'CHAMPION_FLOWER', scoreGained: 100,
} as unknown as RollRecord;
const result = { ...initial, stateVersion: 2, lastRoll: roll,
  players: [{ id: 'p1', nickname: '月客', score: 100 }],
  inventory: { yixiu: 3 }, champion: { nickname: '月客' }, logs: ['new result'],
} as unknown as GameSnapshot;

describe('观众统一揭晓', () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.handlers.clear();
    mocks.play.mockClear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    vi.stubGlobal('window', globalThis);
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  async function setup(reducedMotion = false) {
    const { useGameStore } = await import('./gameStore');
    useGameStore.setState({ snapshot: initial, roomCode: 'ABCDE', reducedMotion });
    useGameStore.getState().initSocket();
    const emit = (name: string, data: any) => mocks.handlers.get(name)!(data);
    // 引擎的一批事件全部携带结算后的快照，包括 roll:started。
    emit('roll:started', { snapshot: result, playerId: 'p1', seat: 1, auto: false });
    emit('roll:result', { snapshot: result, roll });
    return { store: useGameStore, emit };
  }

  it.each([false, true])('所有结果数据、状元提示和音效均等待落定（减少动态=%s）', async (reduced) => {
    const { store, emit } = await setup(reduced);
    for (const name of ['inventory:updated', 'score:updated', 'champion:queueUpdated', 'room:snapshot']) {
      emit(name, { snapshot: result });
    }
    emit('champion:started', { snapshot: result });
    emit('champion:updated', { snapshot: result, replaced: true, previousNickname: '前客' });
    expect(store.getState().snapshot).toBe(initial);
    vi.advanceTimersByTime(1799);
    expect(store.getState().snapshot).toBe(initial);
    expect(store.getState().rollAnim?.dice).toBeNull();
    expect(store.getState().celebration).toBeNull();
    expect(store.getState().championFlash).toBeNull();
    expect(store.getState().toasts).toEqual([]);
    expect(mocks.play).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(store.getState().snapshot).toBe(result);
    expect(store.getState().rollAnim?.dice).toEqual(roll.dice);
    expect(store.getState().rollAnim?.rolling).toBe(false);
    expect(store.getState().championFlash?.newNickname).toBe('月客');
    expect(store.getState().toasts[0].text).toContain('首中状元');
    expect(mocks.play).toHaveBeenCalledWith('champion_replaced');
  });

  it('揭晓采用最新快照并拒绝乱序旧版本', async () => {
    const { store, emit } = await setup();
    const latest = { ...result, stateVersion: 3 };
    emit('room:snapshot', { snapshot: latest });
    emit('room:snapshot', { snapshot: initial });
    vi.advanceTimersByTime(1800);
    expect(store.getState().snapshot).toBe(latest);
  });

  it('房间关闭取消未揭晓的结果', async () => {
    const { store, emit } = await setup();
    emit('room:closed', { roomId: 'ABCDE', message: '散席' });
    vi.advanceTimersByTime(2000);
    expect(store.getState().snapshot).toBe(initial);
    expect(store.getState().rollAnim).toBeNull();
    expect(store.getState().celebration).toBeNull();
  });
});

