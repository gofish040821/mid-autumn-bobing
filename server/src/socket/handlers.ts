/**
 * Socket.IO 事件处理。
 *
 * 这里只做三件事：
 *   1. 用 Zod 校验客户端 payload；
 *   2. 把请求转交给 GameEngine；
 *   3. 把结果通过 ACK 返回。
 *
 * 任何业务规则都不写在这一层。
 */
import type { Server, Socket } from 'socket.io';
import {
  joinPayloadSchema,
  rollPayloadSchema,
  sessionTokenSchema,
  setNicknamePayloadSchema,
  syncPayloadSchema,
  MAIN_ROOM_ID,
} from '@bobing/shared';
import type { Ack, ClientToServerEvents, GameSnapshot, ServerToClientEvents } from '@bobing/shared';
import type { GameEngine } from '../game/GameEngine.js';
import type { PlayerManager } from '../room/PlayerManager.js';
import { broadcastAll } from './broadcast.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerSocketHandlers(io: IO, engine: GameEngine, players: PlayerManager): void {
  // 引擎产生的事件 → 广播给全桌
  engine.setEmitter((events, snapshot) => {
    broadcastAll(io as unknown as Server, MAIN_ROOM_ID, events, snapshot);
  });

  io.on('connection', (socket: Sock) => {
    socket.join(MAIN_ROOM_ID);

    /* ---------------- room:join ---------------- */
    socket.on('room:join', (payload, ack) => {
      const parsed = joinPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message ?? '请求格式不正确' });
        return;
      }
      const { guestId, nickname } = parsed.data;
      const sessionToken = parsed.data.sessionToken ?? null;

      const result = engine.join({ guestId, nickname, sessionToken, socketId: socket.id });
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      players.bind(socket.id, result.data.playerId);
      socket.data.playerId = result.data.playerId;
      socket.data.roomId = MAIN_ROOM_ID;
      ack({ ok: true, data: result.data });
    });

    /* ---------------- room:sync ---------------- */
    socket.on('room:sync', (payload, ack) => {
      const parsed = syncPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'INVALID_PAYLOAD', message: '请求格式不正确' });
        return;
      }
      const snapshot = engine.snapshot();
      const playerId = players.playerIdOf(socket.id);
      // 必须同时满足：这个 socket 已绑定座位，且它出示的 token 正是该座位的 token
      if (!playerId || !engine.verifySession(playerId, parsed.data.sessionToken)) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '身份已失效，请重新入席', snapshot });
        return;
      }
      ack({ ok: true, data: engine.sync() });
    });

    /* ---------------- player:setNickname ---------------- */
    socket.on('player:setNickname', (payload, ack) => {
      const playerId = players.playerIdOf(socket.id);
      if (!playerId) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席', snapshot: engine.snapshot() });
        return;
      }
      const parsed = setNicknamePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'INVALID_PAYLOAD', message: parsed.error.issues[0]?.message ?? '昵称不合法' });
        return;
      }
      const result = engine.setNickname(playerId, parsed.data.nickname);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- game:start ---------------- */
    socket.on('game:start', (_payload, ack) => {
      const playerId = players.playerIdOf(socket.id);
      if (!playerId) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席', snapshot: engine.snapshot() });
        return;
      }
      const result = engine.start(playerId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- game:roll ---------------- */
    socket.on('game:roll', (payload, ack) => {
      const playerId = players.playerIdOf(socket.id);
      if (!playerId) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席', snapshot: engine.snapshot() });
        return;
      }
      const parsed = rollPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'INVALID_PAYLOAD', message: '请求格式不正确', snapshot: engine.snapshot() });
        return;
      }
      const { turnId, actionId } = parsed.data;
      const result = engine.roll(playerId, turnId, actionId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      const snapshot: GameSnapshot = engine.snapshot();
      ack({ ok: true, data: { accepted: true, turnId, roll: result.data, snapshot } });
    });

    /* ---------------- game:restart ---------------- */
    socket.on('game:restart', (_payload, ack) => {
      const playerId = players.playerIdOf(socket.id);
      if (!playerId) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席', snapshot: engine.snapshot() });
        return;
      }
      const result = engine.restart(playerId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- disconnect ---------------- */
    socket.on('disconnect', () => {
      const playerId = players.unbindSocket(socket.id);
      if (playerId) engine.disconnect(playerId);
    });
  });
}

export { sessionTokenSchema };
