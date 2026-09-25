/**
 * 端到端联机验收脚本。
 *
 * 单元测试用的是「直接调用 GameEngine」，证明不了**真的能联机**。
 * 这个脚本起 4 个真实的 Socket.IO 客户端连到真实的服务端进程，
 * 走完整的入席 → 开局 → 逐回合博饼 → 追状元 → 结算流程，
 * 并在每一步校验「所有人看到的是同一副骰子」。
 *
 * ⚠️ 本局现在打的是「博到饼尽」：五样普通饼全部博完才收席，骰子不做任何干预。
 * 一桌 63 份（传统会饼 1:2:4:8:16:32），实测中位约 209 掷、p90 约 316 掷，
 * 折合中位约 9 分钟纯动画时间，**跑完一局通常要 10~20 分钟，长尾能到 40 分钟**。
 * 这是唯一一个真的打完一局的冒烟脚本，别提前掐掉它 —— 因为它这么慢，
 * 日常改动用 test:multiroom / test:browser 就够了，这个留作压轴。
 *
 * 这里刻意**不给服务端加测试专用旋钮**（比如用环境变量缩短库存）：
 * 代价就是这个脚本慢十几分钟，换来的是生产代码里不留任何测试钩子。
 *
 * 用法：
 *   终端 A:  npm run dev:server
 *   终端 B:  npm run test:e2e
 */
import { io } from 'socket.io-client';

const URL = process.env.E2E_URL ?? 'http://localhost:3001';
const PLAYER_COUNT = 4;

/** 全局收席判定里的五个普通奖池 —— 与 server/src/config/prizes.ts 的 ENDING_PRIZE_KEYS 一致（纯 JS 引不到 TS）。 */
const ENDING_KEYS = ['ONE_SHOW', 'TWO_LIFT', 'THREE_RED', 'FOUR_ADVANCE', 'DUITANG'];

/**
 * 三条各自独立的收工线：掷骰太多次、空转太多次、跑得太久，各报各的错。
 *
 * 这三个数是**看门狗，不是预期值** —— 它们该在服务端真卡住时才响。
 * 63 份一桌实测：掷数中位 209 / p99 446 / 八万局里最长 840，
 * 时间中位约 9 分钟 / p90 约 14 分钟 / p99 约 19 分钟 / 最长约 36 分钟。
 * 所以两条线都压在最坏实测之上留足余量，正常局碰不到。
 */
const MAX_ROLLS = 1_500;
const MAX_LOOP_TURNS = 4_000;
const MAX_GAME_MS = 60 * 60_000;

/**
 * 服务端快照里 `rollHistory` 的**上限** —— 与 server/src/config/gameConfig.ts 的
 * MAX_ROLL_HISTORY 一致（纯 JS 引不到 TS）。
 *
 * 它是「最近 N 掷」的滚动窗口，超出就从**头部**丢弃最老的。这个上限是为了
 * 压住广播体积：快照挂在每一次开奖广播上，一份掷骰记录约几百字节。
 * 旧配货一局 111~177 掷，从来碰不到 300；现在 63 份一局中位就 209 掷、
 * 一半以上的局会超过它，所以下面所有对账断言都必须按「有截断」来写。
 */
const MAX_ROLL_HISTORY = 300;

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

/** 轮询等待条件成立。 */
async function waitFor(label, fn, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    let value;
    try {
      value = await fn();
    } catch {
      value = undefined;
    }
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`等待超时：${label}`);
    await sleep(25);
  }
}

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

/** 一个真实客户端：自己维护最新快照，并记录收到的每一次广播。 */
function makeClient(index) {
  const socket = io(URL, { transports: ['websocket'], forceNew: true });
  const state = {
    index,
    socket,
    guestId: `e2e_guest_${index}_${process.pid}`,
    playerId: null,
    sessionToken: null,
    snap: null,
    seenRolls: [], // 收到的每一次 roll:result
    events: [], // 收到的事件名序列
    sameVersionViolations: 0,
  };

  let lastVersion = -1;
  const onSnapshot = (payload) => {
    const snap = payload?.snapshot;
    if (!snap) return;
    // 客户端契约：不允许用旧 stateVersion 覆盖新状态
    if (snap.stateVersion < lastVersion) state.sameVersionViolations += 1;
    if (snap.stateVersion >= lastVersion) {
      lastVersion = snap.stateVersion;
      state.snap = snap;
    }
  };

  const EVENTS = [
    'room:snapshot',
    'room:playerJoined',
    'room:playerLeft',
    'room:playerDisconnected',
    'room:playerReconnected',
    'game:started',
    'turn:changed',
    'roll:started',
    'inventory:updated',
    'score:updated',
    'champion:started',
    'champion:updated',
    'champion:queueUpdated',
    'game:finished',
  ];
  for (const name of EVENTS) {
    socket.on(name, (payload) => {
      state.events.push(name);
      onSnapshot(payload);
    });
  }
  socket.on('roll:result', (payload) => {
    state.events.push('roll:result');
    if (payload?.roll) state.seenRolls.push(payload.roll);
    onSnapshot(payload);
  });

  return state;
}

async function join(client, nickname, roomId) {
  const res = await ask(client.socket, 'room:join', {
    guestId: client.guestId,
    nickname,
    sessionToken: client.sessionToken,
    roomId,
  });
  if (res?.ok) {
    client.playerId = res.data.playerId;
    client.sessionToken = res.data.sessionToken;
  }
  return res;
}

async function main() {
  console.log(`\n▸ 连接 ${URL} …\n`);

  /* ---------------- 0. 健康检查 ---------------- */
  const health = await waitFor('服务端健康检查', async () => {
    const r = await fetch(`${URL}/api/health`);
    return r.ok ? r.json() : null;
  });
  check('服务端已就绪（/api/health）', health.ok === true);

  check(
    '健康检查报的是房间数与连接数',
    typeof health.rooms === 'number' && typeof health.sockets === 'number',
    JSON.stringify(health),
  );

  /* ---------------- 1. 开一张新桌并入席 ---------------- */
  // 每次都现开一张桌，所以这个脚本不依赖服务端是不是「干净」的：
  // 不用重启、也不会和别人的牌局互相干扰。
  console.log('\n[1] 开一张新桌，四位玩家依次入席');
  const clients = Array.from({ length: PLAYER_COUNT }, (_, i) => makeClient(i));
  const names = ['苏子瞻', '黄鲁直', '秦少游', '晁无咎'];

  const created = await ask(clients[0].socket, 'room:create', undefined);
  check('开桌成功', created?.ok === true, created?.message);
  const ROOM = created?.data?.roomId;
  check(
    '房间码是 5 位短码（不含易混的 0/O/1/I/L）',
    /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{5}$/.test(ROOM ?? ''),
    ROOM,
  );

  for (let i = 0; i < PLAYER_COUNT; i += 1) {
    const res = await join(clients[i], names[i], ROOM);
    check(`${names[i]} 入席成功`, res?.ok === true, res?.message);
  }

  // 第一个人应该是房主
  const host = clients[0];
  await waitFor('房主快照', () => host.snap);
  check('首位入席者成为房主', host.snap.hostId === host.playerId);
  check('座位按入席顺序分配 1~4', host.snap.players.map((p) => p.seat).join(',') === '1,2,3,4');

  // 每个人都应看到 4 人
  for (const c of clients) {
    await waitFor(`${names[c.index]} 看到 4 人`, () => c.snap?.players.length === PLAYER_COUNT);
  }
  check('四位玩家互相可见（每人都看到 4 人）', clients.every((c) => c.snap.players.length === PLAYER_COUNT));

  // 同一个 guestId 重复入席应被拒
  const dupe = makeClient(99);
  dupe.guestId = clients[1].guestId;
  const dupeRes = await join(dupe, '冒名者', ROOM);
  check('同一浏览器身份不能重复占座', dupeRes?.ok === false, dupeRes?.message);
  dupe.socket.close();

  // 重复昵称应当被拒或被自动改名；这里只要求不崩
  const beforeCount = host.snap.players.length;
  check('被拒的入席没有污染座位表', host.snap.players.length === beforeCount);

  /* ---------------- 2. 开局前不能博饼 ---------------- */
  console.log('\n[2] 开局前的非法操作');
  const early = await ask(host.socket, 'game:roll', { turnId: 'turn_000001', actionId: 'a1' });
  check('未开局时不能博饼', early?.ok === false, early?.message);

  const notHostStart = await ask(clients[1].socket, 'game:start', undefined);
  check('非房主不能开局', notHostStart?.ok === false, notHostStart?.message);

  /* ---------------- 3. 开局 ---------------- */
  console.log('\n[3] 房主开局');
  const startRes = await ask(host.socket, 'game:start', undefined);
  check('房主开局成功', startRes?.ok === true, startRes?.message);

  for (const c of clients) {
    await waitFor(`${names[c.index]} 收到开局`, () => c.snap?.phase === 'NORMAL_TURN');
  }
  check('四人都进入 NORMAL_TURN', clients.every((c) => c.snap.phase === 'NORMAL_TURN'));

  const firstTurn = host.snap.currentTurn;
  check('第一位由座位 1 起手', firstTurn?.seat === 1);
  check('回合带 turnId', typeof firstTurn?.turnId === 'string' && firstTurn.turnId.length > 0);
  check('回合有服务端权威截止时间', firstTurn?.deadlineAt > Date.now() - 5_000);

  // 断言**形状**而不是写死份数：配货是 prizes.ts 里一张手填的表，
  // 写死 32/16/… 会让每次调配货都得跟着改这个脚本（而它跑一次要十几分钟）。
  // `initial` 是开局库存的快照，这里存下来，局末再比对一次（见 [5]）。
  const openingCounts = host.snap.inventory.initial; // initial 本身就是一张 key→份数 的平表
  check(
    '开局按一桌饼配货，五样普通饼都有货、状元恰好一份',
    ENDING_KEYS.every((k) => openingCounts[k] > 0) && openingCounts.CHAMPION === 1,
    JSON.stringify(openingCounts),
  );
  check(
    '开局库存（counts）与开局配货（initial）一致',
    JSON.stringify(host.snap.inventory.counts) === JSON.stringify(openingCounts),
  );

  /* ---------------- 4. 追一局到结束 ---------------- */
  console.log('\n[4] 逐回合博饼直至结算（博到饼尽，通常 10~20 分钟）');

  const rollRecordsByIndex = new Map(); // rollIndex -> Set(序列化后的骰子)
  let actionCounter = 0;
  let loops = 0; // 循环空转次数（等结算 / 等回合推进）
  let rolledCount = 0; // 真正博出去的次数
  const gameStartedAt = Date.now();

  while (host.snap.phase !== 'FINISHED') {
    loops += 1;
    if (loops > MAX_LOOP_TURNS) {
      throw new Error(`循环空转 ${MAX_LOOP_TURNS} 次仍未结席：回合可能卡住不推进`);
    }
    if (rolledCount > MAX_ROLLS) {
      throw new Error(`已博 ${MAX_ROLLS} 次仍未结席：收席闸门可能失效`);
    }
    if (Date.now() - gameStartedAt > MAX_GAME_MS) {
      throw new Error(
        `本局已跑满 ${MAX_GAME_MS / 60_000} 分钟仍未结席（已博 ${rolledCount} 次）——` +
          '运气极长的牌局也可能触发，请先看服务端日志里对堂是不是一直没博出来',
      );
    }

    const snap = host.snap;
    if (snap.phase === 'SETTLING') {
      await sleep(50);
      continue;
    }

    const turn = snap.currentTurn;
    if (!turn || turn.status !== 'WAITING') {
      await sleep(20);
      continue;
    }

    const actor = clients.find((c) => c.playerId === turn.playerId);
    if (!actor) throw new Error(`找不到当前回合玩家 ${turn.playerId}`);

    const rollIndex = turn.rollIndex;

    // 4a. 旁观者不能替他博
    const bystander = clients.find((c) => c.playerId !== turn.playerId);
    const peeking = await ask(bystander.socket, 'game:roll', {
      turnId: turn.turnId,
      actionId: `sneak_${actionCounter++}`,
    });
    check(`第 ${rollIndex} 次：非当前回合玩家不能代博`, peeking?.ok === false, peeking?.message);

    const versionBefore = snap.stateVersion;

    // 4b. 本人博饼
    const res = await ask(actor.socket, 'game:roll', {
      turnId: turn.turnId,
      actionId: `act_${actionCounter++}`,
    });
    if (res?.ok !== true) throw new Error(`博饼被拒：${res?.error} ${res?.message}`);
    rolledCount += 1;

    // 4c. 立刻用同一 turnId、不同 actionId 再博一次 —— 必须被拒
    const again = await ask(actor.socket, 'game:roll', {
      turnId: turn.turnId,
      actionId: `act_${actionCounter++}`,
    });
    check(`第 ${rollIndex} 次：同一回合不能博第二次`, again?.ok === false, again?.message);

    // 4d. 等所有人收到这次开奖
    await waitFor(
      `所有客户端收到第 ${rollIndex} 次开奖`,
      () => clients.every((c) => c.seenRolls.some((r) => r.rollIndex === rollIndex)),
    );

    const rolls = clients.map((c) => c.seenRolls.find((r) => r.rollIndex === rollIndex));
    const diceKeys = new Set(rolls.map((r) => r.dice.join(',')));
    const awardIds = new Set(rolls.map((r) => r.awardId));
    check(
      `第 ${rollIndex} 次：四人看到的是同一副骰子（${rolls[0].dice.join(' ')}）`,
      diceKeys.size === 1,
      [...diceKeys].join(' | '),
    );
    check(`第 ${rollIndex} 次：四人看到的奖项一致（${rolls[0].awardId}）`, awardIds.size === 1);
    check(
      `第 ${rollIndex} 次：骰子由服务端产生且合法`,
      rolls[0].dice.length === 6 && rolls[0].dice.every((d) => d >= 1 && d <= 6),
    );

    // 4e. stateVersion 必须单调递增
    check(
      `第 ${rollIndex} 次：stateVersion 单调递增`,
      clients.every((c) => c.snap.stateVersion > versionBefore),
    );

    rollRecordsByIndex.set(rollIndex, diceKeys);

    // 4f. 等回合推进
    await waitFor(
      `第 ${rollIndex} 次开奖后回合推进`,
      () => {
        const s = host.snap;
        return s.phase === 'FINISHED' || s.phase === 'SETTLING' || s.currentTurn?.turnId !== turn.turnId;
      },
    );
  }

  const elapsedSec = Math.round((Date.now() - gameStartedAt) / 1000);
  console.log(`\n  本局共博了 ${rolledCount} 次，用时约 ${Math.floor(elapsedSec / 60)} 分 ${elapsedSec % 60} 秒`);

  /* ---------------- 5. 结算校验 ---------------- */
  console.log('\n[5] 结算与排行榜');

  for (const c of clients) {
    await waitFor(`${names[c.index]} 收到结算`, () => c.snap?.phase === 'FINISHED');
  }

  const stats = host.snap.stats;
  const result = host.snap.result;
  const inventory = host.snap.inventory;

  // 已经 FINISHED 却拿不到 result，那就没有后面可断言的了 —— 直接报错，别让下面的
  // `result.endReason` 抛一个看不懂的 TypeError 把真正的原因盖掉。
  if (!result) throw new Error('已进入 FINISHED 但快照里没有 result（结算数据没下发）');
  check('产生了结算结果', result != null);
  check(
    '收席原因只有两种（博到饼尽 / 兜底中止）',
    result.endReason === 'INVENTORY_EMPTY' || result.endReason === 'ABORTED',
    result.endReason,
  );
  check('本局确实是博到饼尽收席', result.endReason === 'INVENTORY_EMPTY', result.endReason);

  const champion = result.champion;
  check('排行榜含全部 4 人', result.ranking.length === PLAYER_COUNT);
  check('排行榜按积分降序', result.ranking.every((e, i, a) => i === 0 || a[i - 1].score >= e.score));
  check('名次是 1~4 名', result.ranking.map((e) => e.rank).join(',') === '1,2,3,4');

  // 收席那一刻：五个普通奖池应当正好清空
  check(
    '五样普通饼全部博尽（这就是收席条件）',
    ENDING_KEYS.every((k) => inventory.counts[k] === 0),
    JSON.stringify(inventory.counts),
  );
  check(
    '开局配货（initial）不因中途博饼而改动',
    JSON.stringify(inventory.initial) === JSON.stringify(openingCounts),
  );
  check(
    '掷骰次数与博饼记录条数一致（历史是「最近 300 掷」的滚动窗口）',
    host.snap.rollHistory.length === Math.min(stats.totalRolls, MAX_ROLL_HISTORY),
    `${host.snap.rollHistory.length} 条 / 共 ${stats.totalRolls} 掷`,
  );

  /* --- 5a. 有状元 / 无状元是一对**互斥**的分支，各自全量断言 --- */
  // 骰子完全随机之后约十分之一的牌局一个状元都博不出来 —— 那是正常结局，
  // 不是「数据没同步」，所以这里不能只断言「必有状元」那一支。
  const marked = result.ranking.filter((e) => e.isFinalChampion);
  const championPrizeHolders = result.ranking.filter((e) =>
    e.prizes.some((p) => p.key === 'CHAMPION'),
  );
  console.log(
    champion
      ? `  本局状元：${champion.nickname}（${champion.seat} 号席）· ${champion.awardId} · ${champion.dice.join(' ')}`
      : '  本局无状元：状元那一份饼原封留在桌上',
  );

  if (champion) {
    check('最终状元在四人之中', clients.some((c) => c.playerId === champion.playerId));
    check('状元基础分与所选骰型自洽（> 0）', champion.baseScore > 0);
    check('状元骰型是六颗合法骰子', champion.dice.length === 6 && champion.dice.every((d) => d >= 1 && d <= 6));
    check('状元奖励固定 100 分', champion.bonus === 100);

    check('恰好一人被标记为最终状元', marked.length === 1, `${marked.length} 人`);
    check('被标记的正是 result.champion 那位', marked[0]?.playerId === champion.playerId);
    check('只有最终状元持有状元奖品', championPrizeHolders.length === 1, `${championPrizeHolders.length} 人`);
    check('状元库存已归零', inventory.counts.CHAMPION === 0);
    // 服务端自己记的账（firstChampionRollIndex）与它下发的 result.champion 必须自洽
    check('有状元 ⟺ firstChampionRollIndex 有记录', stats.firstChampionRollIndex !== null);
    check(
      'firstChampionRollIndex 落在本局掷骰范围内',
      stats.firstChampionRollIndex >= 1 && stats.firstChampionRollIndex <= stats.totalRolls,
      String(stats.firstChampionRollIndex),
    );

    const champ = marked[0];
    if (champ) {
      const expected = champion.baseScore + champion.bonus;
      // 用脚本自己收到的**完整**开奖流来算，而不是快照里的 rollHistory ——
      // 后者是「最近 300 掷」的滚动窗口，长局里状元早期的得分会被丢掉，
      // 那样算出来会偏小（曾经在这里挂过：真实 177 分被算成 163）。
      const championScoreFromRolls = host.seenRolls
        .filter((r) => r.playerId === champ.playerId)
        .reduce((a, r) => a + r.scoreGained, 0);
      check(
        '状元的积分 = 逐掷得分 + 基础分 + 100',
        champ.score === championScoreFromRolls + expected,
        `${champ.score} vs ${championScoreFromRolls + expected}`,
      );
    }
  } else {
    check('无人被标记为最终状元', marked.length === 0, `${marked.length} 人`);
    check('无人持有状元奖品', championPrizeHolders.length === 0, `${championPrizeHolders.length} 人`);
    check('状元那一份饼原封留在桌上', inventory.counts.CHAMPION === 1);
    check('无状元 ⟺ firstChampionRollIndex 为空', stats.firstChampionRollIndex === null);
    check(
      '本局确实一次状元档都没博出过',
      host.seenRolls.every((r) => !r.isChampionTier),
    );
  }

  const standings = result.ranking.map((e) => `${e.rank}.${e.nickname}(${e.score})`).join('  ');
  console.log(`  最终名次：${standings}`);
  check('第 2、3 名有雅号（榜眼 / 探花）', result.ranking[1].funTitle !== null && result.ranking[2].funTitle !== null);
  check('第 1 名不带趣味称号', result.ranking[0].funTitle === null);

  /* ---------------- 6. 广播一致性 ---------------- */
  console.log('\n[6] 全桌状态一致性');
  const versions = new Set(clients.map((c) => c.snap.stateVersion));
  check('四人最终 stateVersion 一致', versions.size === 1, [...versions].join(','));
  check('没有任何客户端收到过倒退的 stateVersion', clients.every((c) => c.sameVersionViolations === 0));
  check('每次开奖都广播到了四个人', clients.every((c) => c.seenRolls.length === stats.totalRolls));

  check(
    '统计里总掷骰次数与历史一致（同样按滚动窗口比）',
    host.snap.rollHistory.length === Math.min(stats.totalRolls, MAX_ROLL_HISTORY),
    `${host.snap.rollHistory.length} 条 / 共 ${stats.totalRolls} 掷`,
  );
  check('代掷次数不可能超过总掷骰次数', stats.autoRolls <= stats.totalRolls);
  check('易主次数不可能超过总掷骰次数', stats.championReplacements <= stats.totalRolls);

  // 双向对账。注意 rollHistory 是滚动窗口，**不能**要求它包含全部开奖 ——
  // 要断言的是：它恰好是本局**最后 len 掷**那段连续区间，一条不多、一条不少、
  // 中间不缺口，而且被丢掉的正是最早的那些。这比旧版的「两边 size 相等」
  // 更强：索引连续性一断就会炸。
  const historyIndexes = host.snap.rollHistory.map((r) => r.rollIndex);
  const dropped = stats.totalRolls - historyIndexes.length;
  check(
    '服务端记的每一次开奖，脚本都观察到了',
    historyIndexes.every((i) => rollRecordsByIndex.has(i)),
  );
  check(
    'rollHistory 恰好是最后若干掷的连续区间（无缺口、无多余）',
    historyIndexes.every((i, k) => i === dropped + k + 1),
    `应覆盖 ${dropped + 1}~${stats.totalRolls}，实际 ${historyIndexes[0]}~${historyIndexes[historyIndexes.length - 1]}`,
  );
  check(
    '滚动窗口丢掉的正是最早的那些开奖',
    [...rollRecordsByIndex.keys()]
      .filter((i) => !historyIndexes.includes(i))
      .every((i) => i <= dropped),
    `${rollRecordsByIndex.size} 次观察到 / ${historyIndexes.length} 条记录 / 丢弃 ${dropped} 条`,
  );

  console.log(
    `  本局统计：共 ${stats.totalRolls} 掷，` +
      (stats.firstChampionRollIndex === null
        ? '本局无状元'
        : `首状元在第 ${stats.firstChampionRollIndex} 掷`) +
      `，易主 ${stats.championReplacements} 次，超时代掷 ${stats.autoRolls} 次`,
  );

  /* ---------------- 7. 刷新重连 ---------------- */
  console.log('\n[7] 模拟刷新页面（断线重连）');
  const refresh = clients[2];
  const seatBefore = refresh.snap.players.find((p) => p.id === refresh.playerId).seat;
  const scoreBefore = refresh.snap.players.find((p) => p.id === refresh.playerId).score;
  refresh.socket.close();
  await sleep(400);

  const revived = makeClient(2);
  revived.guestId = refresh.guestId;
  revived.sessionToken = refresh.sessionToken;
  const revRes = await join(revived, names[2], ROOM);
  check('带 sessionToken 重连成功', revRes?.ok === true, revRes?.message);

  const syncRes = await ask(revived.socket, 'room:sync', { sessionToken: revived.sessionToken });
  check('room:sync 拿回完整快照', syncRes?.ok === true && syncRes.data.phase === 'FINISHED');
  const meAfter = syncRes.data.players.find((p) => p.id === revived.playerId);
  check('重连后座位不变', meAfter?.seat === seatBefore, `${meAfter?.seat} vs ${seatBefore}`);
  check('重连后积分不丢', meAfter?.score === scoreBefore, `${meAfter?.score} vs ${scoreBefore}`);
  check('重连后仍是同一 playerId', revived.playerId === refresh.playerId);

  const badSync = await ask(revived.socket, 'room:sync', { sessionToken: 'forged_token_xyz' });
  check('伪造 token 的 sync 被拒', badSync?.ok === false);

  revived.socket.close();

  /* ---------------- 8. 再来一局 ---------------- */
  console.log('\n[8] 再来一局');
  const restart = await ask(host.socket, 'game:restart', undefined);
  check('房主可以重开', restart?.ok === true, restart?.message);
  await waitFor('重开后回到 LOBBY', () => host.snap.phase === 'LOBBY');
  check('重开后积分清零', host.snap.players.every((p) => p.score === 0));
  // 大厅里还没有牌局，库存应当是空的；真正的库存要等 start() 时按人数重建
  check(
    '重开后台面清空（库存归零待重建）',
    host.snap.inventory.counts.ONE_SHOW === 0 &&
      host.snap.inventory.counts.TWO_LIFT === 0 &&
      host.snap.inventory.counts.THREE_RED === 0,
  );
  check('重开后保留昵称与座位', host.snap.players.map((p) => p.nickname).join(',') === names.join(','));
  check('重开后清空上一局结果', host.snap.result === null);

  // 第二局必须能真正跑起来，且不能和上一局的 turnId 撞车
  const firstGameTurnId = firstTurn.turnId;
  const start2 = await ask(host.socket, 'game:start', undefined);
  check('重开后可以立刻开第二局', start2?.ok === true, start2?.message);
  await waitFor('第二局开始', () => host.snap.phase === 'NORMAL_TURN');
  // 一桌饼是定量的：第二局的配货必须与第一局**逐位相同**（不写死份数，免得旋钮一动就再挂一次）
  check(
    '第二局库存按一桌饼重建，与第一局开局逐位一致',
    JSON.stringify(host.snap.inventory.counts) === JSON.stringify(openingCounts),
    JSON.stringify(host.snap.inventory.counts),
  );
  check('第二局状元库存重新有货', host.snap.inventory.counts.CHAMPION === 1);
  check('第二局的 turnId 不与上一局重复', host.snap.currentTurn.turnId !== firstGameTurnId);
  check('第二局掷骰计数重新开始', host.snap.stats.totalRolls === 0 && host.snap.rollHistory.length === 0);
  check('第二局清空上一局的状元', host.snap.champion.finalPlayerId === null && host.snap.champion.playerId === null);

  const roll2 = await ask(host.socket, 'game:roll', {
    turnId: host.snap.currentTurn.turnId,
    actionId: 'second_game_roll',
  });
  check('第二局可以正常博饼', roll2?.ok === true, roll2?.message);

  /* ---------------- 收尾 ---------------- */
  for (const c of clients) c.socket.close();
  const other = makeClient(1);
  other.socket.close();

  console.log(`\n${'─'.repeat(60)}`);
  if (failures === 0) {
    console.log(`✅ 端到端验收通过：${checks} 项检查全部通过\n`);
    process.exit(0);
  } else {
    console.error(`❌ 端到端验收失败：${checks} 项检查中有 ${failures} 项未通过\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ 端到端验收异常终止：${err?.message ?? err}\n`);
  process.exit(1);
});
