/**
 * gameStore —— 客户端的唯一状态源。
 *
 * 服务端权威：这里保存的 snapshot 只是服务端状态的镜像，
 * 客户端永远不会自己决定骰子、奖项、积分或库存。
 *
 * 本地状态只有三类：
 *   1. 身份与偏好（localStorage）
 *   2. 连接状态
 *   3. 演出状态（骰子动画、开奖庆祝、金榜易主、提示条）
 */
import { create } from 'zustand';
import {
  AWARD_MAP,
  celebrationMsFor,
  diceMsFor,
} from '@bobing/shared';
import type { GameSnapshot, LocalIdentity, PlayerState, RollRecord } from '@bobing/shared';

import { audio } from '../audio/AudioManager';
import {
  clearSession,
  loadAudioEnabled,
  loadIdentity,
  loadReducedMotion,
  loadVolume,
  markRulesSeen,
  hasSeenRules,
  saveAudioEnabled,
  saveNickname,
  saveReducedMotion,
  saveSession,
  saveVolume,
} from '../lib/identity';
import {
  emitJoin,
  emitRestart,
  emitRoll,
  emitSetNickname,
  emitStart,
  emitSync,
  getSocket,
} from '../socket/socketClient';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface RollAnimation {
  key: number;
  playerId: string;
  nickname: string;
  seat: number;
  auto: boolean;
  /** true = 骰子正在翻滚；false = 已落定 */
  rolling: boolean;
  dice: number[] | null;
  startedAt: number;
  durationMs: number;
}

export interface Celebration {
  key: number;
  roll: RollRecord;
}

export interface ChampionFlash {
  key: number;
  previousNickname: string | null;
  newNickname: string;
}

export interface Toast {
  id: number;
  text: string;
  tone: 'info' | 'warn' | 'error';
}

interface GameStore {
  /* ---- 身份与偏好 ---- */
  identity: LocalIdentity;
  hasJoined: boolean;
  rulesSeen: boolean;
  audioEnabled: boolean;
  volume: number;
  reducedMotion: boolean;

  /* ---- 连接 ---- */
  connection: ConnectionStatus;
  lastError: string | null;
  /** 服务端时间 - 本地时间，用于校正倒计时 */
  serverTimeOffset: number;

  /* ---- 服务端状态镜像 ---- */
  snapshot: GameSnapshot | null;

  /* ---- 演出状态 ---- */
  rollAnim: RollAnimation | null;
  celebration: Celebration | null;
  championFlash: ChampionFlash | null;
  toasts: Toast[];
  rollPending: boolean;
  joining: boolean;
  /** 卷轴式规则弹窗 */
  ruleOpen: boolean;

  /* ---- 动作 ---- */
  initSocket: () => void;
  openRules: () => void;
  closeRules: () => void;
  setRulesSeen: () => void;
  setAudioEnabled: (v: boolean) => void;
  setVolume: (v: number) => void;
  setReducedMotion: (v: boolean) => void;
  rename: (nickname: string) => Promise<void>;
  join: (nickname: string) => Promise<boolean>;
  resync: () => Promise<void>;
  startGame: () => Promise<void>;
  restartGame: () => Promise<void>;
  roll: () => Promise<void>;
  dismissCelebration: () => void;
  pushToast: (text: string, tone?: Toast['tone']) => void;
  dismissToast: (id: number) => void;
  clearError: () => void;
}

/* ------------------------------------------------------------------ *
 * 内部计数器与定时器
 * ------------------------------------------------------------------ */

let animKey = 0;
let celebrationKey = 0;
let flashKey = 0;
let toastKey = 0;
let actionCounter = 0;
let revealTimer: number | null = null;
let flashTimer: number | null = null;
let listenersAttached = false;

/** initSocket 注册的快照写入器；所有动作方法共用同一套版本校验。 */
let snapshotSink: (snapshot: GameSnapshot) => void = () => {};

function clearRevealTimer(): void {
  if (revealTimer !== null) {
    window.clearTimeout(revealTimer);
    revealTimer = null;
  }
}

/* ------------------------------------------------------------------ *
 * Store
 * ------------------------------------------------------------------ */

export const useGameStore = create<GameStore>((set, get) => ({
  identity: loadIdentity(),
  hasJoined: false,
  rulesSeen: hasSeenRules(),
  audioEnabled: loadAudioEnabled(),
  volume: loadVolume(),
  reducedMotion: loadReducedMotion(),

  connection: 'connecting',
  lastError: null,
  serverTimeOffset: 0,
  snapshot: null,

  rollAnim: null,
  celebration: null,
  championFlash: null,
  toasts: [],
  rollPending: false,
  joining: false,
  ruleOpen: false,

  /* ---------------- 初始化 ---------------- */

  initSocket: () => {
    if (listenersAttached) return;
    listenersAttached = true;

    const socket = getSocket();
    audio.setEnabled(get().audioEnabled);
    audio.setVolume(get().volume);
    applyReducedMotion(get().reducedMotion);

    socket.on('connect', () => {
      set({ connection: 'connected' });
      const { identity, hasJoined } = get();
      if (hasJoined && identity.sessionToken) void get().resync();
    });

    socket.on('disconnect', () => {
      set({ connection: 'offline' });
    });

    socket.io.on('reconnect_attempt', () => {
      set({ connection: 'reconnecting' });
    });

    socket.io.on('error', () => {
      set({ connection: 'offline' });
    });

    if (socket.connected) set({ connection: 'connected' });

    /* ---- 服务端事件 ---- */

    const applySnapshot = (snapshot: GameSnapshot): void => {
      const current = get().snapshot;
      // 绝不用旧版本状态覆盖新版本
      if (current && current.roomId === snapshot.roomId && snapshot.stateVersion < current.stateVersion) {
        return;
      }
      set({
        snapshot,
        serverTimeOffset: snapshot.serverTime - Date.now(),
      });
    };
    snapshotSink = applySnapshot;

    socket.on('room:snapshot', ({ snapshot }) => applySnapshot(snapshot));
    socket.on('room:playerJoined', ({ snapshot }) => applySnapshot(snapshot));
    socket.on('room:playerLeft', ({ snapshot }) => applySnapshot(snapshot));
    socket.on('room:playerReconnected', ({ snapshot }) => applySnapshot(snapshot));

    socket.on('room:playerDisconnected', ({ snapshot, playerId }) => {
      applySnapshot(snapshot);
      const p = snapshot.players.find((x) => x.id === playerId);
      if (p && p.id !== get().identity.playerId) {
        get().pushToast(`${p.nickname}暂时离席`, 'warn');
      }
    });

    socket.on('game:started', ({ snapshot }) => {
      applySnapshot(snapshot);
      get().pushToast('今夜开席，月下博饼。', 'info');
    });

    socket.on('turn:changed', ({ snapshot }) => applySnapshot(snapshot));
    socket.on('inventory:updated', ({ snapshot }) => applySnapshot(snapshot));
    socket.on('score:updated', ({ snapshot }) => applySnapshot(snapshot));

    socket.on('roll:started', ({ snapshot, playerId, seat, auto }) => {
      applySnapshot(snapshot);
      clearRevealTimer();
      const nickname = snapshot.players.find((p) => p.id === playerId)?.nickname ?? '';
      const durationMs = diceMsFor(null);
      animKey += 1;
      set({
        rollAnim: {
          key: animKey,
          playerId,
          nickname,
          seat,
          auto,
          rolling: true,
          dice: null,
          startedAt: performance.now(),
          durationMs,
        },
        celebration: null,
      });
      audio.playDiceSequence(durationMs);
    });

    socket.on('roll:result', ({ snapshot, roll }) => {
      applySnapshot(snapshot);
      const anim = get().rollAnim;
      const durationMs = diceMsFor(roll.awardId);

      if (!anim || anim.playerId !== roll.playerId) {
        // 没有正在播放的动画（例如刚进页面）→ 直接揭晓
        reveal(roll);
        return;
      }

      set({
        rollAnim: { ...anim, rolling: true, dice: roll.dice, durationMs },
      });

      const elapsed = performance.now() - anim.startedAt;
      const wait = Math.max(140, durationMs - elapsed);
      revealTimer = window.setTimeout(() => reveal(roll), wait);
    });

    socket.on('champion:started', ({ snapshot }) => {
      applySnapshot(snapshot);
      const c = snapshot.champion;
      if (c.nickname) get().pushToast(`${c.nickname}首中状元，追状元开启！`, 'info');
    });

    socket.on('champion:updated', ({ snapshot, replaced, previousNickname }) => {
      applySnapshot(snapshot);
      if (!replaced) return;
      flashKey += 1;
      set({
        championFlash: {
          key: flashKey,
          previousNickname,
          newNickname: snapshot.champion.nickname ?? '',
        },
      });
      audio.play('champion_replaced');
      if (flashTimer !== null) window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => set({ championFlash: null }), 2300);
    });

    socket.on('champion:queueUpdated', ({ snapshot }) => applySnapshot(snapshot));

    socket.on('game:finished', ({ snapshot }) => {
      applySnapshot(snapshot);
      audio.play('game_finish');
    });

    /* ---- 揭晓 ---- */
    function reveal(roll: RollRecord): void {
      clearRevealTimer();
      const anim = get().rollAnim;
      if (anim && anim.playerId === roll.playerId) {
        set({ rollAnim: { ...anim, rolling: false, dice: roll.dice } });
      } else {
        animKey += 1;
        set({
          rollAnim: {
            key: animKey,
            playerId: roll.playerId,
            nickname: roll.nickname,
            seat: roll.seat,
            auto: roll.auto,
            rolling: false,
            dice: roll.dice,
            startedAt: performance.now(),
            durationMs: 0,
          },
        });
      }
      celebrationKey += 1;
      set({ celebration: { key: celebrationKey, roll } });
      const sound = AWARD_MAP[roll.awardId]?.sound;
      if (sound) audio.play(sound);
    }
  },

  openRules: () => set({ ruleOpen: true }),

  closeRules: () => set({ ruleOpen: false }),

  setRulesSeen: () => {
    markRulesSeen();
    set({ rulesSeen: true });
  },

  setAudioEnabled: (v) => {
    audio.setEnabled(v);
    saveAudioEnabled(v);
    set({ audioEnabled: v });
    if (v) {
      audio.unlock();
      audio.play('ui_click');
    }
  },

  setVolume: (v) => {
    audio.setVolume(v);
    saveVolume(v);
    set({ volume: v });
  },

  setReducedMotion: (v) => {
    saveReducedMotion(v);
    applyReducedMotion(v);
    set({ reducedMotion: v });
  },

  rename: async (nickname) => {
    const trimmed = nickname.trim();
    if (!trimmed) return;
    saveNickname(trimmed);
    set((s) => ({ identity: { ...s.identity, nickname: trimmed } }));
    if (!get().hasJoined) return;
    const res = await emitSetNickname(trimmed);
    if (!res.ok) get().pushToast(res.message, 'warn');
  },

  join: async (nickname) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      get().pushToast('请先取个名字', 'warn');
      return false;
    }
    audio.unlock();
    set({ joining: true, lastError: null });
    saveNickname(trimmed);

    const { identity } = get();
    const res = await emitJoin({
      guestId: identity.guestId,
      sessionToken: identity.sessionToken,
      nickname: trimmed,
    });
    set({ joining: false });

    if (!res.ok) {
      if (res.snapshot) snapshotSink(res.snapshot);
      // 座位凭证失效（例如服务端重启、或这一局已经开始）→ 清掉旧 token 以便重新入席
      if (res.error === 'INVALID_SESSION') clearSession();
      set({ lastError: res.message });
      get().pushToast(res.message, 'error');
      return false;
    }

    saveSession(res.data.sessionToken, res.data.playerId);
    set((s) => ({
      hasJoined: true,
      identity: {
        ...s.identity,
        nickname: trimmed,
        sessionToken: res.data.sessionToken,
        playerId: res.data.playerId,
      },
    }));
    snapshotSink(res.data.snapshot);
    if (get().rulesSeen) audio.play('ui_click');
    return true;
  },

  resync: async () => {
    const { identity } = get();
    if (!identity.sessionToken) return;
    const res = await emitSync(identity.sessionToken);
    if (res.ok) {
      snapshotSink(res.data);
      set({ hasJoined: true });
    } else if (res.error === 'INVALID_SESSION') {
      clearSession();
      set((s) => ({
        hasJoined: false,
        lastError: res.message,
        identity: { ...s.identity, sessionToken: null, playerId: null },
      }));
      if (res.snapshot) snapshotSink(res.snapshot);
    }
  },

  startGame: async () => {
    audio.unlock();
    const res = await emitStart();
    if (!res.ok) {
      if (res.snapshot) snapshotSink(res.snapshot);
      get().pushToast(res.message, 'warn');
    }
    audio.play('ui_click');
  },

  restartGame: async () => {
    audio.unlock();
    const res = await emitRestart();
    if (!res.ok) {
      if (res.snapshot) snapshotSink(res.snapshot);
      get().pushToast(res.message, 'warn');
    }
    audio.play('ui_click');
  },

  roll: async () => {
    const { snapshot, identity, rollPending, rollAnim } = get();
    if (rollPending) return;
    if (!snapshot?.currentTurn) return;
    if (snapshot.phase !== 'NORMAL_TURN' && snapshot.phase !== 'CHAMPION_CHASE') return;
    if (snapshot.currentTurn.playerId !== identity.playerId) return;
    if (snapshot.currentTurn.status !== 'WAITING') return;
    if (rollAnim?.rolling) return;

    actionCounter += 1;
    const actionId = `a${actionCounter}_${Date.now().toString(36)}`;
    set({ rollPending: true });
    const res = await emitRoll(snapshot.currentTurn.turnId, actionId);
    set({ rollPending: false });

    if (!res.ok) {
      if (res.snapshot) snapshotSink(res.snapshot);
      get().pushToast(res.message, 'warn');
    } else {
      snapshotSink(res.data.snapshot);
    }
  },

  dismissCelebration: () => set({ celebration: null }),

  pushToast: (text, tone = 'info') => {
    toastKey += 1;
    const id = toastKey;
    set((s) => ({ toasts: [...s.toasts, { id, text, tone }] }));
    window.setTimeout(() => get().dismissToast(id), 4200);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  clearError: () => set({ lastError: null }),
}));

/* ------------------------------------------------------------------ *
 * 帮助函数（非 hook）
 * ------------------------------------------------------------------ */

function applyReducedMotion(value: boolean): void {
  try {
    document.documentElement.dataset.reducedMotion = value ? 'true' : 'false';
  } catch {
    /* ignore */
  }
}

/* ------------------------------------------------------------------ *
 * 选择器
 * ------------------------------------------------------------------ */

export function selectMe(state: GameStore): PlayerState | null {
  const { snapshot, identity } = state;
  if (!snapshot || !identity.playerId) return null;
  return snapshot.players.find((p) => p.id === identity.playerId) ?? null;
}

export function selectIsMyTurn(state: GameStore): boolean {
  const { snapshot, identity } = state;
  if (!snapshot?.currentTurn) return false;
  return snapshot.currentTurn.playerId === identity.playerId;
}

export function selectCanRoll(state: GameStore): boolean {
  const { snapshot, identity, rollPending, rollAnim } = state;
  if (!snapshot?.currentTurn) return false;
  if (snapshot.currentTurn.playerId !== identity.playerId) return false;
  if (snapshot.currentTurn.status !== 'WAITING') return false;
  if (snapshot.phase !== 'NORMAL_TURN' && snapshot.phase !== 'CHAMPION_CHASE') return false;
  if (rollPending) return false;
  if (rollAnim?.rolling) return false;
  return true;
}

export function selectIsHost(state: GameStore): boolean {
  const { snapshot, identity } = state;
  if (!snapshot) return false;
  return snapshot.hostId === identity.playerId;
}

/** 服务端校正后的当前时间。 */
export function serverNow(state: GameStore): number {
  return Date.now() + state.serverTimeOffset;
}

export { celebrationMsFor };
