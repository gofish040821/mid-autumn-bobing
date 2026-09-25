/**
 * GameEngine —— 服务端权威的完整游戏状态机。
 *
 * 原则：
 *  - 骰子、奖项、积分、库存、状元全部由服务端决定，客户端只能说「我要博饼」；
 *  - 每个 turnId 只能成功开奖一次；
 *  - 30 秒超时由服务端定时器触发，不依赖客户端；
 *  - 所有状态变化都通过 EngineEvent + 全量 Snapshot 广播，客户端状态永远可自愈。
 */
import { AWARD_MAP, DEFAULT_ROOM_CONFIG, NICKNAME_MAX, PRIZE_NAMES, transitionMsFor } from '@bobing/shared';
import type {
  AwardDefinition,
  AwardId,
  ChampionOutcome,
  ChampionState,
  ErrorCode,
  GameEndReason,
  GameResult,
  GameSnapshot,
  GameStats,
  InventoryState,
  JoinResult,
  LogEntry,
  Phase,
  PlayerState,
  PrizeKey,
  RollRecord,
  RoomConfig,
  TurnState,
} from '@bobing/shared';

import { ABANDON_GRACE_MS, AUTO_START_COUNTDOWN_MS, CHAMPION_BONUS, LOBBY_GHOST_TTL_MS, MAX_LOG_ENTRIES, MAX_PLAYERS, MAX_ROLL_HISTORY, MIN_PLAYERS, ROOM_ID, TURN_TIMEOUT_MS, TURN_TIMEOUT_OFFLINE_MS } from '../config/gameConfig.js';
import { buildInventory, emptyInventory } from '../config/prizes.js';
import { systemClock } from './Clock.js';
import type { Clock } from './Clock.js';
import { buildChaseQueue, emptyChampionState, shouldReplaceChampion } from './ChampionService.js';
import { rollRawDice, type Rng } from './DiceService.js';
import { consumePrize, grantChampionPrize, isInventoryExhausted } from './PrizeService.js';
import { addPrize, addScore, computeRanking } from './ScoreService.js';
import { diceToChinese, evaluateDice } from './RuleEngine.js';
import { formatLogId, formatPlayerId, formatRollId, formatTurnId, validateRollRequest } from './TurnService.js';

/* ------------------------------------------------------------------ *
 * 事件
 * ------------------------------------------------------------------ */

export type EngineEvent =
  | { type: 'room:snapshot' }
  | { type: 'room:playerJoined'; player: PlayerState }
  | { type: 'room:playerLeft'; playerId: string }
  | { type: 'room:playerDisconnected'; playerId: string }
  | { type: 'room:playerReconnected'; playerId: string }
  | { type: 'game:started' }
  | { type: 'turn:changed' }
  | { type: 'roll:started'; turnId: string; playerId: string; seat: number; auto: boolean }
  | { type: 'roll:result'; roll: RollRecord }
  | { type: 'inventory:updated' }
  | { type: 'score:updated' }
  | { type: 'champion:started' }
  | { type: 'champion:updated'; replaced: boolean; previousNickname: string | null }
  | { type: 'champion:queueUpdated' }
  | { type: 'game:finished' };

export type EngineEmitter = (events: EngineEvent[], snapshot: GameSnapshot) => void;

export type EngineResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ErrorCode; message: string };

function fail<T>(error: ErrorCode, message: string): EngineResult<T> {
  return { ok: false, error, message };
}

/* ------------------------------------------------------------------ *
 * 内部状态
 * ------------------------------------------------------------------ */

interface InternalPlayer extends PlayerState {
  sessionToken: string;
  socketId: string | null;
}

interface EngineState {
  roomId: string;
  phase: Phase;
  players: InternalPlayer[];
  currentTurn: TurnState | null;
  inventory: InventoryState;
  /** 本桌的奖品配置（数量与积分），开房时定下，之后每局复用。 */
  config: RoomConfig;
  champion: ChampionState;
  lastRoll: RollRecord | null;
  rollHistory: RollRecord[];
  gameLog: LogEntry[];
  stats: GameStats;
  startedAt: number | null;
  finishedAt: number | null;
  result: GameResult | null;
  autoStartAt: number | null;
  /** 本局是否已经发过状元奖（幂等） */
  championPrizeGranted: boolean;
}

export interface EngineDeps {
  /** 这张桌的房间码。不传则退回默认房间（单测直接 new 时用）。 */
  roomId?: string;
  clock?: Clock;
  rng?: Rng;
  emit?: EngineEmitter;
  /**
   * 测试缝：本局开席时发什么牌。
   *
   * 不传就是正常的 buildInventory()（一桌 63 份饼）。单测可以注入一副小库存，
   * 几步之内就博到饼尽 —— 收席这条路径靠冒烟脚本验证要跑满一整局（几分钟），
   * 靠这里只要几十毫秒。
   */
  inventoryFor?: () => InventoryState;
  /** 开房时的奖品配置（数量与积分）。缺省回落到 DEFAULT_ROOM_CONFIG。 */
  config?: RoomConfig;
}

function emptyStats(): GameStats {
  return {
    totalRolls: 0,
    firstChampionRollIndex: null,
    championReplacements: 0,
    autoRolls: 0,
    durationMs: null,
  };
}

/** 深拷贝开房配置，避免多处共享同一份 counts/scores 对象。 */
function cloneConfig(config: RoomConfig | undefined): RoomConfig {
  const source = config ?? DEFAULT_ROOM_CONFIG;
  return {
    counts: { ...source.counts },
    scores: { ...source.scores },
  };
}

/* ------------------------------------------------------------------ *
 * GameEngine
 * ------------------------------------------------------------------ */

export class GameEngine {
  private readonly clock: Clock;
  private readonly rng: Rng;
  private deps: EngineDeps;

  private state: EngineState;
  private stateVersion = 0;

  private playercounter = 0;
  private turnCounter = 0;
  private rollCounter = 0;
  private logCounter = 0;

  private turnTimer: unknown = null;
  private advanceTimer: unknown = null;
  private autoStartTimer: unknown = null;
  /** 全员掉线后的「散场」判定计时器 */
  private abandonTimer: unknown = null;
  private readonly ghostTimers = new Map<string, unknown>();

  constructor(deps: EngineDeps = {}) {
    this.deps = deps;
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.state = {
      roomId: deps.roomId ?? ROOM_ID,
      phase: 'LOBBY',
      players: [],
      currentTurn: null,
      inventory: emptyInventory(),
      config: cloneConfig(deps.config),
      champion: emptyChampionState(),
      lastRoll: null,
      rollHistory: [],
      gameLog: [],
      stats: emptyStats(),
      startedAt: null,
      finishedAt: null,
      result: null,
      autoStartAt: null,
      championPrizeGranted: false,
    };
  }

  /** 运行期替换广播回调（房间管理器创建 socket 层时使用）。 */
  setEmitter(emit: EngineEmitter): void {
    this.deps = { ...this.deps, emit };
  }

  /* ---------------- 查询 ---------------- */

  get phase(): Phase {
    return this.state.phase;
  }

  get version(): number {
    return this.stateVersion;
  }

  get playerCount(): number {
    return this.state.players.length;
  }

  /**
   * 当前房主的 playerId，没有房主时为 null。
   *
   * 刻意不叫 `snapshot().hostId` —— 那个要现攒一整份快照（含库存、排行榜、
   * 日志），而这里只想知道「谁是房主」。断线处理在热路径上，不该为一个人
   * 字付出整份快照的代价。
   */
  get hostId(): string | null {
    return this.state.players.find((p) => p.isHost)?.id ?? null;
  }

  snapshot(): GameSnapshot {
    return {
      roomId: this.state.roomId,
      phase: this.state.phase,
      stateVersion: this.stateVersion,
      players: this.state.players
        .map((p) => this.toPublicPlayer(p))
        .sort((a, b) => a.seat - b.seat),
      currentTurn: this.state.currentTurn ? { ...this.state.currentTurn } : null,
      inventory: {
        counts: { ...this.state.inventory.counts },
        initial: { ...this.state.inventory.initial },
      },
      prizeScores: { ...this.state.config.scores },
      champion: { ...this.state.champion, chaseQueue: [...this.state.champion.chaseQueue] },
      lastRoll: this.state.lastRoll ? { ...this.state.lastRoll } : null,
      rollHistory: this.state.rollHistory.map((r) => ({ ...r, dice: [...r.dice] })),
      gameLog: this.state.gameLog.map((l) => ({ ...l })),
      stats: { ...this.state.stats },
      hostId: this.state.players.find((p) => p.isHost)?.id ?? null,
      startedAt: this.state.startedAt,
      finishedAt: this.state.finishedAt,
      result: this.state.result,
      serverTime: this.clock.now(),
      minPlayers: MIN_PLAYERS,
      maxPlayers: MAX_PLAYERS,
      autoStartAt: this.state.autoStartAt,
    };
  }

  private toPublicPlayer(p: InternalPlayer): PlayerState {
    return {
      id: p.id,
      guestId: p.guestId,
      nickname: p.nickname,
      seat: p.seat,
      online: p.online,
      connectedAt: p.connectedAt,
      lastSeenAt: p.lastSeenAt,
      score: p.score,
      prizes: { ...p.prizes },
      rollCount: p.rollCount,
      isHost: p.isHost,
    };
  }

  private findPlayer(playerId: string): InternalPlayer | undefined {
    return this.state.players.find((p) => p.id === playerId);
  }

  /**
   * 某奖项在本桌的积分。
   *
   * 与静态判奖表（awards.ts）不同，这里读开房配置：普通奖项取各自 prizeKey 的
   * 积分，状元档取统一的 CHAMPION 基础分。NONE 没有 prizeKey，恒为 0。
   */
  private scoreForAward(award: AwardDefinition): number {
    const key = award.prizeKey;
    if (!key) return 0;
    return this.state.config.scores[key] ?? award.score;
  }

  private flush(events: EngineEvent[]): void {
    if (events.length === 0) return;
    this.stateVersion += 1;
    this.deps.emit?.(events, this.snapshot());
  }

  private log(text: string, tone: LogEntry['tone'] = 'normal'): void {
    this.logCounter += 1;
    this.state.gameLog.push({
      id: formatLogId(this.logCounter),
      at: this.clock.now(),
      text,
      tone,
    });
    const overflow = this.state.gameLog.length - MAX_LOG_ENTRIES;
    if (overflow > 0) this.state.gameLog.splice(0, overflow);
  }

  /* ---------------- 计时器 ---------------- */

  private clearTurnTimer(): void {
    if (this.turnTimer !== null) {
      this.clock.clearTimeout(this.turnTimer);
      this.turnTimer = null;
    }
  }

  private clearAdvanceTimer(): void {
    if (this.advanceTimer !== null) {
      this.clock.clearTimeout(this.advanceTimer);
      this.advanceTimer = null;
    }
  }

  private clearAutoStartTimer(): void {
    if (this.autoStartTimer !== null) {
      this.clock.clearTimeout(this.autoStartTimer);
      this.autoStartTimer = null;
    }
    this.state.autoStartAt = null;
  }

  private clearAbandonTimer(): void {
    if (this.abandonTimer !== null) {
      this.clock.clearTimeout(this.abandonTimer);
      this.abandonTimer = null;
    }
  }

  /**
   * 全员掉线 → 起一个「散场」计时器；只要有人回来或有人新入席就取消。
   *
   * 只在整个房间一个人都不在线时才计时（`every(p => !p.online)`），
   * 所以一个人短暂切后台不会影响牌局。大厅阶段不需要——那时有
   * LOBBY_GHOST_TTL_MS 逐个清座位，房间本来就会自然回到可用状态。
   */
  private maybeScheduleAbandon(): void {
    const anyoneOnline = this.state.players.some((p) => p.online);
    if (anyoneOnline || this.state.players.length === 0 || this.state.phase === 'LOBBY') {
      this.clearAbandonTimer();
      return;
    }
    if (this.abandonTimer !== null) return; // 已经在计时了
    this.abandonTimer = this.clock.setTimeout(() => {
      this.abandonTimer = null;
      this.abandonIfStillEmpty();
    }, ABANDON_GRACE_MS);
  }

  /** 计时器到点：仍然一个人都不在线才真的作废，否则说明有人回来了。 */
  private abandonIfStillEmpty(): void {
    if (this.state.players.some((p) => p.online)) return;
    if (this.state.players.length === 0) return;
    if (this.state.phase === 'LOBBY') return;

    const events: EngineEvent[] = [];
    const count = this.state.players.length;
    this.resetRoundState();
    this.state.players = [];
    this.state.inventory = emptyInventory();
    this.state.phase = 'LOBBY';
    this.log(`久无人应，本局作罢（原 ${count} 位客人皆已离席）。`, 'system');
    events.push({ type: 'room:snapshot' });
    this.flush(events);
  }

  /**
   * 这一次回合该等多久：在线的人给足思考时间，已经离线的人只等一小会儿。
   *
   * 代掷本身两边都会发生，区别只在于全桌要盯着倒计时熬多久。
   */
  private turnWaitFor(playerId: string): number {
    const player = this.findPlayer(playerId);
    return player && !player.online ? TURN_TIMEOUT_OFFLINE_MS : TURN_TIMEOUT_MS;
  }

  private scheduleTurnTimeout(): void {
    this.clearTurnTimer();
    const turn = this.state.currentTurn;
    const wait = turn ? this.turnWaitFor(turn.playerId) : TURN_TIMEOUT_MS;
    this.turnTimer = this.clock.setTimeout(() => {
      this.turnTimer = null;
      this.handleTurnTimeout();
    }, wait);
  }

  private handleTurnTimeout(): void {
    const turn = this.state.currentTurn;
    if (!turn || turn.status !== 'WAITING') return;
    this.executeRoll(true);
  }

  /* ---------------- 玩家进出 ---------------- */

  join(params: {
    guestId: string;
    nickname: string;
    sessionToken?: string | null;
    socketId: string | null;
  }): EngineResult<JoinResult> {
    const now = this.clock.now();

    // 1) 携带 sessionToken → 尝试断线重连
    if (params.sessionToken) {
      const existing = this.state.players.find(
        (p) => p.sessionToken === params.sessionToken && p.guestId === params.guestId,
      );
      if (existing) {
        const events: EngineEvent[] = [];
        this.cancelGhostTimer(existing.id);
        existing.online = true;
        existing.socketId = params.socketId;
        existing.lastSeenAt = now;
        if (params.nickname && params.nickname !== existing.nickname) {
          existing.nickname = params.nickname.slice(0, NICKNAME_MAX);
          if (this.state.currentTurn?.playerId === existing.id) {
            this.state.currentTurn.nickname = existing.nickname;
          }
        }
        this.clearAbandonTimer(); // 有人回来了，散场作罢
        this.log(`${existing.nickname}回到席间。`, 'system');
        events.push({ type: 'room:playerReconnected', playerId: existing.id });
        this.flush(events);
        return {
          ok: true,
          data: {
            playerId: existing.id,
            sessionToken: existing.sessionToken,
            seat: existing.seat,
            isHost: existing.isHost,
            snapshot: this.snapshot(),
          },
        };
      }
      // token 无效 —— 游戏进行中一律拒绝，防止陌生人插队
      if (this.state.phase !== 'LOBBY') {
        return fail('INVALID_SESSION', '这一局的座位已经排定，无法重新入席');
      }
    }

    // 2) 新玩家
    if (this.state.phase !== 'LOBBY') {
      return fail('GAME_ALREADY_STARTED', '本桌已经开席，请等下一局');
    }
    if (this.state.players.length >= MAX_PLAYERS) {
      return fail('ROOM_FULL', `本桌最多 ${MAX_PLAYERS} 人，已经坐满了`);
    }
    if (this.state.players.some((p) => p.guestId === params.guestId)) {
      return fail('INVALID_SESSION', '这个浏览器已经有座位了，请刷新页面重试');
    }

    const seat = this.nextFreeSeat();
    const isFirst = this.state.players.length === 0;
    this.playercounter += 1;

    const player: InternalPlayer = {
      id: formatPlayerId(this.playercounter),
      guestId: params.guestId,
      nickname: params.nickname.slice(0, NICKNAME_MAX),
      seat,
      online: true,
      connectedAt: now,
      lastSeenAt: now,
      score: 0,
      prizes: {},
      rollCount: 0,
      isHost: isFirst || !this.state.players.some((p) => p.isHost),
      sessionToken: makeSessionToken(this.rng, this.playercounter),
      socketId: params.socketId,
    };
    this.state.players.push(player);
    this.clearAbandonTimer();
    this.log(`${player.nickname}入席，坐第 ${player.seat} 位。`, 'system');

    const events: EngineEvent[] = [{ type: 'room:playerJoined', player }];
    this.maybeScheduleAutoStart(events);
    this.flush(events);

    return {
      ok: true,
      data: {
        playerId: player.id,
        sessionToken: player.sessionToken,
        seat: player.seat,
        isHost: player.isHost,
        snapshot: this.snapshot(),
      },
    };
  }

  private nextFreeSeat(): number {
    const used = new Set(this.state.players.map((p) => p.seat));
    let seat = 1;
    while (used.has(seat)) seat += 1;
    return seat;
  }

  disconnect(playerId: string): void {
    const player = this.findPlayer(playerId);
    if (!player || !player.online) return;
    player.online = false;
    player.socketId = null;
    player.lastSeenAt = this.clock.now();

    const events: EngineEvent[] = [{ type: 'room:playerDisconnected', playerId }];

    if (this.state.phase === 'LOBBY') {
      this.ensureHost();
      this.scheduleGhostRemoval(playerId);
      this.maybeScheduleAutoStart(events);
    }

    // 正好轮到他掉线 —— 把剩下的等待缩短到「离线档」，别让全桌陪着一个
    // 空座位熬满 30 秒。deadlineAt 一起改，否则客户端倒计时会和服务端对不上。
    const turn = this.state.currentTurn;
    if (turn && turn.playerId === playerId && turn.status === 'WAITING') {
      turn.deadlineAt = this.clock.now() + TURN_TIMEOUT_OFFLINE_MS;
      this.scheduleTurnTimeout();
    }

    // 牌局进行中不设房主移交（座位是定死的），但全员走光要让这局能自然作废
    this.maybeScheduleAbandon();

    this.log(`${player.nickname}暂时离席。`, 'warn');
    this.flush(events);
  }

  /** 玩家主动离开（目前只有等待大厅里会用到）。 */
  leave(playerId: string): void {
    const player = this.findPlayer(playerId);
    if (!player) return;
    this.removePlayerFromLobby(player.id, '离席');
  }

  private scheduleGhostRemoval(playerId: string): void {
    this.cancelGhostTimer(playerId);
    const handle = this.clock.setTimeout(() => {
      this.ghostTimers.delete(playerId);
      const player = this.findPlayer(playerId);
      if (!player || player.online) return;
      if (this.state.phase !== 'LOBBY') return;
      this.removePlayerFromLobby(playerId, '久候未归');
    }, LOBBY_GHOST_TTL_MS);
    this.ghostTimers.set(playerId, handle);
  }

  private cancelGhostTimer(playerId: string): void {
    const handle = this.ghostTimers.get(playerId);
    if (handle !== undefined) {
      this.clock.clearTimeout(handle);
      this.ghostTimers.delete(playerId);
    }
  }

  private removePlayerFromLobby(playerId: string, reason: string): void {
    const index = this.state.players.findIndex((p) => p.id === playerId);
    if (index < 0) return;
    const [removed] = this.state.players.splice(index, 1);
    this.cancelGhostTimer(playerId);
    this.log(`${removed.nickname}${reason}。`, 'warn');
    this.compactSeats();
    this.ensureHost();
    const events: EngineEvent[] = [{ type: 'room:playerLeft', playerId }];
    this.maybeScheduleAutoStart(events);
    this.flush(events);
  }

  /** 重新紧排座位号（只在等待大厅使用，开局后座位锁定）。 */
  private compactSeats(): void {
    [...this.state.players]
      .sort((a, b) => a.seat - b.seat)
      .forEach((p, i) => {
        p.seat = i + 1;
      });
  }

  private ensureHost(): void {
    const players = this.state.players;
    if (players.length === 0) return;
    const host = players.find((p) => p.isHost);
    if (host && host.online) return;
    const candidate =
      [...players].filter((p) => p.online).sort((a, b) => a.seat - b.seat)[0] ??
      [...players].sort((a, b) => a.seat - b.seat)[0];
    if (!candidate || (host && host.id === candidate.id)) return;
    players.forEach((p) => {
      p.isHost = false;
    });
    candidate.isHost = true;
    this.log(`${candidate.nickname}接任房主。`, 'system');
  }

  /** 房主，或者「房主不在线时的最小座位在线玩家」。 */
  private actingAsHost(player: InternalPlayer): boolean {
    if (player.isHost) return true;
    const host = this.state.players.find((p) => p.isHost);
    if (!host || !host.online) {
      const lowestOnline = [...this.state.players]
        .filter((p) => p.online)
        .sort((a, b) => a.seat - b.seat)[0];
      return lowestOnline?.id === player.id;
    }
    return false;
  }

  setNickname(playerId: string, nickname: string): EngineResult<PlayerState> {
    const player = this.findPlayer(playerId);
    if (!player) return fail('INVALID_SESSION', '找不到你的座位，请刷新页面');
    const trimmed = nickname.slice(0, NICKNAME_MAX);
    if (trimmed.length < 1) return fail('NICKNAME_REQUIRED', '昵称不能为空');
    player.nickname = trimmed;
    if (this.state.currentTurn?.playerId === player.id) {
      this.state.currentTurn.nickname = trimmed;
    }
    this.flush([{ type: 'room:snapshot' }]);
    return { ok: true, data: this.toPublicPlayer(player) };
  }

  /* ---------------- 自动开局 ---------------- */

  private maybeScheduleAutoStart(events: EngineEvent[]): void {
    if (this.state.phase !== 'LOBBY') return;
    if (this.state.players.length >= MAX_PLAYERS) {
      if (this.state.autoStartAt === null) {
        const at = this.clock.now() + AUTO_START_COUNTDOWN_MS;
        this.state.autoStartAt = at;
        this.autoStartTimer = this.clock.setTimeout(() => {
          this.autoStartTimer = null;
          this.state.autoStartAt = null;
          this.autoStartAsHost();
        }, AUTO_START_COUNTDOWN_MS);
        this.log(`${MAX_PLAYERS}人已满，五秒后自动开席。`, 'system');
        events.push({ type: 'room:snapshot' });
      }
      return;
    }
    if (this.state.autoStartAt !== null) {
      this.clearAutoStartTimer();
      this.log('人数有变，自动开席取消。', 'system');
      events.push({ type: 'room:snapshot' });
    }
  }

  private autoStartAsHost(): void {
    if (this.state.phase !== 'LOBBY') return;
    if (this.state.players.length < MIN_PLAYERS) return;
    const host = this.state.players.find((p) => p.isHost) ?? this.state.players[0];
    this.start(host.id);
  }

  /* ---------------- 开局 ---------------- */

  start(playerId: string): EngineResult<GameSnapshot> {
    if (this.state.phase !== 'LOBBY') {
      return fail('GAME_ALREADY_STARTED', '本局已经开始了');
    }
    const player = this.findPlayer(playerId);
    if (!player) return fail('INVALID_SESSION', '找不到你的座位，请刷新页面');
    if (!this.actingAsHost(player)) return fail('NOT_HOST', '只有房主可以开始游戏');
    if (this.state.players.length < MIN_PLAYERS) {
      return fail('NOT_ENOUGH_PLAYERS', `至少需要 ${MIN_PLAYERS} 位朋友才能开席`);
    }

    this.resetRoundState();
    const count = this.state.players.length;
    this.state.inventory = this.deps.inventoryFor?.() ?? buildInventory(this.state.config);
    this.state.startedAt = this.clock.now();
    this.state.autoStartAt = null;
    this.clearAutoStartTimer();

    this.state.phase = 'NORMAL_TURN';
    this.log(`今夜开席，共 ${count} 位客人。`, 'system');

    const first = [...this.state.players].sort((a, b) => a.seat - b.seat)[0];
    this.startTurn(first.id, 'NORMAL');

    const events: EngineEvent[] = [{ type: 'game:started' }, { type: 'turn:changed' }];
    this.flush(events);
    return { ok: true, data: this.snapshot() };
  }

  private resetRoundState(): void {
    for (const p of this.state.players) {
      p.score = 0;
      p.prizes = {};
      p.rollCount = 0;
    }
    this.state.currentTurn = null;
    this.state.champion = emptyChampionState();
    this.state.lastRoll = null;
    this.state.rollHistory = [];
    this.state.gameLog = [];
    this.state.stats = emptyStats();
    this.state.startedAt = null;
    this.state.finishedAt = null;
    this.state.result = null;
    this.state.championPrizeGranted = false;
    this.clearTurnTimer();
    this.clearAdvanceTimer();
  }

  /**
   * 回合计数器刻意不重置：turnId 在整个房间生命周期内保持唯一。
   *
   * @returns 是否真的开出了一个回合。找不到人时返回 false，
   *          由调用方决定怎么收场（正常路径是收席），绝不留一个空回合。
   */
  private startTurn(playerId: string, kind: 'NORMAL' | 'CHASE'): boolean {
    const player = this.findPlayer(playerId);
    if (!player) {
      // 防御：找不到人就报回去，绝不让游戏卡在一个没人能博的回合上
      this.state.currentTurn = null;
      return false;
    }
    this.turnCounter += 1;
    const now = this.clock.now();
    this.state.currentTurn = {
      turnId: formatTurnId(this.turnCounter),
      playerId: player.id,
      nickname: player.nickname,
      seat: player.seat,
      status: 'WAITING',
      startedAt: now,
      deadlineAt: now + this.turnWaitFor(player.id),
      kind,
      rollIndex: this.state.stats.totalRolls + 1,
      chaseIndex: kind === 'CHASE' ? this.state.champion.chaseDone + 1 : 0,
    };
    this.scheduleTurnTimeout();
    return true;
  }

  /* ---------------- 博饼 ---------------- */

  roll(playerId: string, turnId: string, actionId: string): EngineResult<RollRecord> {
    const player = this.findPlayer(playerId);
    if (!player) return fail('INVALID_SESSION', '找不到你的座位，请刷新页面');

    const actionKey = `${turnId}::${actionId}`;
    const alreadyProcessed = this.processedActions.has(actionKey);

    const error = validateRollRequest({
      phase: this.state.phase,
      turn: this.state.currentTurn,
      playerId,
      turnId,
      alreadyProcessed,
    });
    if (error) return fail(error, ROLL_ERROR_MESSAGES[error]);

    this.processedActions.add(actionKey);
    if (this.processedActions.size > 512) {
      // 只保留最近的记录，避免无限增长
      const keys = [...this.processedActions];
      this.processedActions = new Set(keys.slice(keys.length - 256));
    }

    this.executeRoll(false);
    const roll = this.state.lastRoll;
    if (!roll) return fail('INTERNAL_ERROR', '开奖失败，请重试');
    return { ok: true, data: roll };
  }

  private processedActions = new Set<string>();

  /**
   * 真正开奖。auto = true 表示由服务器超时/掉线代掷。
   * 这是唯一一处会推进游戏的地方。
   */
  private executeRoll(auto: boolean): void {
    const turn = this.state.currentTurn;
    if (!turn || turn.status !== 'WAITING') return;

    const player = this.findPlayer(turn.playerId);
    if (!player) {
      // 玩家不在（理论上不会发生），跳到下一回合
      this.state.currentTurn = null;
      this.advanceTurn();
      return;
    }

    this.clearTurnTimer();
    turn.status = 'ROLLING';

    const events: EngineEvent[] = [
      { type: 'roll:started', turnId: turn.turnId, playerId: player.id, seat: player.seat, auto },
    ];

    const playerCount = this.state.players.length;
    const isChase = this.state.phase === 'CHAMPION_CHASE';

    // 骰子完全随机：普通回合和追状元回合走的是同一句话，六颗均匀 1~6。
    // 这里没有加持、没有保底、没有任何「为了凑出某个奖项」的构造。
    const dice = rollRawDice(this.rng);

    const award = evaluateDice(dice);
    const resolution = consumePrize(award, this.state.inventory);

    this.state.stats.totalRolls += 1;
    player.rollCount += 1;
    if (auto) this.state.stats.autoRolls += 1;

    let scoreGained = 0;
    if (resolution.granted && resolution.prizeKey) {
      scoreGained = this.scoreForAward(award);
      addScore(player, scoreGained);
      addPrize(player, resolution.prizeKey);
    }

    this.rollCounter += 1;
    const roll: RollRecord = {
      id: formatRollId(this.rollCounter),
      rollIndex: this.state.stats.totalRolls,
      playerId: player.id,
      nickname: player.nickname,
      seat: player.seat,
      dice: [...dice],
      awardId: award.id,
      tier: award.tier,
      isChampionTier: award.tier === 'CHAMPION',
      prizeKey: resolution.prizeKey,
      prizeGranted: resolution.granted,
      inventoryExhausted: resolution.exhausted,
      scoreGained,
      auto,
      kind: isChase ? 'CHASE' : 'NORMAL',
      replacedChampion: false,
      becameFirstChampion: false,
      at: this.clock.now(),
    };

    // ---- 状元相关 ----
    //
    // 统一用 shouldReplaceChampion 判定，不另开「是不是首位」的分支：
    // emptyChampionState().rank 是 0，所有 Champion Tier 的 rank 都 ≥ 1，
    // 于是「本局第一位状元」天然被同一条谓词覆盖。
    //
    // 榜被刷新才换人、才开新一轮追状元；正在追状元时再易主只夺榜，
    // 队列原样保留（一轮追状元只开一次，不嵌套）。
    let previousChampionNickname: string | null = null;
    let chaseOpened = false;
    if (award.tier === 'CHAMPION') {
      this.state.stats.firstChampionRollIndex ??= this.state.stats.totalRolls;

      if (shouldReplaceChampion(this.state.champion.rank, award.championRank)) {
        const isFirst = this.state.champion.playerId === null;
        // 追状元只在普通回合里开一轮；正在追状元时再易主只夺榜，不嵌套开新一轮
        const opensChase = !isChase;
        chaseOpened = opensChase;

        previousChampionNickname = isFirst ? null : this.state.champion.nickname;
        roll.becameFirstChampion = isFirst;
        roll.replacedChampion = !isFirst;

        this.state.champion = {
          ...this.state.champion,
          playerId: player.id,
          nickname: player.nickname,
          seat: player.seat,
          awardId: award.id,
          dice: [...dice],
          rank: award.championRank,
          // 开新的一轮才重新排队；途中易主保留原队列，剩下的挑战者照样博完
          chaseQueue: opensChase
            ? buildChaseQueue(this.state.players, player.id)
            : this.state.champion.chaseQueue,
          chaseTotal: opensChase ? Math.max(0, playerCount - 1) : this.state.champion.chaseTotal,
          chaseDone: opensChase ? 0 : this.state.champion.chaseDone,
          replacements: isFirst ? 0 : this.state.champion.replacements + 1,
        };
        if (opensChase) this.state.phase = 'CHAMPION_CHASE';
        if (!isFirst) this.state.stats.championReplacements += 1;
      }
    }

    // 追状元每博一次记一次进度 —— 必须放在**改状元对象之后**：
    // 开新一轮时 chaseDone 刚被归零，先加后置会被覆盖掉。
    // 途中易主不重置进度（挑战者该博几次还是几次），只有开新一轮才归零。
    if (isChase) this.state.champion.chaseDone += 1;

    // ---- 历史与日志 ----
    this.state.lastRoll = roll;
    this.state.rollHistory.push(roll);
    const overflow = this.state.rollHistory.length - MAX_ROLL_HISTORY;
    if (overflow > 0) this.state.rollHistory.splice(0, overflow);

    this.writeRollLog(roll, award.id, resolution.exhausted);

    turn.status = 'RESOLVING';

    // ---- 事件 ----
    events.push({ type: 'roll:result', roll });
    if (resolution.granted) events.push({ type: 'inventory:updated' });
    if (scoreGained > 0) events.push({ type: 'score:updated' });
    if (chaseOpened) events.push({ type: 'champion:started' });
    if (roll.replacedChampion) {
      events.push({
        type: 'champion:updated',
        replaced: true,
        previousNickname: previousChampionNickname,
      });
    }
    if (isChase && !roll.isChampionTier) events.push({ type: 'champion:queueUpdated' });

    // 等客户端把「骰子动画 + 中奖演出」播完，再推进下一回合
    const delay = transitionMsFor(award.id);
    this.clearAdvanceTimer();
    this.advanceTimer = this.clock.setTimeout(() => {
      this.advanceTimer = null;
      this.advanceTurn();
    }, delay);

    this.flush(events);
  }

  private writeRollLog(roll: RollRecord, awardId: AwardId, exhausted: boolean): void {
    const award = AWARD_MAP[awardId];
    if (roll.auto) {
      this.log(`${roll.nickname}沉醉月色，系统替他掷出了骰子。`, 'warn');
    }
    if (award.tier === 'CHAMPION') {
      this.log(`${roll.nickname}博出${award.name}！`, 'champion');
      if (roll.becameFirstChampion) {
        this.log('首位状元出现，追状元开启。', 'champion');
      } else if (roll.replacedChampion) {
        this.log(`${roll.nickname}反超成为当前状元！`, 'champion');
      } else {
        this.log(`${roll.nickname}未能超过当前状元，${award.name}惜败。`, 'normal');
      }
      return;
    }
    if (awardId === 'NONE') {
      this.log(`${roll.nickname}博出（${diceToChinese(roll.dice)}），月色尚浅，无奖。`, 'normal');
      return;
    }
    if (exhausted) {
      this.log(
        `${roll.nickname}博出${award.name}，可惜本桌${PRIZE_NAMES[award.prizeKey ?? 'ONE_SHOW']}已经领完。`,
        'warn',
      );
      return;
    }
    this.log(`${roll.nickname}博出${award.name}，获得 ${roll.scoreGained} 分。`, 'win');
  }

  /* ---------------- 回合推进 ---------------- */

  private advanceTurn(): void {
    const phase = this.state.phase;

    if (phase === 'NORMAL_TURN') {
      // 饼尽收席：五样普通饼全博空了，本局就到这里。
      // 状元不在这道闸门里 —— 见 prizes.ts 的 ENDING_PRIZE_KEYS。
      if (isInventoryExhausted(this.state.inventory)) {
        this.settle('INVENTORY_EMPTY');
        return;
      }
      const currentSeat = this.state.currentTurn?.seat ?? 0;
      const nextId = this.nextSeatPlayerId(currentSeat);
      if (!nextId || !this.startTurn(nextId, 'NORMAL')) {
        // 找不到下家（名单被清空、座位全没了）。
        // 从前这里是静默 return，那会让局面永远卡在 NORMAL_TURN：
        // 没有回合、没有计时器、没有人能操作，也永远不会结束。
        this.settle('ABORTED');
        return;
      }
      this.flush([{ type: 'turn:changed' }]);
      return;
    }

    if (phase === 'CHAMPION_CHASE') {
      const nextId = this.state.champion.chaseQueue.shift();
      if (nextId && this.startTurn(nextId, 'CHASE')) {
        this.flush([{ type: 'turn:changed' }, { type: 'champion:queueUpdated' }]);
        return;
      }
      // 一轮追状元跑完 —— 回到普通回合接着博，直到饼尽才收席。
      // 队列止于状元的前一位，所以从最后一个挑战者的下家接着轮，
      // 下一位正好回到状元本人。
      this.state.phase = 'NORMAL_TURN';
      this.advanceTurn();
      return;
    }

    // LOBBY / SETTLING / FINISHED：没有下一步
  }

  private nextSeatPlayerId(afterSeat: number): string | null {
    const ordered = [...this.state.players].sort((a, b) => a.seat - b.seat);
    if (ordered.length === 0) return null;
    const next = ordered.find((p) => p.seat > afterSeat) ?? ordered[0];
    return next.id;
  }

  /* ---------------- 结算 ---------------- */

  /**
   * 收席。
   *
   * 状元可有可无 —— 纯随机之下约四分之一的牌局一个状元都博不出来，
   * 那时冠军位空着，状元奖 1 份原封留在库存里，本局照样结算。
   */
  private settle(endReason: GameEndReason): void {
    this.state.phase = 'SETTLING';
    this.clearTurnTimer();
    this.state.currentTurn = null;

    const championPlayerId = this.state.champion.playerId;
    const events: EngineEvent[] = [];
    let bonus = 0;
    let baseScore = 0;

    if (championPlayerId) {
      const player = this.findPlayer(championPlayerId);
      const award = this.state.champion.awardId ? AWARD_MAP[this.state.champion.awardId] : null;
      if (player && award) {
        baseScore = this.scoreForAward(award);
        // 幂等保护：状元奖在整个房间生命周期内只发一次
        const granted = !this.state.championPrizeGranted && grantChampionPrize(this.state.inventory);
        if (granted) {
          bonus = CHAMPION_BONUS;
          addScore(player, baseScore + bonus);
          addPrize(player, 'CHAMPION');
          this.log(`${player.nickname}成为本局最终状元！${award.name} · 基础 ${baseScore} 分 + 状元 ${bonus} 分。`, 'champion');
        } else {
          this.log(`${player.nickname}成为本局最终状元！`, 'champion');
        }
        this.state.champion.finalPlayerId = player.id;
      }
      this.state.championPrizeGranted = true;
    }

    if (endReason === 'INVENTORY_EMPTY') {
      this.log(
        championPlayerId
          ? '五样饼博尽，本局收席。'
          : '五样饼博尽，本局收席 —— 今夜的状元始终没有出现，状元饼原封留在桌上。',
        'system',
      );
    } else {
      this.log('牌局中止，本局收席。', 'warn');
    }

    const finishedAt = this.clock.now();
    this.state.finishedAt = finishedAt;
    this.state.stats.durationMs =
      this.state.startedAt !== null ? finishedAt - this.state.startedAt : null;
    this.state.result = this.buildResult(championPlayerId, baseScore, bonus, finishedAt, endReason);
    this.state.phase = 'FINISHED';

    events.push({ type: 'champion:updated', replaced: false, previousNickname: null });
    events.push({ type: 'inventory:updated' });
    events.push({ type: 'score:updated' });
    events.push({ type: 'game:finished' });

    // 结算页的入场节奏交给客户端控制（它会等最后一次演出播完再进场），
    // 服务端这里不再额外延迟，避免状态与广播不同步。
    this.flush(events);
  }

  /**
   * 结算数据。**永远返回一份结果**，没有状元时 `champion` 为 null。
   *
   * 从前这里有两个 return null 的早退，于是「本局无状元」和「玩家被清掉」
   * 都表现成 result === null，结算页只能一直显示「结算数据尚未同步」。
   */
  private buildResult(
    championPlayerId: string | null,
    baseScore: number,
    bonus: number,
    finishedAt: number,
    endReason: GameEndReason,
  ): GameResult {
    const player = championPlayerId ? this.findPlayer(championPlayerId) : undefined;
    const awardId = this.state.champion.awardId;

    const champion: ChampionOutcome | null =
      player && awardId
        ? {
            playerId: player.id,
            nickname: player.nickname,
            seat: player.seat,
            awardId,
            dice: [...(this.state.champion.dice ?? [])],
            baseScore,
            bonus,
          }
        : null;

    return {
      champion,
      ranking: computeRanking(this.state.players, champion?.playerId ?? null),
      finishedAt,
      endReason,
    };
  }

  /* ---------------- 再来一局 ---------------- */

  restart(playerId: string): EngineResult<GameSnapshot> {
    if (this.state.phase !== 'FINISHED') {
      return fail('GAME_ALREADY_STARTED', '本局尚未结束，无法再来一局');
    }
    const player = this.findPlayer(playerId);
    if (!player) return fail('INVALID_SESSION', '找不到你的座位，请刷新页面');
    if (!this.actingAsHost(player)) return fail('NOT_HOST', '只有房主可以开启新的一局');

    this.resetRoundState();
    this.state.inventory = emptyInventory();
    this.state.phase = 'LOBBY';
    this.compactSeats();
    this.ensureHost();
    this.log('新的一局已备好，等人齐便可开席。', 'system');

    const events: EngineEvent[] = [{ type: 'room:snapshot' }];
    this.maybeScheduleAutoStart(events);
    this.flush(events);
    return { ok: true, data: this.snapshot() };
  }

  /* ---------------- 同步与自愈 ---------------- */

  /**
   * 客户端 room:sync 时调用。
   * 如果服务端因为休眠等原因错过了回合超时，这里立刻补上自动博饼。
   */
  reconcile(): void {
    const turn = this.state.currentTurn;
    if (!turn) return;
    if (turn.status !== 'WAITING') return;
    if (turn.deadlineAt <= this.clock.now()) {
      this.executeRoll(true);
      return;
    }
    if (this.turnTimer === null) this.scheduleTurnTimeout();
  }

  sync(): GameSnapshot {
    this.reconcile();
    return this.snapshot();
  }

  /**
   * 校验 sessionToken 是否属于该座位。
   *
   * room:sync 走的是「socket 已经绑定到 playerId」这条路，
   * 光靠绑定关系是不够的——这里把「碰巧安全」变成显式检查，
   * 万一以后绑定逻辑改动，冒名的 sync 也会被挡住。
   */
  verifySession(playerId: string, sessionToken: string): boolean {
    const player = this.state.players.find((p) => p.id === playerId);
    return Boolean(player && player.sessionToken === sessionToken);
  }

  /** 仅供测试：直接读取内部状态。 */
  inspect(): {
    championPrizeGranted: boolean;
    processedActions: number;
    phase: Phase;
    stateVersion: number;
  } {
    return {
      championPrizeGranted: this.state.championPrizeGranted,
      processedActions: this.processedActions.size,
      phase: this.state.phase,
      stateVersion: this.stateVersion,
    };
  }

  /** 仅供测试：清空计时器，避免测试进程悬挂。 */
  dispose(): void {
    this.clearTurnTimer();
    this.clearAdvanceTimer();
    this.clearAutoStartTimer();
    this.clearAbandonTimer();
    for (const handle of this.ghostTimers.values()) this.clock.clearTimeout(handle);
    this.ghostTimers.clear();
  }
}

const ROLL_ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_FULL: '本桌已满',
  ROOM_NOT_FOUND: '找不到这一桌',
  ROOM_LIMIT_REACHED: '今晚的桌子已经开满了',
  GAME_ALREADY_STARTED: '本局已经开始了',
  NOT_ENOUGH_PLAYERS: '人数不足',
  NOT_HOST: '只有房主可以操作',
  NOT_YOUR_TURN: '还没轮到你',
  INVALID_TURN: '回合已经失效，正在同步最新状态',
  TURN_ALREADY_ROLLED: '这一把已经博过了',
  GAME_FINISHED: '本局已经结束',
  INVALID_SESSION: '身份失效，请刷新页面',
  INVALID_PAYLOAD: '请求格式不正确',
  NICKNAME_REQUIRED: '请先取个名字',
  INTERNAL_ERROR: '服务端开了个小差，请重试',
};

/** 会话令牌：足够长且不可预测，用于断线重连绑定原座位。 */
export function makeSessionToken(rng: Rng, salt: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i += 1) {
    out += chars[Math.floor(Math.min(0.9999999, Math.max(0, rng())) * chars.length)];
  }
  return `st_${salt.toString(36)}_${out}`;
}

export type { InternalPlayer, PrizeKey, ChampionState, InventoryState };
