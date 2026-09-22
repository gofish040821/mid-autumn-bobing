/**
 * Socket.IO 客户端封装。
 *
 * 只负责「发请求、收 ACK」，不含任何游戏逻辑。
 * 连接地址一律走「同源」——这是唯一在全部部署形态下都成立的假设。
 */
import { io, type Socket } from 'socket.io-client';
import type {
  Ack,
  ClientToServerEvents,
  GameSnapshot,
  JoinPayload,
  JoinResult,
  PlayerState,
  RollAck,
  ServerToClientEvents,
} from '@bobing/shared';

export type GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 10_000;

let socket: GameSocket | null = null;

export function getSocket(): GameSocket {
  if (socket) return socket;

  /**
   * 同源在四种部署形态下都成立，所以这里不需要任何 hostname 判断：
   *   - 开发：页面在 Vite 的 5173，`/socket.io` 由 vite.config.ts 的 proxy 转发到 3001；
   *   - 生产：Express 同一个进程既发静态页又挂 Socket.IO，本来就是同一个源；
   *   - 局域网：手机打开 http://<内网IP>:3001，页面和服务端同源；
   *   - 云端：平台（Render 等）只暴露 443 上的一个域名，也是同源。
   *
   * 曾经这里写的是「不是 localhost 就直连 `:3001`」。那个假设只在局域网下成立，
   * 一上云就必然连不上——平台给的地址是 https 域名，没有 3001 这个端口，
   * 于是页面能打开、能画，但永远卡在连接中。这个 bug 在本地怎么测都测不出来，
   * 因为本地永远命中 localhost 那一支。
   *
   * 只有前后端分域部署（前端在 CDN、后端在别处）才需要显式配 VITE_SERVER_URL，
   * 那时它会覆盖同源默认值。
   */
  const url = import.meta.env.VITE_SERVER_URL as string | undefined;

  socket = io(url, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 600,
    reconnectionDelayMax: 5_000,
    randomizationFactor: 0.4,
    timeout: 12_000,
    autoConnect: true,
  }) as GameSocket;

  return socket;
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

/** 统一处理带超时的 ACK。 */
function withAck<T>(
  run: (cb: (err: Error | null, res: Ack<T>) => void) => void,
  timeoutMessage = '连接超时，请检查网络后重试',
): Promise<Ack<T>> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, error: 'INTERNAL_ERROR', message: timeoutMessage });
    }, ACK_TIMEOUT_MS + 2000);

    run((err, res) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (err) {
        resolve({ ok: false, error: 'INTERNAL_ERROR', message: timeoutMessage });
        return;
      }
      resolve(res);
    });
  });
}

export function emitJoin(payload: JoinPayload): Promise<Ack<JoinResult>> {
  return withAck<JoinResult>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('room:join', payload, cb);
  }, '入席超时，请重试');
}

export function emitSync(sessionToken: string): Promise<Ack<GameSnapshot>> {
  return withAck<GameSnapshot>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('room:sync', { sessionToken }, cb);
  });
}

export function emitSetNickname(nickname: string): Promise<Ack<PlayerState>> {
  return withAck<PlayerState>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('player:setNickname', { nickname }, cb);
  });
}

export function emitStart(): Promise<Ack<GameSnapshot>> {
  return withAck<GameSnapshot>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('game:start', undefined, cb);
  });
}

export function emitRestart(): Promise<Ack<GameSnapshot>> {
  return withAck<GameSnapshot>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('game:restart', undefined, cb);
  });
}

export function emitRoll(turnId: string, actionId: string): Promise<Ack<RollAck>> {
  return withAck<RollAck>((cb) => {
    getSocket().timeout(ACK_TIMEOUT_MS).emit('game:roll', { turnId, actionId }, cb);
  });
}
