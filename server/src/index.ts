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
import { ROOM_ID, SERVER_PORT, MIN_PLAYERS, MAX_PLAYERS, TURN_TIMEOUT_MS } from './config/gameConfig.js';
import { RoomManager } from './room/RoomManager.js';
import { PlayerManager } from './room/PlayerManager.js';
import { registerSocketHandlers } from './socket/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());

const rooms = new RoomManager();
const players = new PlayerManager();
const engine = rooms.getMainRoom();

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: true },
  pingTimeout: 20_000,
  pingInterval: 10_000,
  maxHttpBufferSize: 1e6,
});

registerSocketHandlers(io, engine, players);

/* ---------------- HTTP ---------------- */

app.get('/api/health', (_req, res) => {
  const snapshot = engine.snapshot();
  res.json({
    ok: true,
    roomId: ROOM_ID,
    phase: snapshot.phase,
    players: snapshot.players.length,
    stateVersion: snapshot.stateVersion,
    uptimeMs: Math.round(process.uptime() * 1000),
  });
});

app.get('/api/config', (_req, res) => {
  res.json({
    roomId: ROOM_ID,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    turnTimeoutMs: TURN_TIMEOUT_MS,
  });
});

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
  engine.dispose();
  io.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

export { app, server, io, engine };
