/**
 * Socket.IO 事件处理。
 *
 * 这里只做四件事：
 *   1. 用 Zod 校验客户端 payload；
 *   2. 把请求路由到对应房间的 GameEngine；
 *   3. 把结果通过 ACK 返回；
 *   4. 广播。
 *
 * 任何业务规则都不写在这一层。
 *
 * 路由的依据是 socket 自己记住的 roomId（入席成功时写入 socket.data），
 * 而不是 payload —— 客户端只能在过闸那一刻选一次房间，之后所有动作
 * 都发生在同一张桌，没法在中途「跳到」别人的房间里去。
 */
import type { Server, Socket } from 'socket.io';
import {
  joinPayloadSchema,
  rollPayloadSchema,
  roomConfigSchema,
  sessionTokenSchema,
  setNicknamePayloadSchema,
  syncPayloadSchema,
} from '@bobing/shared';
import type {
  Ack,
  ClientToServerEvents,
  GameSnapshot,
  ServerToClientEvents,
  SiteStats,
} from '@bobing/shared';
import type { GameEngine } from '../game/GameEngine.js';
import type { PlayerManager } from '../room/PlayerManager.js';
import type { RoomManager } from '../room/RoomManager.js';
import type { SiteStats as SiteStatsService } from '../stats/SiteStats.js';
import { broadcastAll } from './broadcast.js';

type IO = Server<ClientToServerEvents, ServerToClientEvents>;
type Sock = Socket<ClientToServerEvents, ServerToClientEvents>;

/** 取这个 socket 当前所在房间的引擎；没入席过返回 undefined。 */
function engineOf(rooms: RoomManager, players: PlayerManager, socket: Sock): GameEngine | undefined {
  const binding = players.bindingOf(socket.id);
  if (!binding) return undefined;
  return rooms.get(binding.roomId);
}

/**
 * 组装当前统计。在线人数取「已入席且连接还在」的人数，不是裸连接数。
 *
 * 桌数取 `occupiedCount` 而不是 `rooms.size` —— 页脚写的是「N 桌开着」，
 * 那个 N 应当是「此刻有人坐在那儿的桌」，不是「房间里还留着几条记录」。
 */
function statsNow(rooms: RoomManager, players: PlayerManager, stats: SiteStatsService): SiteStats {
  return stats.snapshot(players.size, rooms.occupiedCount);
}

export function registerSocketHandlers(
  io: IO,
  rooms: RoomManager,
  players: PlayerManager,
  stats: SiteStatsService,
): void {
  const pushStats = (): void => {
    io.emit('stats:updated', { stats: statsNow(rooms, players, stats) });
  };

  /**
   * 房主走了 —— 这一桌作废，把所有人请出去。
   *
   * 为什么不做房主移交：这张桌是房主开的，房间码是他发出去的，牌局也是他
   * 起的头。换个人接手，剩下的人是在玩一局「主人已经走了」的牌，谁都不知道
   * 还该不该继续。不如干脆散伙，让剩下的人重新开一张桌来得清楚。
   *
   * 代价是明摆着的：房主刷新页面、切后台、手机息屏都会把全桌踢散。
   * 这是刻意的选择，不是疏漏。
   */
  function closeRoom(roomId: string, message: string): void {
    // 顺序不能反：等 socket 都退出了房间，这条通知就没人收得到了
    io.to(roomId).emit('room:closed', { roomId, reason: 'HOST_LEFT', message });
    // 座位凭证一并作废，否则客户端刷新后还会拿着旧 token 去进一个不存在的房间
    players.unbindRoom(roomId);
    io.in(roomId).socketsLeave(roomId);
    rooms.destroy(roomId);
  }

  /**
   * 走掉的那个人是不是房主？是的话整桌散伙。
   *
   * 这个判断必须在引擎做任何事**之前** —— 一旦调用了 engine.disconnect()，
   * ensureHost() 会立刻把房主移交给别人，再想问「刚走的这位是不是房主」，
   * 答案永远是「不是」。
   *
   * @returns true 表示这一桌已经被关掉，调用方不用再管座位了
   */
  function closeIfHostLeft(roomId: string, playerId: string, message: string): boolean {
    const engine = rooms.get(roomId);
    if (!engine || engine.hostId !== playerId) return false;
    closeRoom(roomId, message);
    return true;
  }

  /* ---------------- room:create ---------------- */

  io.on('connection', (socket: Sock) => {
    // 新连上的人先拿一份当前统计，不用等下一次事件
    socket.emit('stats:updated', { stats: statsNow(rooms, players, stats) });

    socket.on('room:create', (payload, ack) => {
      // 客户端不传 config 时 Socket.IO 会把 undefined 序列化成 null，
      // 所以这里用 nullish 而非 optional，避免「开一张新桌」误报配置错误。
      const parsed = roomConfigSchema.nullish().safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message ?? '奖品配置不正确',
        });
        return;
      }
      const created = rooms.create(parsed.data ?? undefined);
      if (!created.ok) {
        ack({ ok: false, error: 'ROOM_LIMIT_REACHED', message: created.message });
        return;
      }
      ack({ ok: true, data: { roomId: created.roomId } });
    });

    /* ---------------- room:join ---------------- */

    socket.on('room:join', (payload, ack) => {
      const parsed = joinPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message ?? '请求格式不正确',
        });
        return;
      }
      const { guestId, nickname, roomId } = parsed.data;
      const sessionToken = parsed.data.sessionToken ?? null;

      const engine = rooms.get(roomId);
      if (!engine) {
        // 不顺手建房：打错一个字母就凭空多出一间空房，人还会在里面干等
        ack({
          ok: false,
          error: 'ROOM_NOT_FOUND',
          message: '找不到这一桌，请检查房间码或邀请链接是否完整',
        });
        return;
      }

      // 必须在 players.bind() 之前读 —— bind 会把这条 socket 的旧绑定抹掉
      const previous = players.bindingOf(socket.id);

      const result = engine.join({ guestId, nickname, sessionToken, socketId: socket.id });
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }

      players.bind(socket.id, roomId, result.data.playerId);
      socket.data.playerId = result.data.playerId;
      socket.data.roomId = roomId;
      // 先离开可能待过的上一张桌，再进新桌 —— 换房时不会继续收到旧桌广播
      for (const room of socket.rooms) {
        if (room !== socket.id) socket.leave(room);
      }
      socket.join(roomId);

      // 换桌了：得回头告诉旧桌这个人走了。
      //
      // 少这一句的话，旧桌会永久留着一个「在线」的幽灵座位 —— 人明明在别桌玩，
      // 这边却还占着一个位子、人数也算他一份，而且因为 socket 已经退出了旧房间，
      // 旧桌的 disconnect 事件永远不会来，谁也清不掉他。
      if (previous && previous.roomId !== roomId) {
        if (!closeIfHostLeft(previous.roomId, previous.playerId, '房主换了别的桌，这一桌散了')) {
          const oldEngine = rooms.get(previous.roomId);
          if (oldEngine) {
            // 大厅里就直接退座；牌局进行中座位是定死的，只能标记离线，
            // 否则中途抽走一个座位会把这一局搅乱。
            if (oldEngine.snapshot().phase === 'LOBBY') oldEngine.leave(previous.playerId);
            else oldEngine.disconnect(previous.playerId);
          }
        }
        pushStats();
      }

      // 补一份快照给刚入席的这个人。
      //
      // 上面那句 engine.join() 已经广播过 room:playerJoined 了，但那一刻这个
      // socket 还没进房间，**收不到自己的入场广播** —— 别人都知道了，唯独
      // 当事人少一条。这里直接补一份权威快照，他就不用干等下一次广播。
      // 顺序不能反：先 engine.join 再 socket.join，是为了让入席失败时
      // （满员、身份冲突）完全不碰这个 socket 的房间归属，换桌失败不至于
      // 把人从原来的桌上踢下来。
      socket.emit('room:snapshot', { snapshot: engine.snapshot() });

      // 记一次到访。recordVisit 内部按 guestId 去重，只有真·新面孔才值得
      // 惊动所有人广播一次——同一个人的重连、换桌不该让全站刷屏。
      if (stats.recordVisit(guestId)) pushStats();

      ack({ ok: true, data: result.data });
    });

    /* ---------------- room:sync ---------------- */

    socket.on('room:sync', (payload, ack) => {
      const parsed = syncPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'INVALID_PAYLOAD', message: '请求格式不正确' });
        return;
      }
      const binding = players.bindingOf(socket.id);
      const engine = binding ? rooms.get(binding.roomId) : undefined;
      if (!binding || !engine) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '身份已失效，请重新入席' });
        return;
      }
      // 必须同时满足：这个 socket 已绑定座位，且它出示的 token 正是该座位的 token
      if (!engine.verifySession(binding.playerId, parsed.data.sessionToken)) {
        ack({
          ok: false,
          error: 'INVALID_SESSION',
          message: '身份已失效，请重新入席',
          snapshot: engine.snapshot(),
        });
        return;
      }
      ack({ ok: true, data: engine.sync() });
    });

    /* ---------------- player:setNickname ---------------- */

    socket.on('player:setNickname', (payload, ack) => {
      const binding = players.bindingOf(socket.id);
      const engine = binding ? rooms.get(binding.roomId) : undefined;
      if (!binding || !engine) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席' });
        return;
      }
      const parsed = setNicknamePayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: 'INVALID_PAYLOAD',
          message: parsed.error.issues[0]?.message ?? '昵称不合法',
        });
        return;
      }
      const result = engine.setNickname(binding.playerId, parsed.data.nickname);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- game:start ---------------- */

    socket.on('game:start', (_payload, ack) => {
      const engine = engineOf(rooms, players, socket);
      const binding = players.bindingOf(socket.id);
      if (!binding || !engine) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席' });
        return;
      }
      const result = engine.start(binding.playerId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- game:roll ---------------- */

    socket.on('game:roll', (payload, ack) => {
      const binding = players.bindingOf(socket.id);
      const engine = binding ? rooms.get(binding.roomId) : undefined;
      if (!binding || !engine) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席' });
        return;
      }
      const parsed = rollPayloadSchema.safeParse(payload);
      if (!parsed.success) {
        ack({
          ok: false,
          error: 'INVALID_PAYLOAD',
          message: '请求格式不正确',
          snapshot: engine.snapshot(),
        });
        return;
      }
      const { turnId, actionId } = parsed.data;
      const result = engine.roll(binding.playerId, turnId, actionId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      const snapshot: GameSnapshot = engine.snapshot();
      ack({ ok: true, data: { accepted: true, turnId, roll: result.data, snapshot } });
    });

    /* ---------------- game:restart ---------------- */

    socket.on('game:restart', (_payload, ack) => {
      const engine = engineOf(rooms, players, socket);
      const binding = players.bindingOf(socket.id);
      if (!binding || !engine) {
        ack({ ok: false, error: 'INVALID_SESSION', message: '请先入席' });
        return;
      }
      const result = engine.restart(binding.playerId);
      if (!result.ok) {
        ack({ ok: false, error: result.error, message: result.message, snapshot: engine.snapshot() });
        return;
      }
      ack({ ok: true, data: result.data });
    });

    /* ---------------- disconnect ---------------- */

    socket.on('disconnect', () => {
      const binding = players.unbindSocket(socket.id);
      if (!binding) return;
      // 房主断开 = 整桌散伙；其余人只让**这一张桌**知道有人掉线，别桌不受影响
      if (!closeIfHostLeft(binding.roomId, binding.playerId, '房主已离席，这一桌散了')) {
        rooms.get(binding.roomId)?.disconnect(binding.playerId);
      }
      // 在线人数和桌数都是全站的事，得让所有人知道
      pushStats();
    });
  });
}

export { sessionTokenSchema };
