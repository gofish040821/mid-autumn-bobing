/**
 * 月满中秋 · 博饼 —— 服务端入口。
 *
 * 同时承担：
 *   - Socket.IO 实时通信（游戏主体）
 *   - 生产环境下托管 client/dist 静态文件
 *   - 局域网访问时打印可用地址（方便手机扫码进桌）
 */
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import { Server } from 'socket.io';
import {
  ROOM_ID,
  SERVER_PORT,
  MIN_PLAYERS,
  MAX_PLAYERS,
  MAX_ROOMS,
  TURN_TIMEOUT_MS,
  EMPTY_ROOM_TTL_MS,
} from './config/gameConfig.js';
import { RoomManager } from './room/RoomManager.js';
import { PlayerManager } from './room/PlayerManager.js';
import { registerSocketHandlers } from './socket/handlers.js';
import { broadcastAll } from './socket/broadcast.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  pingTimeout: 20_000,
  pingInterval: 10_000,
  maxHttpBufferSize: 1e6,
});

const players = new PlayerManager();

/**
 * 每建一张新桌，都给它接上「引擎事件 → 广播到该房间」这条线。
 *
 * makeEmitter 在构造时就交给 RoomManager，而不是事后 set ——
 * 后者要求「必须先 setEmitterFactory 再 create」，调用顺序错了
 * 就会出现「建了桌但所有人收不到广播」这种极难排查的静默故障。
 */
const rooms = new RoomManager({
  makeEmitter: (roomId) => (events, snapshot) => {
    broadcastAll(io as unknown as Server, roomId, events, snapshot);
  },
});

registerSocketHandlers(io, rooms, players);

/* ---------------- HTTP ---------------- */

/** 全部房间的概览，运维用。不暴露给玩家界面。 */
app.get('/api/rooms', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.list(),
    total: rooms.size,
    maxRooms: MAX_ROOMS,
    sockets: players.size,
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    rooms: rooms.size,
    sockets: players.size,
    maxRooms: MAX_ROOMS,
    uptimeMs: Math.round(process.uptime() * 1000),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    turnTimeoutMs: TURN_TIMEOUT_MS,
  });
});

/**
 * 房间回收扫描。
 *
 * 用 unref() 是为了不因为这个定时器把进程吊住 —— 测试环境里
 * import 这个模块后可以正常退出。
 */
const sweepTimer = setInterval(() => {
  const reaped = rooms.sweep();
  if (reaped > 0) console.log(`[rooms] 回收了 ${reaped} 张空桌，现存 ${rooms.size} 张`);
}, Math.max(5_000, Math.floor(EMPTY_ROOM_TTL_MS / 4)));
sweepTimer.unref();

/** 生产环境：托管打包好的前端。开发环境用 Vite 的 dev server。 */
const clientDist = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/(api|socket\.io)).*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

/* ---------------- 启动 ---------------- */

function localAddresses(): string[] {
  const out: string[] = [];
  for (const infos of Object.values(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal) out.push(info.address);
    }
  }
  return out;
}

server.listen(SERVER_PORT, '0.0.0.0', () => {
  const lines = [
    '',
    '  ☾  月满中秋 · 博饼  —— 服务端已开席',
    `     本机：   http://localhost:${SERVER_PORT}`,
    ...localAddresses().map((ip) => `     局域网： http://${ip}:${SERVER_PORT}   ← 手机用这个（开发模式请用 5173 端口）`),
    '',
  ];
  console.log(lines.join('\n'));
});

function shutdown(): void {
  clearInterval(sweepTimer);
  rooms.disposeAll();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, server, io, rooms, players, ROOM_ID };
