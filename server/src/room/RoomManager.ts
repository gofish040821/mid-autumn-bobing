/**
 * RoomManager —— 按房间码管理多张牌桌。
 *
 * 每张桌就是一个自包含的 GameEngine 实例：自己的玩家、自己的骰子、
 * 自己的计时器、自己的库存。桌与桌之间没有任何共享状态，所以
 * 「A 桌在追状元」和「B 桌刚开席」互不干扰。
 *
 * 房间是**按需创建**的：第一次有人 `createRoom()` 才建，空置两分钟后回收。
 * 没有「预建一批房间」这回事，也就没有「房间池被占满」的问题。
 */
import { EMPTY_ROOM_TTL_MS, MAX_ROOMS, ROOM_ID } from '../config/gameConfig.js';
import { generateRoomCode } from '@bobing/shared';
import { systemClock } from '../game/Clock.js';
import type { Clock } from '../game/Clock.js';
import { GameEngine } from '../game/GameEngine.js';
import type { EngineDeps, EngineEmitter } from '../game/GameEngine.js';
import type { Rng } from '../game/DiceService.js';

export interface RoomManagerDeps {
  clock?: Clock;
  rng?: Rng;
  /** 为新建的房间装配广播回调（socket 层注入）。 */
  makeEmitter?: (roomId: string) => EngineEmitter;
}

interface RoomEntry {
  engine: GameEngine;
  /**
   * 这张桌第一次变成「空大厅」的时刻；不为空时为 null。
   *
   * 用「记时间戳 + 定时扫描」而不是「每桌一个回收定时器」，
   * 是因为后者会在反复创建/回收中积攒大量定时器句柄。
   */
  emptiedAt: number | null;
}

export type CreateRoomResult =
  | { ok: true; roomId: string; engine: GameEngine }
  | { ok: false; message: string };

/** 房间码撞车的重试次数。31^5 的空间里，撞两次基本只可能是 rng 被写死了。 */
const CODE_ATTEMPTS = 8;

export class RoomManager {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly makeEmitter: ((roomId: string) => EngineEmitter) | undefined;
  private readonly deps: EngineDeps;

  constructor(deps: RoomManagerDeps = {}) {
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.makeEmitter = deps.makeEmitter;
    this.deps = { clock: this.clock, rng: this.rng };
  }

  get size(): number {
    return this.rooms.size;
  }

  has(roomId: string): boolean {
    return this.rooms.has(roomId);
  }

  /** 取一张已存在的桌；不存在返回 undefined（不顺手创建）。 */
  get(roomId: string): GameEngine | undefined {
    return this.rooms.get(roomId)?.engine;
  }

  /**
   * 开一张新桌。房间码由服务端生成并保证不与现存房间重复。
   * 达到 MAX_ROOMS 时拒绝，避免被脚本拉到进程撑爆。
   */
  create(): CreateRoomResult {
    if (this.rooms.size >= MAX_ROOMS) {
      return { ok: false, message: '今晚的桌子已经开满了，请稍后再试' };
    }

    for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
      const roomId = generateRoomCode(this.rng);
      if (this.rooms.has(roomId)) continue;

      const engine = new GameEngine({ ...this.deps, roomId });
      if (this.makeEmitter) engine.setEmitter(this.makeEmitter(roomId));
      this.rooms.set(roomId, { engine, emptiedAt: null });
      return { ok: true, roomId, engine };
    }

    return { ok: false, message: '房间码分配失败，请重试' };
  }

  /**
   * 回收闲置的空房间。
   *
   * 只回收「大厅里一个人都没有」的桌：
   *   - 牌局进行中的桌即使全员掉线也不会走到这里 —— 引擎自己有
   *     ABANDON_GRACE_MS 的散场判定，作废回大厅、清空玩家后才轮到这里；
   *   - 大厅里还有人的桌一律不动。
   *
   * 需要连续两次扫描都为空才真的回收，中间那段时间用来兜住
   * 「创建房间」到「朋友点进链接」的空窗期。
   */
  sweep(now: number = this.clock.now()): number {
    let reaped = 0;
    for (const [roomId, entry] of this.rooms) {
      const empty = entry.engine.playerCount === 0 && entry.engine.phase === 'LOBBY';
      if (!empty) {
        entry.emptiedAt = null;
        continue;
      }
      if (entry.emptiedAt === null) {
        entry.emptiedAt = now;
        continue;
      }
      if (now - entry.emptiedAt >= EMPTY_ROOM_TTL_MS) {
        entry.engine.dispose();
        this.rooms.delete(roomId);
        reaped += 1;
      }
    }
    return reaped;
  }

  /** 所有房间的只读概览，给运维接口和调试用。 */
  list(): Array<{ roomId: string; phase: string; players: number; online: number }> {
    const out: Array<{ roomId: string; phase: string; players: number; online: number }> = [];
    for (const [roomId, entry] of this.rooms) {
      const snapshot = entry.engine.snapshot();
      out.push({
        roomId,
        phase: snapshot.phase,
        players: snapshot.players.length,
        online: snapshot.players.filter((p) => p.online).length,
      });
    }
    return out;
  }

  /** 进程退出时清空所有房间的计时器。 */
  disposeAll(): void {
    for (const entry of this.rooms.values()) entry.engine.dispose();
    this.rooms.clear();
  }

  /**
   * 默认房间（`MAIN_ROOM`）。现在没有玩家会用它，保留是为了两类场景：
   * 单测直接拿一个确定的房间、以及本地想开一张固定房间码的桌来调试。
   */
  getMainRoom(): GameEngine {
    const existing = this.rooms.get(ROOM_ID);
    if (existing) return existing.engine;
    const engine = new GameEngine({ ...this.deps, roomId: ROOM_ID });
    if (this.makeEmitter) engine.setEmitter(this.makeEmitter(ROOM_ID));
    this.rooms.set(ROOM_ID, { engine, emptiedAt: null });
    return engine;
  }
}
