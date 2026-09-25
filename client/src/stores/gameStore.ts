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
  ROOM_CODE_LENGTH,
  celebrationMsFor,
  diceMsFor,
  isValidRoomCode,
  normalizeRoomCode,
} from '@bobing/shared';
import type {
  GameSnapshot,
  LocalIdentity,
  PlayerState,
  RollRecord,
  RoomConfig,
  SiteStats,
} from '@bobing/shared';

import { audio } from '../audio/AudioManager';
import {
  clearSession,
  loadAudioEnabled,
  loadIdentity,
  loadReducedMotion,
  loadSession,
  loadVolume,
  markRulesSeen,
  hasSeenRules,
  saveAudioEnabled,
  saveNickname,
  saveReducedMotion,
  saveSession,
  saveVolume,
} from '../lib/identity';
import { clearRoomCodeFromUrl, readRoomCodeFromUrl, writeRoomCodeToUrl } from '../lib/roomLink';
import {
  emitCreateRoom,
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
  /**
   * 当前所在的房间码。
   *
   * 未入席时它来自 URL 的 `?room=`（可能在，也可能没有）；
   * 创建房间后由服务端下发并写回 URL。为 null 表示「还没选桌」。
   */
  roomCode: string | null;
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
  /**
   * 站点统计（累计到访 / 此刻在线）。
   *
   * 它和房间无关，是**全站**的数字，所以既不进 snapshot 也不随房间切换重置，
   * 而是由服务端单独广播。还没收到第一份时为 null —— 界面宁可先不显示，
   * 也不要凭空画一个 0 出来，那个 0 会被当成真的。
   */
  stats: SiteStats | null;

  /* ---- 演出状态 ---- */
  rollAnim: RollAnimation | null;
  celebration: Celebration | null;
  championFlash: ChampionFlash | null;
  toasts: Toast[];
  rollPending: boolean;
  joining: boolean;
  /** 正在等服务端分配房间码 */
  creatingRoom: boolean;
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
  /** 开一张新桌，成功后房间码写进 URL 与 store。可携带自定义奖品配置。 */
  createRoom: (config?: RoomConfig) => Promise<boolean>;
  /** 放弃当前选中的房间码，回到选桌状态（可重新自定义奖品数量再开桌）。 */
  clearRoom: () => void;
  /** 用房间码加入一张已存在的桌（入席前调用）。 */
  useRoomCode: (roomId: string) => boolean;
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

/** 页面加载时就从 URL 里认领房间码，这样刷新能直接回到同一桌。 */
const initialRoomCode = readRoomCodeFromUrl();

export const useGameStore = create<GameStore>((set, get) => ({
  identity: loadIdentity(initialRoomCode),
  roomCode: initialRoomCode,
  hasJoined: false,
  rulesSeen: hasSeenRules(),
  audioEnabled: loadAudioEnabled(),
  volume: loadVolume(),
  reducedMotion: loadReducedMotion(),

  connection: 'connecting',
  lastError: null,
  serverTimeOffset: 0,
  snapshot: null,
  stats: null,

  rollAnim: null,
  celebration: null,
  championFlash: null,
  toasts: [],
  rollPending: false,
  joining: false,
  creatingRoom: false,
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

    // 房主离席，这一桌作废。服务端那边座位凭证已经作废了，本地也得跟着忘掉，
    // 否则刷新之后会拿着旧 token 去进一个已经不存在的房间，报一个莫名其妙的错。
    socket.on('room:closed', ({ roomId: closedRoomId, message }) => {
      clearSession(closedRoomId);
      // 只清自己这一桌的：URL 上的房间码如果就是那张散掉的桌，也该擦掉，
      // 不然刷新后又被带回去。人在别桌时（理论上不该收到）不动 URL。
      if (get().roomCode === closedRoomId) {
        clearRoomCodeFromUrl();
        set({ roomCode: null });
      }
      set((s) => ({
        hasJoined: false,
        joining: false,
        // 刻意**不**把 snapshot 清成 null。
        //
        // 退场是靠 hasJoined 触发的（App 的路由只看它），而 AnimatePresence 的
        // mode="wait" 会把旧页面继续挂着、等它淡出完（340ms）才挂新页面。
        // 这段窗口里如果把快照清空，游戏页整棵子树会当场渲染成空 ——
        // 退场动画的「已完成」回调就再也不会触发，新页面永远等不到上场机会，
        // 用户看到的是**一片空白**（页面停在 opacity:0 的旧容器里出不来）。
        // 留一份旧快照不影响任何判断：入席页只用它挑随机雅号，下一次入席会被新快照整个覆盖。
        // resync 遇到 INVALID_SESSION 时也是这么做的（只置 hasJoined，不动快照）。
        //
        // 座位凭证则必须跟着这一桌一起作废：留着它的话，这个人下一次入席会把
        // 一张属于已销毁房间的 token 递上去。
        identity: { ...s.identity, sessionToken: null, playerId: null },
        rollAnim: null,
        celebration: null,
        championFlash: null,
        lastError: null,
      }));
      get().pushToast(message, 'warn');
    });

    // 全站统计和房间无关，直接覆盖，不参与 stateVersion 那套比较
    socket.on('stats:updated', ({ stats }) => set({ stats }));

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

  createRoom: async (config) => {
    if (get().creatingRoom) return false;
    audio.unlock();
    set({ creatingRoom: true, lastError: null });
    const res = await emitCreateRoom(config);
    set({ creatingRoom: false });

    if (!res.ok) {
      set({ lastError: res.message });
      get().pushToast(res.message, 'error');
      return false;
    }
    applyRoom(res.data.roomId, set);
    return true;
  },

  clearRoom: () => {
    applyRoom(null, set);
  },

  useRoomCode: (roomId) => {
    const code = normalizeRoomCode(roomId);
    if (!isValidRoomCode(code)) {
      set({ lastError: `房间码是 ${ROOM_CODE_LENGTH} 位字符，请检查邀请链接` });
      return false;
    }
    applyRoom(code, set);
    return true;
  },

  join: async (nickname) => {
    const trimmed = nickname.trim();
    if (!trimmed) {
      get().pushToast('请先取个名字', 'warn');
      return false;
    }
    const roomId = get().roomCode;
    if (!roomId) {
      get().pushToast('请先开一桌，或用房间码加入', 'warn');
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
      roomId,
    });
    set({ joining: false });

    if (!res.ok) {
      if (res.snapshot) snapshotSink(res.snapshot);
      // 座位凭证失效（例如服务端重启、或这一局已经开始）→ 清掉旧 token 以便重新入席
      if (res.error === 'INVALID_SESSION') {
        clearSession(roomId);
        set((s) => ({ identity: { ...s.identity, sessionToken: null, playerId: null } }));
      }
      // 房间不存在（多半是链接不全或码打错了）→ 把 URL 上的房间码也撤掉，
      // 否则刷新之后还是同一个错，人会一直卡在这一步
      if (res.error === 'ROOM_NOT_FOUND') {
        applyRoom(null, set);
      }
      set({ lastError: res.message });
      get().pushToast(res.message, 'error');
      return false;
    }

    saveSession(roomId, res.data.sessionToken, res.data.playerId);
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
    const { identity, roomCode } = get();
    if (!identity.sessionToken || !roomCode) return;
    const res = await emitSync(identity.sessionToken);
    if (res.ok) {
      snapshotSink(res.data);
      set({ hasJoined: true });
    } else if (res.error === 'INVALID_SESSION') {
      clearSession(roomCode);
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

type StoreSet = (
  partial: Partial<GameStore> | ((state: GameStore) => Partial<GameStore>),
) => void;

/**
 * 切换当前房间。
 *
 * 三件事必须一起做，少一件就会出「看起来正常但到处是怪事」的 bug：
 *   1. 房间码写回 URL —— 否则刷新页面就掉回未选桌状态；
 *   2. 取回**这个房间**的座位凭证 —— 每个房间的凭证是分开存的，
 *      不换证就会拿着 A 桌的 token 去敲 B 桌的门，必然被拒；
 *   3. hasJoined 归零 —— 换了桌就得重新入席。
 *
 * roomId 传 null 表示「还没选桌」，此时清掉 URL 上的房间码。
 */
function applyRoom(roomId: string | null, set: StoreSet): void {
  if (roomId) writeRoomCodeToUrl(roomId);
  else clearRoomCodeFromUrl();

  const session = loadSession(roomId);
  set((s) => ({
    roomCode: roomId,
    hasJoined: false,
    lastError: null,
    identity: {
      ...s.identity,
      sessionToken: session.sessionToken,
      playerId: session.playerId,
    },
  }));
}

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
