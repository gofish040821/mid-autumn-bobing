/**
 * 把 EngineEvent 翻译成 Socket.IO 广播。
 *
 * 每个事件都携带完整 snapshot，客户端任何一次丢包都会被下一次广播自愈。
 */
import type { Server } from 'socket.io';
import type { GameSnapshot } from '@bobing/shared';
import type { EngineEvent } from '../game/GameEngine.js';

export function broadcastEvent(io: Server, roomId: string, event: EngineEvent, snapshot: GameSnapshot): void {
  const target = io.to(roomId);
  switch (event.type) {
    case 'room:snapshot':
      target.emit('room:snapshot', { snapshot });
      break;
    case 'room:playerJoined':
      target.emit('room:playerJoined', { snapshot, player: event.player });
      break;
    case 'room:playerLeft':
      target.emit('room:playerLeft', { snapshot, playerId: event.playerId });
      break;
    case 'room:playerDisconnected':
      target.emit('room:playerDisconnected', { snapshot, playerId: event.playerId });
      break;
    case 'room:playerReconnected':
      target.emit('room:playerReconnected', { snapshot, playerId: event.playerId });
      break;
    case 'game:started':
      target.emit('game:started', { snapshot });
      break;
    case 'turn:changed':
      target.emit('turn:changed', { snapshot });
      break;
    case 'roll:started':
      target.emit('roll:started', {
        snapshot,
        turnId: event.turnId,
        playerId: event.playerId,
        seat: event.seat,
        auto: event.auto,
      });
      break;
    case 'roll:result':
      target.emit('roll:result', { snapshot, roll: event.roll });
      break;
    case 'inventory:updated':
      target.emit('inventory:updated', { snapshot });
      break;
    case 'score:updated':
      target.emit('score:updated', { snapshot });
      break;
    case 'champion:started':
      target.emit('champion:started', { snapshot });
      break;
    case 'champion:updated':
      target.emit('champion:updated', {
        snapshot,
        replaced: event.replaced,
        previousNickname: event.previousNickname,
      });
      break;
    case 'champion:queueUpdated':
      target.emit('champion:queueUpdated', { snapshot });
      break;
    case 'game:finished':
      target.emit('game:finished', { snapshot });
      break;
  }
}

export function broadcastAll(io: Server, roomId: string, events: EngineEvent[], snapshot: GameSnapshot): void {
  for (const event of events) broadcastEvent(io, roomId, event, snapshot);
}
