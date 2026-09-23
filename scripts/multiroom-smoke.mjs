/**
 * 多房间隔离验收脚本。
 *
 * 单元测试覆盖了 RoomManager / PlayerManager 的逻辑，但**覆盖不到 socket 路由层** ——
 * 而「这次开奖到底发给了哪张桌」恰恰是这次改造里最容易错、又最难在本地发现的地方：
 * 一个 `io.to()` 传错参数，两桌人就会开始抢同一副骰子，而单独看任何一张桌
 * 都显得「挺正常」。
 *
 * 所以这里开两张真实的桌同时玩，逐条断言两桌互不干扰。
 *
 * 陷阱提醒：playerId 是**房间内**唯一的（每张桌都从 player_0001 开始数），
 * 所以 socket → 玩家的绑定必须带上房间码。这个脚本会先证明「两桌确实各有一个
 * player_0001」，再证明他们互不串线。
 *
 * 用法：
 *   终端 A:  npm run dev:server        （或 npm start）
 *   终端 B:  npm run test:multiroom
 */
import { io } from 'socket.io-client';

const URL = process.env.E2E_URL ?? 'http://localhost:3001';

let failures = 0;
let checks = 0;

function check(label, condition, detail = '') {
  checks += 1;
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    failures += 1;
    console.error(`  ✗ ${label}${detail ? `  — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 包一层带超时的 ACK 调用。 */
function ask(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} ACK 超时`)), 8_000);
    socket.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

const ALL_EVENTS = [
  'room:snapshot',
  'room:playerJoined',
  'room:playerLeft',
  'room:playerDisconnected',
  'room:playerReconnected',
  'game:started',
  'turn:changed',
  'roll:started',
  'roll:result',
  'inventory:updated',
  'score:updated',
  'champion:started',
  'champion:updated',
  'champion:queueUpdated',
  'game:finished',
  'stats:updated',
];

/** 一个真实客户端：记下收到的每一条广播，便于断言「谁不该收到什么」。 */
function makeClient(label) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const state = {
    label,
    socket,
    guestId: `mr_guest_${label}_${process.pid}`,
    playerId: null,
    sessionToken: null,
    snap: null,
    events: [],
  };
  for (const name of ALL_EVENTS) {
    socket.on(name, (payload) => {
      state.events.push(name);
      if (payload?.snapshot) state.snap = payload.snapshot;
    });
  }
  return state;
}

async function joinRoom(client, roomId, nickname) {
  const res = await ask(client.socket, 'room:join', {
    guestId: client.guestId,
    nickname,
    sessionToken: null,
    roomId,
  });
  if (res?.ok) {
    client.playerId = res.data.playerId;
    client.sessionToken = res.data.sessionToken;
    client.snap = res.data.snapshot;
  }
  return res;
}

async function createRoom(socket) {
  return ask(socket, 'room:create', undefined);
}

const roomStats = async () => {
  const res = await fetch(`${URL}/api/rooms`);
  return res.ok ? res.json() : { rooms: [], total: 0 };
};

async function main() {
  console.log(`\n▸ 连接 ${URL} …\n`);

  /* ---------------- 0. 服务端就绪 ---------------- */
  let health = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const r = await fetch(`${URL}/api/health`);
      if (r.ok) {
        health = await r.json();
        break;
      }
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  if (!health) {
    console.error(
      `\n❌ 连不上 ${URL}。请先在另一个终端启动服务端：\n     npm run dev:server\n`,
    );
    process.exit(1);
  }
  check('服务端已就绪（/api/health）', health.ok === true);
  check(
    '健康检查报的是房间数与连接数',
    typeof health.rooms === 'number' && typeof health.sockets === 'number',
    JSON.stringify(health),
  );

  const clients = [];

  /* ---------------- 1. 开两张桌 ---------------- */
  console.log('\n[1] 开两张桌');

  const hostA = makeClient('A房主');
  const hostB = makeClient('B房主');
  clients.push(hostA, hostB);

  const createdA = await createRoom(hostA.socket);
  const createdB = await createRoom(hostB.socket);
  check('两张桌都建成功了', createdA?.ok === true && createdB?.ok === true, JSON.stringify({ createdA, createdB }));

  const roomA = createdA?.data?.roomId;
  const roomB = createdB?.data?.roomId;
  check('两张桌拿到了不同的房间码', Boolean(roomA && roomB && roomA !== roomB), `${roomA} vs ${roomB}`);
  check(
    '房间码是 5 位且不含易混字符（0/O/1/I/L）',
    /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(roomA ?? '') &&
      /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(roomB ?? ''),
    `${roomA} / ${roomB}`,
  );

  /* ---------------- 2. 进不去不存在的桌 ---------------- */
  console.log('\n[2] 进不存在的桌');

  const before = (await roomStats()).total;
  const stray = makeClient('迷路的');
  clients.push(stray);
  const notFound = await joinRoom(stray, 'ZZZZZ', '迷路的人');
  check('不存在的房间码返回 ROOM_NOT_FOUND', notFound?.error === 'ROOM_NOT_FOUND', JSON.stringify(notFound));
  const after = (await roomStats()).total;
  check('打错码不会顺手凭空建出一张桌', after === before, `${before} → ${after}`);

  /* ---------------- 3. 两桌各坐各的 ---------------- */
  console.log('\n[3] 两桌各坐各的');

  const a1 = await joinRoom(hostA, roomA, '甲桌一号');
  const b1 = await joinRoom(hostB, roomB, '乙桌一号');
  check('两桌的房主都入席成功', a1?.ok === true && b1?.ok === true, JSON.stringify({ a1, b1 }));

  const a2sock = makeClient('A二号');
  const b2sock = makeClient('B二号');
  clients.push(a2sock, b2sock);
  const a2 = await joinRoom(a2sock, roomA, '甲桌二号');
  const b2 = await joinRoom(b2sock, roomB, '乙桌二号');
  check('两桌的第二人都入席成功', a2?.ok === true && b2?.ok === true, JSON.stringify({ a2, b2 }));

  // 先证明「碰撞场景」是真的：两张桌的第一人拿着同一个 playerId
  check(
    '两张桌各自都有一个 player_0001（房间内 id 唯一，不是全局唯一）',
    a1.data?.playerId === b1.data?.playerId && typeof a1.data?.playerId === 'string',
    `${a1.data?.playerId} vs ${b1.data?.playerId}`,
  );

  check(
    '甲桌上的人看到的是甲桌',
    a2.data?.snapshot?.players?.length === 2 &&
      a2.data.snapshot.players.every((p) => p.nickname.startsWith('甲桌')),
    JSON.stringify(a2.data?.snapshot?.players?.map((p) => p.nickname)),
  );
  check(
    '乙桌上的人看到的是乙桌',
    b2.data?.snapshot?.players?.length === 2 &&
      b2.data.snapshot.players.every((p) => p.nickname.startsWith('乙桌')),
    JSON.stringify(b2.data?.snapshot?.players?.map((p) => p.nickname)),
  );
  check(
    '快照里的 roomId 各自正确',
    a2.data?.snapshot?.roomId === roomA && b2.data?.snapshot?.roomId === roomB,
    `${a2.data?.snapshot?.roomId} / ${b2.data?.snapshot?.roomId}`,
  );

  /* ---------------- 4. 一桌开席，另一桌不受影响 ---------------- */
  console.log('\n[4] 一桌开席不影响另一桌');

  const startedA = await ask(hostA.socket, 'game:start', undefined);
  check('甲桌房主开席成功', startedA?.ok === true, startedA?.message);
  check('甲桌进入 NORMAL_TURN', startedA?.data?.phase === 'NORMAL_TURN', startedA?.data?.phase);

  await sleep(300);
  const stats = await roomStats();
  const infoA = stats.rooms.find((r) => r.roomId === roomA);
  const infoB = stats.rooms.find((r) => r.roomId === roomB);
  check('甲桌在跑牌局', infoA?.phase === 'NORMAL_TURN', JSON.stringify(infoA));
  check('乙桌纹丝不动，仍停在 LOBBY', infoB?.phase === 'LOBBY', JSON.stringify(infoB));
  check('运维接口能看到两张桌', stats.total >= 2, JSON.stringify(stats.rooms));

  /* ---------------- 5. 甲桌掷骰，乙桌不该听到 ---------------- */
  console.log('\n[5] 甲桌掷骰，乙桌不该听到');

  const turnA = startedA?.data?.currentTurn;
  check('甲桌拿到了第一个回合', Boolean(turnA?.turnId), JSON.stringify(turnA));

  // 清空收件箱，接下来只看「这一掷」漏没漏到乙桌
  for (const c of clients) c.events.length = 0;

  const rolledA = await ask(hostA.socket, 'game:roll', {
    turnId: turnA.turnId,
    actionId: 'mr_roll_a1',
  });
  check('甲桌掷骰成功', rolledA?.ok === true, rolledA?.message);

  const dice = rolledA?.data?.roll?.dice;
  check('拿到六颗骰子', Array.isArray(dice) && dice.length === 6, JSON.stringify(dice));
  check(
    '骰子是服务端掷的、取值合法（1~6）',
    Array.isArray(dice) && dice.every((d) => Number.isInteger(d) && d >= 1 && d <= 6),
    JSON.stringify(dice),
  );

  await sleep(400);
  check(
    '甲桌两位都收到了这次开奖',
    hostA.events.includes('roll:result') && a2sock.events.includes('roll:result'),
    JSON.stringify({ 房主: hostA.events, 二号: a2sock.events }),
  );
  check(
    '乙桌没有收到甲桌的任何广播',
    hostB.events.length === 0 && b2sock.events.length === 0,
    JSON.stringify({ 房主: hostB.events, 二号: b2sock.events }),
  );

  /* ---------------- 6. 跨桌动作被挡住 ---------------- */
  console.log('\n[6] 跨桌动作被挡住');

  // 乙桌的人拿甲桌的 turnId 掷骰：他所在的引擎根本不认识这个回合
  const crossRoll = await ask(b2sock.socket, 'game:roll', {
    turnId: turnA.turnId,
    actionId: 'mr_cross_roll',
  });
  check('乙桌的人拿甲桌的回合掷骰会被拒', crossRoll?.ok === false, JSON.stringify(crossRoll));

  // 甲桌的人想替乙桌开局：他不是那张桌的房主
  const crossStart = await ask(a2sock.socket, 'game:start', undefined);
  check('甲桌的人不能开乙桌的席', crossStart?.ok === false, JSON.stringify(crossStart));

  // 乙桌在 LOBBY，谁都不能博饼
  const bRoll = await ask(hostB.socket, 'game:roll', { turnId: 'turn_000001', actionId: 'mr_b_roll' });
  check('乙桌还没开席，掷骰被拒', bRoll?.ok === false, JSON.stringify(bRoll));

  /* ---------------- 7. 换桌：不能继续偷听旧桌 ---------------- */
  console.log('\n[7] 中途换桌');

  const createdC = await createRoom((() => {
    const c = makeClient('C房主');
    clients.push(c);
    return c.socket;
  })());
  const createdD = await createRoom((() => {
    const d = makeClient('D房主');
    clients.push(d);
    return d.socket;
  })());
  const roomC = createdC?.data?.roomId;
  const roomD = createdD?.data?.roomId;
  check('又开了两张干净的空桌（C / D）', Boolean(roomC && roomD && roomC !== roomD), `${roomC} / ${roomD}`);

  const mover = makeClient('换桌的人');
  const cRegular = makeClient('C常驻');
  clients.push(mover, cRegular);
  await joinRoom(cRegular, roomC, '丙桌常驻');
  const movedIn = await joinRoom(mover, roomC, '丙桌过客');
  check('先进丙桌', movedIn?.ok === true, movedIn?.message);

  for (const c of clients) c.events.length = 0;
  const movedOut = await joinRoom(mover, roomD, '丁桌新客');
  check('中途换到丁桌', movedOut?.ok === true, movedOut?.message);
  check('换桌后快照换成了丁桌', movedOut?.data?.snapshot?.roomId === roomD, movedOut?.data?.snapshot?.roomId);

  // 旧桌必须知道人走了。少这一句的话旧桌会永久留着一个「在线」的幽灵座位，
  // 而且因为 socket 已经退出旧房间，它的 disconnect 永远不会来，谁也清不掉。
  await sleep(300);
  const statsC = (await roomStats()).rooms.find((r) => r.roomId === roomC);
  check('旧桌的人数已经扣掉了他', statsC?.players === 1, JSON.stringify(statsC));
  check('旧桌没留下「在线」的幽灵座位', statsC?.online === 1, JSON.stringify(statsC));
  check(
    '丙桌常驻的人看到的是「人走了」',
    cRegular.snap?.players?.length === 1 &&
      !cRegular.snap.players.some((p) => p.nickname === '丙桌过客'),
    JSON.stringify(cRegular.snap?.players?.map((p) => p.nickname)),
  );

  for (const c of clients) c.events.length = 0;

  // 丙桌来新人 —— 换桌的人已经不在丙桌了，不该收到
  const cNew = makeClient('C新人');
  clients.push(cNew);
  await joinRoom(cNew, roomC, '丙桌新人');
  await sleep(300);
  check(
    '换了桌就收不到旧桌的广播了',
    !mover.events.includes('room:playerJoined'),
    JSON.stringify(mover.events),
  );
  check('丙桌常驻的人仍能收到', cRegular.events.includes('room:playerJoined'), JSON.stringify(cRegular.events));

  for (const c of clients) c.events.length = 0;

  // 丁桌来新人 —— 换桌的人现在是丁桌的人，应该收到
  const dNew = makeClient('D新人');
  clients.push(dNew);
  await joinRoom(dNew, roomD, '丁桌新人');
  await sleep(300);
  check('新桌的广播照收不误', mover.events.includes('room:playerJoined'), JSON.stringify(mover.events));

  /* ---------------- 8. 站点统计 ---------------- */
  console.log('\n[8] 站点统计（累计到访 / 此刻在线）');

  const siteStats = async () => {
    const res = await fetch(`${URL}/api/stats`);
    return res.ok ? (await res.json()).stats : null;
  };

  const base = await siteStats();
  check(
    '/api/stats 给出三个数字',
    typeof base?.visitors === 'number' &&
      typeof base?.online === 'number' &&
      typeof base?.rooms === 'number',
    JSON.stringify(base),
  );
  check('/api/health 也带上了到访人数', typeof health.visitors === 'number', String(health.visitors));

  // 全新面孔 → 到访人数 +1
  const rookie = makeClient(`统计新人_${process.pid}`);
  clients.push(rookie);
  for (const c of clients) c.events.length = 0;
  const rookieJoined = await joinRoom(rookie, roomD, '统计新人');
  check('新面孔入席成功', rookieJoined?.ok === true, rookieJoined?.message);
  await sleep(300);

  const afterRookie = await siteStats();
  check(
    '全新到访者让「累计到访」+1',
    afterRookie?.visitors === base.visitors + 1,
    `${base.visitors} → ${afterRookie?.visitors}`,
  );
  check(
    '刚连上就收到了 stats:updated（连接时补推一份）',
    rookie.events.includes('stats:updated'),
    JSON.stringify(rookie.events),
  );

  // 老面孔换桌 → 不该被重复计为到访，且在线人数不该因为「一进一出」而漂移
  for (const c of clients) c.events.length = 0;
  const beforeMove = await siteStats();
  const movedBack = await joinRoom(mover, roomC, '丙桌过客');
  check('老面孔换桌依然能进', movedBack?.ok === true, movedBack?.message);
  await sleep(300);

  const afterMove = await siteStats();
  check(
    '同一个人换桌不会被重复计为到访',
    afterMove?.visitors === beforeMove.visitors,
    `${beforeMove.visitors} → ${afterMove?.visitors}`,
  );
  check(
    '换桌时在线人数不漂移（旧桌减一、新桌加一）',
    afterMove?.online === beforeMove.online,
    `${beforeMove.online} → ${afterMove?.online}`,
  );

  // 有人退场 → 在线人数 -1，但到访人数不动
  for (const c of clients) c.events.length = 0;
  const beforeLeave = await siteStats();
  cRegular.socket.close();
  await sleep(600);

  const afterLeave = await siteStats();
  check(
    '有人退场后「此刻在线」-1',
    afterLeave?.online === beforeLeave.online - 1,
    `${beforeLeave.online} → ${afterLeave?.online}`,
  );
  check(
    '退场不会把「累计到访」也减掉',
    afterLeave?.visitors === beforeLeave.visitors,
    `${beforeLeave.visitors} → ${afterLeave?.visitors}`,
  );
  check(
    '留在桌上的人被告知了在线人数变化',
    rookie.events.includes('stats:updated'),
    JSON.stringify(rookie.events),
  );

  // 全站散场：到访人数是被记住的，在线人数才是即时的 —— 两者不能混为一谈
  const beforeAll = await siteStats();
  for (const c of clients) c.socket.close();
  await sleep(800);

  const afterAll = await siteStats();
  check('人都走光了，「此刻在线」归零', afterAll?.online === 0, String(afterAll?.online));
  check(
    '「累计到访」不跟着归零（它记的是来过，不是在场）',
    afterAll?.visitors === beforeAll.visitors && afterAll.visitors > 0,
    `${beforeAll.visitors} → ${afterAll?.visitors}`,
  );

  /* ---------------- 收尾 ---------------- */
  for (const c of clients) c.socket.close();

  console.log(`\n${'─'.repeat(60)}`);
  if (failures === 0) {
    console.log(`✅ 多房间隔离验收通过：${checks} 项检查全部通过\n`);
    process.exit(0);
  } else {
    console.error(`❌ 多房间隔离验收失败：${checks} 项检查中有 ${failures} 项未通过\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ 多房间验收异常终止：${err?.message ?? err}\n`);
  process.exit(1);
});
