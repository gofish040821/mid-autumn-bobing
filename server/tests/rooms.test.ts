/**
 * 多房间测试。
 *
 * 这一组测试真正要守住的是**桌与桌之间不能串味**：
 *   - A 桌掷骰不会出现在 B 桌；
 *   - A 桌的 `player_0001` 和 B 桌的 `player_0001` 是两个完全不同的人，
 *     绑定关系不能互相覆盖（这是多房间改造里最隐蔽的一处）；
 *   - 空桌会被回收，有人的桌一律不动。
 */
import { describe, expect, it } from 'vitest';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '@bobing/shared';

import { EMPTY_ROOM_TTL_MS, MAX_ROOMS, ROOM_ID } from '../src/config/gameConfig';
import { FakeClock } from '../src/game/Clock';
import { GameEngine } from '../src/game/GameEngine';
import type { EngineEvent } from '../src/game/GameEngine';
import { PlayerManager } from '../src/room/PlayerManager';
import { RoomManager } from '../src/room/RoomManager';

/* ------------------------------------------------------------------ *
 * 脚手架
 * ------------------------------------------------------------------ */

/**
 * 确定性伪随机。
 *
 * 这里**不能**用「固定返回一个值」的 rng —— 房间码是 5 位字符，
 * 固定值意味着每次生成的码完全一样，第二张桌必然撞车、重试到放弃。
 * 用 LCG 保证可复现的同时，连续取值是分散的。
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Bench {
  rooms: RoomManager;
  players: PlayerManager;
  clock: FakeClock;
  /** 每个房间收到的广播，按房间分桶 —— 用来断言「没串台」。 */
  emitted: Map<string, EngineEvent[]>;
}

function createBench(): Bench {
  const clock = new FakeClock();
  const emitted = new Map<string, EngineEvent[]>();

  const rooms = new RoomManager({
    clock,
    rng: lcg(20240915),
    makeEmitter: (roomId) => (events) => {
      const bucket = emitted.get(roomId) ?? [];
      bucket.push(...events);
      emitted.set(roomId, bucket);
    },
  });

  return { rooms, players: new PlayerManager(), clock, emitted };
}

/** 在指定房间入席一个人。 */
function joinRoom(
  engine: GameEngine,
  guestId: string,
  nickname: string,
  socketId: string,
): { playerId: string; token: string } {
  const res = engine.join({ guestId, nickname, sessionToken: null, socketId });
  if (!res.ok) throw new Error(`join failed: ${res.error} ${res.message}`);
  return { playerId: res.data.playerId, token: res.data.sessionToken };
}

/* ------------------------------------------------------------------ *
 * 房间码
 * ------------------------------------------------------------------ */

describe('房间码', () => {
  it(`默认长度 ${ROOM_CODE_LENGTH}，且只含无歧义字符`, () => {
    for (let seed = 0; seed < 500; seed += 1) {
      const code = generateRoomCode(() => (seed % 31) / 31);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      for (const ch of code) expect(ROOM_CODE_ALPHABET).toContain(ch);
    }
  });

  it('字符集里没有 0 O 1 I L —— 口头报码不会听错', () => {
    for (const ch of '01OIL') expect(ROOM_CODE_ALPHABET).not.toContain(ch);
  });

  it('rng 返回越界值或 NaN 时不会生成出 undefined', () => {
    for (const bad of [1, 1.5, -1, -0.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const code = generateRoomCode(() => bad);
      expect(code).toHaveLength(ROOM_CODE_LENGTH);
      expect(isValidRoomCode(code)).toBe(true);
    }
  });

  it('rng 为 0 与接近 1 时分别取到字符集的两端', () => {
    expect(generateRoomCode(() => 0)).toBe(ROOM_CODE_ALPHABET[0]!.repeat(ROOM_CODE_LENGTH));
    expect(generateRoomCode(() => 0.9999999)).toBe(
      ROOM_CODE_ALPHABET[ROOM_CODE_ALPHABET.length - 1]!.repeat(ROOM_CODE_LENGTH),
    );
  });

  it('规整：去空白、转大写', () => {
    expect(normalizeRoomCode(' 7k3f ')).toBe('7K3F');
    expect(normalizeRoomCode('7 K 3 F')).toBe('7K3F');
  });

  it('长度不对、含歧义字符、含中文都会被判为不合法', () => {
    for (const bad of ['', '7K3', '7K3F', '7K3FFZ', '7K3F0', 'OOOOO', '月下客', '7K3F!']) {
      expect(isValidRoomCode(bad)).toBe(false);
    }
    // 合法样例用的都是字符集里真实存在的字符，避免「测试数据本身就不对」的假失败
    expect(isValidRoomCode('7K3FZ')).toBe(true);
    expect(isValidRoomCode('22222')).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * RoomManager
 * ------------------------------------------------------------------ */

describe('RoomManager · 建房与取房', () => {
  it('create 出来的房间可以立刻 get 到，且房间码就是它的 roomId', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect(isValidRoomCode(created.roomId)).toBe(true);
    expect(b.rooms.has(created.roomId)).toBe(true);
    expect(b.rooms.get(created.roomId)).toBe(created.engine);
    expect(created.engine.snapshot().roomId).toBe(created.roomId);
    created.engine.dispose();
  });

  it('不存在的房间返回 undefined —— 不会顺手建一个', () => {
    const b = createBench();
    expect(b.rooms.get('ZZZZZ')).toBeUndefined();
    expect(b.rooms.has('ZZZZZ')).toBe(false);
    // 「查一下」不应该产生副作用
    expect(b.rooms.size).toBe(0);
  });

  it('每次 create 都拿到不同的房间码', () => {
    const b = createBench();
    const codes = new Set<string>();
    for (let i = 0; i < 50; i += 1) {
      const created = b.rooms.create();
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      codes.add(created.roomId);
    }
    expect(codes.size).toBe(50);
    expect(b.rooms.size).toBe(50);
    b.rooms.disposeAll();
  });

  it('房间码撞车时会重试，不会覆盖已有的桌', () => {
    const b = createBench();
    // 前几次 rng 固定 → 生成同一个码；只有最后一次挪动才拿到新码
    let call = 0;
    const colliding = new RoomManager({
      clock: b.clock,
      rng: () => {
        call += 1;
        // 每 5 次调用为一轮（每个码用掉 5 个 rng），前两轮生成相同字符
        return call <= 10 ? 0 : 0.5;
      },
    });

    const first = colliding.create();
    const second = colliding.create();
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.roomId).not.toBe(first.roomId);
    expect(colliding.size).toBe(2);
    // 原来那张桌还在，没有被后来者顶掉
    expect(colliding.get(first.roomId)).toBe(first.engine);
    // 而且第一张桌的引擎没有被 dispose
    expect(first.engine.snapshot().roomId).toBe(first.roomId);
    colliding.disposeAll();
  });

  it(`房间数达到上限 ${MAX_ROOMS} 时拒绝新建，并给出可读的提示`, () => {
    const b = createBench();
    for (let i = 0; i < MAX_ROOMS; i += 1) {
      const created = b.rooms.create();
      if (!created.ok) throw new Error(`第 ${i + 1} 个房间就不让建了：${created.message}`);
    }
    expect(b.rooms.size).toBe(MAX_ROOMS);

    const overflow = b.rooms.create();
    expect(overflow.ok).toBe(false);
    if (overflow.ok) return;
    expect(overflow.message).toContain('开满');
    expect(b.rooms.size).toBe(MAX_ROOMS);
    b.rooms.disposeAll();
  });

  it('默认房间（MAIN_ROOM）仍然可以按需取到，且只建一次', () => {
    const b = createBench();
    const first = b.rooms.getMainRoom();
    const second = b.rooms.getMainRoom();
    expect(first).toBe(second);
    expect(first.snapshot().roomId).toBe(ROOM_ID);
    b.rooms.disposeAll();
  });
});

/* ------------------------------------------------------------------ *
 * 桌与桌之间不能串味
 * ------------------------------------------------------------------ */

describe('多房间 · 互相隔离', () => {
  it('两张桌的玩家、库存、状态各归各的', () => {
    const b = createBench();
    const a = b.rooms.create();
    const c = b.rooms.create();
    expect(a.ok && c.ok).toBe(true);
    if (!a.ok || !c.ok) return;

    joinRoom(a.engine, 'guest_a1', '甲客', 'sock_a1');
    joinRoom(a.engine, 'guest_a2', '乙客', 'sock_a2');
    joinRoom(c.engine, 'guest_c1', '丙客', 'sock_c1');

    expect(a.engine.playerCount).toBe(2);
    expect(c.engine.playerCount).toBe(1);

    expect(a.engine.snapshot().players.map((p) => p.nickname)).toEqual(['甲客', '乙客']);
    expect(c.engine.snapshot().players.map((p) => p.nickname)).toEqual(['丙客']);

    a.engine.dispose();
    c.engine.dispose();
  });

  it('一桌开席不影响另一桌仍在候席', () => {
    const b = createBench();
    const a = b.rooms.create();
    const c = b.rooms.create();
    expect(a.ok && c.ok).toBe(true);
    if (!a.ok || !c.ok) return;

    const a1 = joinRoom(a.engine, 'guest_a1', '甲客', 'sock_a1');
    const a2 = joinRoom(a.engine, 'guest_a2', '乙客', 'sock_a2');
    joinRoom(c.engine, 'guest_c1', '丙客', 'sock_c1');

    const started = a.engine.start(a1.playerId);
    expect(started.ok).toBe(true);
    expect(a.engine.phase).toBe('NORMAL_TURN');

    // 另一桌纹丝不动
    expect(c.engine.phase).toBe('LOBBY');
    expect(c.engine.snapshot().currentTurn).toBeNull();

    a.engine.dispose();
    c.engine.dispose();
    expect(a2.playerId).toBeTruthy();
  });

  it('广播只发给本桌 —— A 桌的事件不会出现在 B 桌的桶里', () => {
    const b = createBench();
    const a = b.rooms.create();
    const c = b.rooms.create();
    expect(a.ok && c.ok).toBe(true);
    if (!a.ok || !c.ok) return;

    joinRoom(a.engine, 'guest_a1', '甲客', 'sock_a1');
    joinRoom(c.engine, 'guest_c1', '丙客', 'sock_c1');

    const aEvents = b.emitted.get(a.roomId) ?? [];
    const cEvents = b.emitted.get(c.roomId) ?? [];

    expect(aEvents.length).toBeGreaterThan(0);
    expect(cEvents.length).toBeGreaterThan(0);
    // 两桌的事件是分开发出去的，没有混在一起
    expect(b.emitted.size).toBe(2);

    a.engine.dispose();
    c.engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 身份绑定必须带房间维度
 * ------------------------------------------------------------------ */

describe('PlayerManager · 房间维度的身份绑定', () => {
  it('两张桌各自的 player_0001 是两个人，绑定互不覆盖', () => {
    const players = new PlayerManager();

    // 这正是多房间最容易写错的地方：两个引擎各自从 1 开始编号
    const shared = 'player_0001';
    players.bind('sock_a', 'AAAAA', shared);
    players.bind('sock_c', 'CCCCC', shared);

    expect(players.bindingOf('sock_a')).toEqual({ roomId: 'AAAAA', playerId: shared });
    expect(players.bindingOf('sock_c')).toEqual({ roomId: 'CCCCC', playerId: shared });
    expect(players.size).toBe(2);
  });

  it('两个房间的座位各自记住自己的 socket', () => {
    const players = new PlayerManager();
    players.bind('sock_a', 'AAAAA', 'player_0001');
    players.bind('sock_c', 'CCCCC', 'player_0001');

    expect(players.socketIdOf('AAAAA', 'player_0001')).toBe('sock_a');
    expect(players.socketIdOf('CCCCC', 'player_0001')).toBe('sock_c');
  });

  it('解开一个房间的绑定，不会波及同名座位的另一个房间', () => {
    const players = new PlayerManager();
    players.bind('sock_a', 'AAAAA', 'player_0001');
    players.bind('sock_c', 'CCCCC', 'player_0001');

    expect(players.unbindSocket('sock_a')).toEqual({ roomId: 'AAAAA', playerId: 'player_0001' });

    expect(players.bindingOf('sock_a')).toBeUndefined();
    expect(players.socketIdOf('AAAAA', 'player_0001')).toBeUndefined();
    // B 桌那位还在
    expect(players.bindingOf('sock_c')).toEqual({ roomId: 'CCCCC', playerId: 'player_0001' });
    expect(players.socketIdOf('CCCCC', 'player_0001')).toBe('sock_c');
  });

  it('同一个座位重连换 socket 时，旧连接会被摘掉', () => {
    const players = new PlayerManager();
    players.bind('sock_old', 'AAAAA', 'player_0001');
    players.bind('sock_new', 'AAAAA', 'player_0001');

    expect(players.bindingOf('sock_old')).toBeUndefined();
    expect(players.bindingOf('sock_new')).toEqual({ roomId: 'AAAAA', playerId: 'player_0001' });
    expect(players.socketIdOf('AAAAA', 'player_0001')).toBe('sock_new');
    expect(players.size).toBe(1);
  });

  it('同一个 socket 换到别的房间时，旧房间的座位会被摘掉', () => {
    const players = new PlayerManager();
    players.bind('sock_1', 'AAAAA', 'player_0001');
    players.bind('sock_1', 'CCCCC', 'player_0001');

    expect(players.bindingOf('sock_1')).toEqual({ roomId: 'CCCCC', playerId: 'player_0001' });
    expect(players.socketIdOf('AAAAA', 'player_0001')).toBeUndefined();
    expect(players.size).toBe(1);
  });

  it('countInRoom 只数本房间的连接', () => {
    const players = new PlayerManager();
    players.bind('sock_a1', 'AAAAA', 'player_0001');
    players.bind('sock_a2', 'AAAAA', 'player_0002');
    players.bind('sock_c1', 'CCCCC', 'player_0001');

    expect(players.countInRoom('AAAAA')).toBe(2);
    expect(players.countInRoom('CCCCC')).toBe(1);
    expect(players.countInRoom('ZZZZZ')).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 空房间回收
 * ------------------------------------------------------------------ */

describe('RoomManager · 空房间回收', () => {
  it('有人的桌不会被回收', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    joinRoom(created.engine, 'guest_1', '客一', 'sock_1');

    // 推进远超 TTL 的时间，反复扫描
    for (let i = 0; i < 10; i += 1) {
      b.clock.advance(EMPTY_ROOM_TTL_MS);
      b.rooms.sweep();
    }
    expect(b.rooms.has(created.roomId)).toBe(true);
    created.engine.dispose();
  });

  it('空桌要连续两次扫描都为空才回收 —— 中间那段时间留给「创建 → 朋友点进来」', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // 第一次扫描只是记下「它空了」，不回收
    expect(b.rooms.sweep()).toBe(0);
    expect(b.rooms.has(created.roomId)).toBe(true);

    // 时间没走够，还是不回收
    b.clock.advance(EMPTY_ROOM_TTL_MS - 1);
    expect(b.rooms.sweep()).toBe(0);
    expect(b.rooms.has(created.roomId)).toBe(true);

    // 时间走够 → 回收
    b.clock.advance(1);
    expect(b.rooms.sweep()).toBe(1);
    expect(b.rooms.has(created.roomId)).toBe(false);
  });

  it('空桌中途来了人就不会被回收', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    b.rooms.sweep(); // 记下空置状态
    b.clock.advance(EMPTY_ROOM_TTL_MS - 1);

    // 朋友正好在这时点进了链接
    joinRoom(created.engine, 'guest_1', '客一', 'sock_1');

    b.clock.advance(EMPTY_ROOM_TTL_MS);
    expect(b.rooms.sweep()).toBe(0);
    expect(b.rooms.has(created.roomId)).toBe(true);
    created.engine.dispose();
  });

  it('牌局进行中的桌即使一个人都不在线也不会被回收', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p1 = joinRoom(created.engine, 'guest_1', '客一', 'sock_1');
    const p2 = joinRoom(created.engine, 'guest_2', '客二', 'sock_2');
    expect(created.engine.start(p1.playerId).ok).toBe(true);
    expect(created.engine.phase).toBe('NORMAL_TURN');

    // 两个人都掉线
    created.engine.disconnect(p1.playerId);
    created.engine.disconnect(p2.playerId);
    expect(created.engine.snapshot().players.every((p) => !p.online)).toBe(true);

    // 引擎自己有散场判定（ABANDON_GRACE_MS），在它把牌局作废之前，回收层不能插手
    b.rooms.sweep();
    expect(b.rooms.has(created.roomId)).toBe(true);
    created.engine.dispose();
  });

  it('回收会把引擎的计时器一并清掉，不留悬挂定时器', () => {
    const b = createBench();
    const created = b.rooms.create();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const p1 = joinRoom(created.engine, 'guest_1', '客一', 'sock_1');
    joinRoom(created.engine, 'guest_2', '客二', 'sock_2');
    created.engine.start(p1.playerId);
    // 开席会挂上「回合超时」定时器
    expect(b.clock.pendingTimers).toBeGreaterThan(0);

    // 全员掉线 → 引擎把牌局作废、退回空大厅
    const players = created.engine.snapshot().players;
    for (const p of players) created.engine.disconnect(p.id);
    b.clock.advance(200_000);

    expect(created.engine.phase).toBe('LOBBY');
    expect(created.engine.playerCount).toBe(0);

    b.rooms.sweep();
    b.clock.advance(EMPTY_ROOM_TTL_MS + 1);
    expect(b.rooms.sweep()).toBe(1);
    expect(b.rooms.size).toBe(0);
    // 散场那条路径上的定时器都清干净了
    expect(b.clock.pendingTimers).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 引擎的房间归属
 * ------------------------------------------------------------------ */

describe('GameEngine · 房间归属', () => {
  it('构造时传入的 roomId 会出现在快照里，并透传到 join 结果', () => {
    const engine = new GameEngine({ roomId: '7K3FZ' });
    expect(engine.snapshot().roomId).toBe('7K3FZ');

    const res = engine.join({ guestId: 'guest_1', nickname: '客一', sessionToken: null, socketId: 's1' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.snapshot.roomId).toBe('7K3FZ');
    engine.dispose();
  });

  it('不传 roomId 时退回默认房间', () => {
    const engine = new GameEngine();
    expect(engine.snapshot().roomId).toBe(ROOM_ID);
    engine.dispose();
  });
});
