/**
 * RoomManager —— 第一版只有一桌（MAIN_ROOM）。
 *
 * 保留这一层是为了让「以后开多桌」只需要改这一个文件，
 * 而不是把房间概念散落到 socket 层里。
 */
import { ROOM_ID } from '../config/gameConfig.js';
import { GameEngine } from '../game/GameEngine.js';
import type { EngineDeps } from '../game/GameEngine.js';

export class RoomManager {
  readonly roomId = ROOM_ID;
  readonly engine: GameEngine;

  constructor(deps: EngineDeps = {}) {
    this.engine = new GameEngine(deps);
  }

  /** 目前永远返回同一桌。 */
  getMainRoom(): GameEngine {
    return this.engine;
  }

  hasRoom(roomId: string): boolean {
    return roomId === this.roomId;
  }
}
