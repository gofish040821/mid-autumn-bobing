/**
 * 端到端联机验收脚本。
 *
 * 单元测试用的是「直接调用 GameEngine」，证明不了**真的能联机**。
 * 这个脚本起 4 个真实的 Socket.IO 客户端连到真实的服务端进程，
 * 走完整的入席 → 开局 → 逐回合博饼 → 追状元 → 结算流程，
 * 并在每一步校验「所有人看到的是同一副骰子」。
 *
 * 用法：
 *   终端 A:  npm run dev:server
 *   终端 B:  npm run test:e2e
 */
import { io } from 'socket.io-client';

const URL = process.env.E2E_URL ?? 'http://localhost:3001';
const PLAYER_COUNT = 4;

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

async function join(client, nickname) {
  const res = await ask(client.socket, 'room:join', {
    guestId: client.guestId,
    nickname,
    sessionToken: client.sessionToken,
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

  // 这个脚本需要一个「干净的」房间。上一轮跑完如果没重启服务端，
  // 座位会被占着，后面会以各种莫名其妙的方式失败——所以这里直接说清楚。
  if (health.phase !== 'LOBBY' || health.players > 0) {
    console.error(
      `\n❌ 房间不是空的（phase=${health.phase}, players=${health.players}）。\n` +
        `   这个脚本要从零开局，请先重启服务端：\n` +
        `     Ctrl+C 停掉 npm run dev:server，再重新执行\n` +
        `   （若刚跑完浏览器验收，也一并重启；房间状态是纯内存的）\n`,
    );
    process.exit(1);
  }
  check('房间是干净的（LOBBY 且无人在座）', true);

  /* ---------------- 1. 入席 ---------------- */
  console.log('\n[1] 四位玩家依次入席');
  const clients = Array.from({ length: PLAYER_COUNT }, (_, i) => makeClient(i));
  const names = ['苏子瞻', '黄鲁直', '秦少游', '晁无咎'];

  for (let i = 0; i < PLAYER_COUNT; i += 1) {
    const res = await join(clients[i], names[i]);
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
  const dupeRes = await join(dupe, '冒名者');
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
  check('开局时库存按 4 人局配置', host.snap.inventory.counts.ONE_SHOW === 16 && host.snap.inventory.counts.CHAMPION === 1);

  /* ---------------- 4. 追一局到结束 ---------------- */
  console.log('\n[4] 逐回合博饼直至结算');

  const rollRecordsByIndex = new Map(); // rollIndex -> Set(序列化后的骰子)
  let actionCounter = 0;
  let guard = 0;

  while (host.snap.phase !== 'FINISHED') {
    guard += 1;
    if (guard > 400) throw new Error('回合数异常，可能存在死循环');

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

  console.log(`\n  本局共进行了 ${guard} 次博饼`);

  /* ---------------- 5. 结算校验 ---------------- */
  console.log('\n[5] 结算与排行榜');

  for (const c of clients) {
    await waitFor(`${names[c.index]} 收到结算`, () => c.snap?.phase === 'FINISHED');
  }

  const result = host.snap.result;
  check('产生了结算结果', result !== null && result !== undefined);
  check('最终状元在四人之中', clients.some((c) => c.playerId === result.finalChampionId));
  check('状元基础分与其骰型一致', result.championBaseScore > 0);
  check('状元奖励固定 100 分', result.championBonus === 100);
  check('排行榜含全部 4 人', result.ranking.length === PLAYER_COUNT);
  check('排行榜按积分降序', result.ranking.every((e, i, a) => i === 0 || a[i - 1].score >= e.score));
  check('恰好一人被标记为最终状元', result.ranking.filter((e) => e.isFinalChampion).length === 1);
  check(
    '只有最终状元持有状元奖品',
    result.ranking.filter((e) => e.prizes.some((p) => p.key === 'CHAMPION')).length === 1,
  );
  check('状元库存已归零', host.snap.inventory.counts.CHAMPION === 0);

  const champ = result.ranking.find((e) => e.isFinalChampion);
  const expected = result.championBaseScore + 100;
  const championScoreFromRolls = host.snap.rollHistory
    .filter((r) => r.playerId === champ.playerId)
    .reduce((a, r) => a + r.scoreGained, 0);
  check(
    '状元的积分 = 其他得分 + 基础分 + 100',
    champ.score === championScoreFromRolls + expected,
    `${champ.score} vs ${championScoreFromRolls + expected}`,
  );

  const standings = result.ranking.map((e) => `${e.rank}.${e.nickname}(${e.score})`).join('  ');
  console.log(`  最终名次：${standings}`);
  check('第 2、3 名有雅号（榜眼 / 探花）', result.ranking[1].funTitle !== null && result.ranking[2].funTitle !== null);
  check('第 1 名不带趣味称号', result.ranking[0].funTitle === null);

  /* ---------------- 6. 广播一致性 ---------------- */
  console.log('\n[6] 全桌状态一致性');
  const versions = new Set(clients.map((c) => c.snap.stateVersion));
  check('四人最终 stateVersion 一致', versions.size === 1, [...versions].join(','));
  check('没有任何客户端收到过倒退的 stateVersion', clients.every((c) => c.sameVersionViolations === 0));
  check('每次开奖都广播到了四个人', clients.every((c) => c.seenRolls.length === host.snap.stats.totalRolls));

  const stats = host.snap.stats;
  check('统计里首状元序号有记录', stats.firstChampionRollIndex !== null);
  check('统计里总掷骰次数与历史一致', stats.totalRolls === host.snap.rollHistory.length);
  check(
    '若出现过加持/保底，标记都被记录下来',
    stats.blessedRolls <= stats.totalRolls && stats.autoRolls <= stats.totalRolls,
  );
  console.log(
    `  本局统计：共 ${stats.totalRolls} 掷，首状元在第 ${stats.firstChampionRollIndex} 掷，` +
      `易主 ${stats.championReplacements} 次，月华加持 ${stats.blessedRolls} 次，超时代掷 ${stats.autoRolls} 次`,
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
  const revRes = await join(revived, names[2]);
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
  check('第二局库存按人数重建', host.snap.inventory.counts.ONE_SHOW === 16 && host.snap.inventory.counts.CHAMPION === 1);
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
