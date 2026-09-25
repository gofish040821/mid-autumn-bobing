/**
 * GameEngine 集成测试 —— 题目 §41 里点名的全部边界情况。
 *
 * 全程使用 FakeClock + 可编排的确定性 Rng：
 * 时间与骰子都被完全掌控，所以「30 秒超时」「饼尽收席」这些
 * 平时要靠运气的路径，在这里都是确定性的。
 *
 * 关于收席：默认牌是 57 份（约 125 掷），在这里跑一局要几分钟。
 * 需要跑到 FINISHED 的用例统一换成「只剩最后一份饼」的小牌
 * （见 lastPieceInventory），4 掷就能博完，而且走的是同一条闸门。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ErrorCode, InventoryState, RollRecord } from '@bobing/shared';

import {
  ABANDON_GRACE_MS,
  AUTO_START_COUNTDOWN_MS,
  LOBBY_GHOST_TTL_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TURN_TIMEOUT_MS,
  TURN_TIMEOUT_OFFLINE_MS,
} from '../src/config/gameConfig';
import { ENDING_PRIZE_KEYS, buildInventory } from '../src/config/prizes';
import type { EndingPrizeKey } from '../src/config/prizes';
import { FakeClock } from '../src/game/Clock';
import { GameEngine } from '../src/game/GameEngine';
import type { EngineEvent, EngineResult } from '../src/game/GameEngine';

/* ------------------------------------------------------------------ *
 * 测试脚手架
 * ------------------------------------------------------------------ */

/** 任何一次开奖后的「演出时间」上限都远小于这个值。 */
const TRANSITION_MS = 6_000;

/** 把 1~6 的面转成对应的 rng 取值（取每个区间的中点）。 */
const faces = (...f: number[]): number[] => f.map((v) => (v - 0.5) / 6);

/* 一批固定骰型，让每个场景都完全可复现 */
const D_NONE = faces(2, 3, 5, 6, 1, 2); //          无奖
const D_ONE_SHOW = faces(4, 2, 3, 5, 6, 2); //      一秀  +1
const D_TWO_LIFT = faces(4, 4, 2, 3, 5, 6); //      二举  +2
const D_THREE_RED = faces(4, 4, 4, 2, 3, 5); //     三红  +5
const D_DUITANG = faces(1, 2, 3, 4, 5, 6); //       对堂  +15
const D_FOUR_FOUR = faces(4, 4, 4, 4, 2, 6); //     四点红   状元 rank 1
const D_FIVE_SCHOLAR = faces(3, 3, 3, 3, 3, 6); //  五子登科 状元 rank 2
const D_SIX_FOUR = faces(4, 4, 4, 4, 4, 4); //      六杯红   状元 rank 6

/**
 * 可编排的随机源。
 *
 * 队列为空时回落到**循环的 D_NONE**：六颗骰子恰好六次调用，
 * 而 D_NONE 的长度也是六，于是「没预设骰子」永远等于「掷出一把无奖」。
 *
 * 这一点很重要：六颗骰子只要是同一个值就是六抔黑（状元档），
 * 所以任何**常量**回落值（比如 0.99）都会在脚本耗尽时凭空造出一个状元，
 * 让「本局没有状元」这类用例随机翻车。
 */
class ScriptRng {
  private queue: number[] = [];
  private cursor = 0;

  constructor(private readonly fallback: number[] = D_NONE) {}

  next = (): number => {
    if (this.queue.length > 0) return this.queue.shift() as number;
    const value = this.fallback[this.cursor % this.fallback.length] as number;
    this.cursor += 1;
    return value;
  };

  push(...values: number[]): void {
    this.queue.push(...values);
  }

  clear(): void {
    this.queue = [];
    this.cursor = 0;
  }
}

/**
 * 一副「最后一搏」的小牌：指定的那一样只剩 1 份，其余普通饼全空。
 *
 * 用它开局，几步之内就能博到饼尽 —— 收席这条路径在默认牌（57 份、约 125 掷）
 * 上要跑好几分钟，在这里只要 4 掷，走的却是同一条闸门。
 *
 * 状元仍是 1 份：它不参与收席闸门（见 config/prizes.ts 的 ENDING_PRIZE_KEYS）。
 */
function lastPieceInventory(key: EndingPrizeKey = 'TWO_LIFT'): InventoryState {
  const counts = { ONE_SHOW: 0, TWO_LIFT: 0, THREE_RED: 0, FOUR_ADVANCE: 0, DUITANG: 0, CHAMPION: 1 };
  counts[key] = 1;
  return { counts: { ...counts }, initial: { ...counts } };
}

/**
 * 4 人局打完一局小牌，正好 4 掷：
 *
 *   座位 1 博出状元（四点红）→ 追状元开跑 →
 *   座位 2、3 都没博过 → 座位 4 追的同时博走了最后一份饼 →
 *   追完一轮回到普通回合，闸门立刻收席。
 *
 * 最后这一掷刻意安排在**追状元期间**：它同时验证了
 * 「追完回到普通回合」与「回到普通回合时饼尽即收席」这两条路径的接缝。
 */
function playOneGame(h: Harness): RollRecord[] {
  return [
    playTurn(h, D_FOUR_FOUR),
    playTurn(h, D_NONE),
    playTurn(h, D_NONE),
    playTurn(h, D_TWO_LIFT),
  ];
}

interface TestPlayer {
  id: string;
  guestId: string;
  token: string;
  seat: number;
  nickname: string;
}

interface Harness {
  engine: GameEngine;
  clock: FakeClock;
  rng: ScriptRng;
  events: EngineEvent[];
  players: TestPlayer[];
  actions: number;
  guestSeq: number;
}

function createHarness(opts: { inventory?: InventoryState } = {}): Harness {
  const clock = new FakeClock();
  const rng = new ScriptRng();
  const events: EngineEvent[] = [];
  const engine = new GameEngine({
    clock,
    rng: rng.next,
    emit: (batch) => {
      events.push(...batch);
    },
    // 不传就是正常发牌（一桌 57 份）；传了就用这副小牌，几步就能博到饼尽
    ...(opts.inventory ? { inventoryFor: () => structuredClone(opts.inventory!) } : {}),
  });
  return { engine, clock, rng, events, players: [], actions: 0, guestSeq: 0 };
}

function addPlayer(h: Harness, nickname?: string): TestPlayer {
  h.guestSeq += 1;
  const guestId = `guest_${h.guestSeq}`;
  const name = nickname ?? `客${h.guestSeq}`;
  const res = h.engine.join({ guestId, nickname: name, sessionToken: null, socketId: `sock_${h.guestSeq}` });
  if (!res.ok) throw new Error(`join failed: ${res.error} ${res.message}`);
  const player: TestPlayer = {
    id: res.data.playerId,
    guestId,
    token: res.data.sessionToken,
    seat: res.data.seat,
    nickname: name,
  };
  h.players.push(player);
  return player;
}

function fill(h: Harness, count: number): void {
  for (let i = 0; i < count; i += 1) addPlayer(h);
}

function hostId(h: Harness): string {
  const id = h.engine.snapshot().hostId;
  if (!id) throw new Error('no host');
  return id;
}

function startGame(h: Harness): void {
  const res = h.engine.start(hostId(h));
  if (!res.ok) throw new Error(`start failed: ${res.error} ${res.message}`);
}

/** 当前回合的玩家。 */
function currentPlayerId(h: Harness): string {
  const turn = h.engine.snapshot().currentTurn;
  if (!turn) throw new Error('no current turn');
  return turn.playerId;
}

/**
 * 以指定骰子完成当前回合，但**不推进时钟**。
 * 需要观察「开奖刚结束、下一回合还没开始」那一刻的快照时用它。
 * 传空数组表示不预设骰子，交由 rng 的回落值决定（回落是循环的 D_NONE，即「无奖」）。
 */
function rollOnly(h: Harness, dice: number[] = D_NONE): RollRecord {
  h.rng.push(...dice);
  const turn = h.engine.snapshot().currentTurn;
  if (!turn) throw new Error('no current turn');
  h.actions += 1;
  const res = h.engine.roll(turn.playerId, turn.turnId, `act_${h.actions}`);
  if (!res.ok) throw new Error(`roll failed: ${res.error} ${res.message}`);
  return res.data;
}

/** 把时钟推过「演出时间」，让引擎进入下一回合。 */
function advance(h: Harness): void {
  h.clock.advance(TRANSITION_MS);
}

/** 以指定骰子完成当前回合，并推进到下一回合。 */
function playTurn(h: Harness, dice: number[] = D_NONE): RollRecord {
  const roll = rollOnly(h, dice);
  advance(h);
  return roll;
}

function expectFail<T>(res: EngineResult<T>, code: ErrorCode): void {
  expect(res.ok).toBe(false);
  if (!res.ok) expect(res.error).toBe(code);
}

const scoreOf = (h: Harness, id: string): number =>
  h.engine.snapshot().players.find((p) => p.id === id)?.score ?? -1;

/* ------------------------------------------------------------------ *
 * 1. 开局人数
 * ------------------------------------------------------------------ */

describe('开局人数', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
  });

  it('1 个人不能开局', () => {
    fill(h, 1);
    expectFail(h.engine.start(hostId(h)), 'NOT_ENOUGH_PLAYERS');
    expect(h.engine.snapshot().phase).toBe('LOBBY');
  });

  it('2 个人可以开局', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('NORMAL_TURN');
    expect(snap.currentTurn?.seat).toBe(1);
    expect(snap.players).toHaveLength(MIN_PLAYERS);
  });

  it(`${MAX_PLAYERS} 个人可以开局`, () => {
    fill(h, MAX_PLAYERS);
    startGame(h);
    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    expect(h.engine.snapshot().players).toHaveLength(MAX_PLAYERS);
  });

  it(`第 ${MAX_PLAYERS + 1} 个人会被拒绝`, () => {
    fill(h, MAX_PLAYERS);
    const res = h.engine.join({
      guestId: 'guest_overflow',
      nickname: '挤不进来',
      sessionToken: null,
      socketId: 'sock_overflow',
    });
    expectFail(res, 'ROOM_FULL');
    expect(h.engine.snapshot().players).toHaveLength(MAX_PLAYERS);
  });

  it(`满 ${MAX_PLAYERS} 人后 5 秒自动开局`, () => {
    fill(h, MAX_PLAYERS);
    expect(h.engine.snapshot().autoStartAt).not.toBeNull();
    h.clock.advance(AUTO_START_COUNTDOWN_MS);
    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    expect(h.engine.snapshot().autoStartAt).toBeNull();
  });

  it('满员倒计时途中有人离席，自动开局会被取消', () => {
    fill(h, MAX_PLAYERS);
    expect(h.engine.snapshot().autoStartAt).not.toBeNull();
    h.engine.disconnect(h.players[0]!.id);
    h.clock.advance(AUTO_START_COUNTDOWN_MS);
    // 掉线玩家 60 秒后才被移出座位，所以人数不变，但倒计时已取消
    expect(h.engine.snapshot().autoStartAt).toBeNull();
  });

  it('非房主不能开局', () => {
    fill(h, MIN_PLAYERS);
    expectFail(h.engine.start(h.players[1]!.id), 'NOT_HOST');
  });

  it('开局后陌生人无法再加入', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    const res = h.engine.join({
      guestId: 'guest_stranger',
      nickname: '不速之客',
      sessionToken: null,
      socketId: 'sock_stranger',
    });
    expectFail(res, 'GAME_ALREADY_STARTED');
  });

  it('开局后携带无效 token 也无法加入', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    const res = h.engine.join({
      guestId: 'guest_fake',
      nickname: '冒名者',
      sessionToken: 'st_bogus_token',
      socketId: 'sock_fake',
    });
    expectFail(res, 'INVALID_SESSION');
  });

  it('开局后有效 token 可以重连，座位与身份不变', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    const target = h.players[1]!;
    h.engine.disconnect(target.id);
    expect(h.engine.snapshot().players.find((p) => p.id === target.id)?.online).toBe(false);

    const res = h.engine.join({
      guestId: target.guestId,
      nickname: target.nickname,
      sessionToken: target.token,
      socketId: 'sock_reconnect',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.playerId).toBe(target.id);
      expect(res.data.seat).toBe(target.seat);
      expect(res.data.sessionToken).toBe(target.token);
    }
    expect(h.engine.snapshot().players.find((p) => p.id === target.id)?.online).toBe(true);
  });

  it('开局后重连不会新增玩家', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    const before = h.engine.snapshot().players.length;
    const target = h.players[0]!;
    h.engine.disconnect(target.id);
    h.engine.join({
      guestId: target.guestId,
      nickname: target.nickname,
      sessionToken: target.token,
      socketId: 'sock_re',
    });
    expect(h.engine.snapshot().players).toHaveLength(before);
  });

  it('同一个浏览器重复入席会被拒绝', () => {
    fill(h, 2);
    const res = h.engine.join({
      guestId: h.players[0]!.guestId,
      nickname: '重开一个标签页',
      sessionToken: null,
      socketId: 'sock_dup',
    });
    expectFail(res, 'INVALID_SESSION');
  });

  it('等待大厅里掉线超过 TTL 会被移出座位，座位号重新紧排', () => {
    // 显式凑 4 人：只有当「中间有人离席、后面还有更高座位号」时，
    // 「座位号重新紧排」才有意义（2 人局删掉座位 2 就只剩 [1]，测不到重排）。
    fill(h, 4);
    const leaving = h.players[1]!; // 座位 2
    h.engine.disconnect(leaving.id);
    expect(h.engine.snapshot().players).toHaveLength(4);

    h.clock.advance(LOBBY_GHOST_TTL_MS);

    const snap = h.engine.snapshot();
    expect(snap.players).toHaveLength(3);
    expect(snap.players.some((p) => p.id === leaving.id)).toBe(false);
    expect(snap.players.map((p) => p.seat)).toEqual([1, 2, 3]);
  });

  it('游戏一旦开始，掉线玩家永远不会被移出座位', () => {
    fill(h, MIN_PLAYERS);
    startGame(h);
    h.engine.disconnect(h.players[0]!.id);
    h.clock.advance(LOBBY_GHOST_TTL_MS * 3);
    expect(h.engine.snapshot().players).toHaveLength(MIN_PLAYERS);
    expect(h.engine.snapshot().players.find((p) => p.id === h.players[0]!.id)?.online).toBe(false);
  });

  it('房主掉线后由座位最靠前的在线玩家接任', () => {
    fill(h, MIN_PLAYERS);
    const first = h.players[0]!;
    expect(h.engine.snapshot().hostId).toBe(first.id);
    h.engine.disconnect(first.id);
    expect(h.engine.snapshot().hostId).toBe(h.players[1]!.id);
  });
});

/* ------------------------------------------------------------------ *
 * 2. 回合、防重复与超时
 * ------------------------------------------------------------------ */

describe('回合与防重复', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
    fill(h, 4);
    startGame(h);
  });

  it('不是当前回合的玩家不能博饼', () => {
    const turn = h.engine.snapshot().currentTurn!;
    const other = h.players.find((p) => p.id !== turn.playerId)!;
    expectFail(h.engine.roll(other.id, turn.turnId, 'act'), 'NOT_YOUR_TURN');
  });

  it('turnId 不匹配会被拒绝', () => {
    const turn = h.engine.snapshot().currentTurn!;
    expectFail(h.engine.roll(turn.playerId, 'turn_999999', 'act'), 'INVALID_TURN');
  });

  it('按座位顺序轮流，一圈之后回到第一席', () => {
    const seen: number[] = [];
    for (let i = 0; i < 5; i += 1) {
      seen.push(h.engine.snapshot().currentTurn!.seat);
      playTurn(h, D_NONE);
    }
    expect(seen).toEqual([1, 2, 3, 4, 1]);
  });

  it('同一次点击重复提交只生效一次', () => {
    const turn = h.engine.snapshot().currentTurn!;
    h.rng.push(...D_NONE);
    const first = h.engine.roll(turn.playerId, turn.turnId, 'act_same');
    expect(first.ok).toBe(true);

    const second = h.engine.roll(turn.playerId, turn.turnId, 'act_same');
    expectFail(second, 'TURN_ALREADY_ROLLED');

    expect(h.engine.snapshot().stats.totalRolls).toBe(1);
  });

  it('同一回合换一个 actionId 也博不了第二次', () => {
    const turn = h.engine.snapshot().currentTurn!;
    h.rng.push(...D_NONE);
    expect(h.engine.roll(turn.playerId, turn.turnId, 'act_a').ok).toBe(true);
    expectFail(h.engine.roll(turn.playerId, turn.turnId, 'act_b'), 'TURN_ALREADY_ROLLED');
    expect(h.engine.snapshot().stats.totalRolls).toBe(1);
  });

  it('骰子完全由服务端决定，客户端只能提交「我要博饼」', () => {
    const roll = playTurn(h, D_DUITANG);
    expect(roll.dice).toEqual([1, 2, 3, 4, 5, 6]);
    expect(roll.awardId).toBe('DUITANG');
    expect(roll.scoreGained).toBe(15);
  });

  it('30 秒无操作时由服务器自动代掷', () => {
    expect(h.engine.snapshot().stats.totalRolls).toBe(0);
    h.clock.advance(TURN_TIMEOUT_MS);
    const snap = h.engine.snapshot();
    expect(snap.stats.totalRolls).toBe(1);
    expect(snap.stats.autoRolls).toBe(1);
    expect(snap.lastRoll?.auto).toBe(true);
  });

  it('掉线的玩家一样会被自动代掷，游戏不会卡住', () => {
    const current = currentPlayerId(h);
    h.engine.disconnect(current);
    h.clock.advance(TURN_TIMEOUT_MS);
    const snap = h.engine.snapshot();
    expect(snap.stats.totalRolls).toBe(1);
    expect(snap.lastRoll?.playerId).toBe(current);
    expect(snap.lastRoll?.auto).toBe(true);
  });

  it('离线玩家轮到时只等 10 秒，在线玩家仍是 30 秒', () => {
    // 座位 1 先手。让座位 2 掉线，再照常打完座位 1 这一手 ——
    // 轮到座位 2 时应该走「离线档」，而不是让全桌陪一个空座位干等 30 秒。
    const offline = h.players[1]!;
    h.engine.disconnect(offline.id);
    playTurn(h, D_NONE);

    const offlineTurn = h.engine.snapshot().currentTurn!;
    expect(offlineTurn.playerId).toBe(offline.id);
    expect(offlineTurn.deadlineAt - offlineTurn.startedAt).toBe(TURN_TIMEOUT_OFFLINE_MS);

    // 再转一圈回到在线玩家，等待时间恢复原样 —— 离线档只针对离线的那一位，
    // 不是把所有人的思考时间都砍短了。
    for (let i = 0; i < 3; i += 1) playTurn(h, D_NONE);
    const onlineTurn = h.engine.snapshot().currentTurn!;
    expect(onlineTurn.playerId).toBe(h.players[0]!.id);
    expect(onlineTurn.deadlineAt - onlineTurn.startedAt).toBe(TURN_TIMEOUT_MS);
  });

  it('正好轮到他时掉线，剩下的等待立刻缩短到 10 秒', () => {
    const current = currentPlayerId(h);
    const before = h.engine.snapshot().currentTurn!;
    expect(before.deadlineAt - before.startedAt).toBe(TURN_TIMEOUT_MS);

    h.engine.disconnect(current);

    // deadlineAt 必须一起改，否则客户端倒计时和服务端的表对不上
    const after = h.engine.snapshot().currentTurn!;
    expect(after.deadlineAt - h.clock.now()).toBe(TURN_TIMEOUT_OFFLINE_MS);
  });

  it('离线玩家的回合 10 秒就代掷，不用等满 30 秒', () => {
    const current = currentPlayerId(h);
    h.engine.disconnect(current);

    h.clock.advance(TURN_TIMEOUT_OFFLINE_MS - 1);
    expect(h.engine.snapshot().stats.autoRolls).toBe(0);

    h.clock.advance(1);
    const snap = h.engine.snapshot();
    expect(snap.stats.autoRolls).toBe(1);
    expect(snap.lastRoll?.playerId).toBe(current);
    expect(snap.lastRoll?.auto).toBe(true);
  });

  it('超时后回合继续推进，一圈一圈不会停', () => {
    for (let i = 0; i < 6; i += 1) {
      h.rng.push(...D_NONE); // 每一把超时代掷都掷出无奖，游戏会一直转下去
      h.clock.advance(TURN_TIMEOUT_MS + TRANSITION_MS);
    }
    const snap = h.engine.snapshot();
    expect(snap.stats.totalRolls).toBe(6);
    expect(snap.stats.autoRolls).toBe(6);
    expect(snap.phase).toBe('NORMAL_TURN');
    // 6 次正好 1.5 圈，此刻轮到座位 3
    expect(snap.currentTurn?.seat).toBe(3);
  });

  it('reconcile 会补上错过的超时回合（服务端休眠后自愈）', () => {
    const current = currentPlayerId(h);
    // 绕过定时器，直接把时钟拨到截止之后
    h.clock.advance(TURN_TIMEOUT_MS - 1);
    expect(h.engine.snapshot().stats.totalRolls).toBe(0);
    h.clock.advance(1);
    expect(h.engine.snapshot().lastRoll?.playerId).toBe(current);
    expect(h.engine.sync().stateVersion).toBeGreaterThan(0);
  });

  it('回合截止时间正好是 30 秒之后', () => {
    const turn = h.engine.snapshot().currentTurn!;
    expect(turn.deadlineAt - turn.startedAt).toBe(TURN_TIMEOUT_MS);
  });

  it('每回合的 turnId 都不相同', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 8; i += 1) {
      const turn = h.engine.snapshot().currentTurn!;
      ids.add(turn.turnId);
      playTurn(h, D_NONE);
    }
    expect(ids.size).toBe(8);
  });

});

/* ------------------------------------------------------------------ *
 * 3. 奖品与积分
 * ------------------------------------------------------------------ */

describe('奖品与积分', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
    fill(h, 4);
    startGame(h);
  });

  it('库存充足时扣库存、加积分、记奖品', () => {
    const roll = playTurn(h, D_THREE_RED);
    expect(roll.prizeGranted).toBe(true);
    expect(roll.inventoryExhausted).toBe(false);
    expect(roll.prizeKey).toBe('THREE_RED');
    expect(roll.scoreGained).toBe(5);
    expect(scoreOf(h, roll.playerId)).toBe(5);

    const snap = h.engine.snapshot();
    expect(snap.inventory.counts.THREE_RED).toBe(snap.inventory.initial.THREE_RED - 1);
    expect(snap.players.find((p) => p.id === roll.playerId)?.prizes.THREE_RED).toBe(1);
  });

  it('无奖不发奖不加分', () => {
    const roll = playTurn(h, D_NONE);
    expect(roll.awardId).toBe('NONE');
    expect(roll.prizeGranted).toBe(false);
    expect(roll.inventoryExhausted).toBe(false);
    expect(roll.scoreGained).toBe(0);
    expect(scoreOf(h, roll.playerId)).toBe(0);
  });

  it('库存为 0 时骰型照常显示，但不发奖不加分', () => {
    // 一桌三红只有 4 份（配货按概率算出来的，见 config/prizes.ts），一圈领完就没了
    for (let i = 0; i < 4; i += 1) playTurn(h, D_THREE_RED);
    expect(h.engine.snapshot().inventory.counts.THREE_RED).toBe(0);

    const before = h.engine.snapshot().players.map((p) => p.score);
    const roll = playTurn(h, D_THREE_RED); // 又轮到座位 1

    expect(roll.awardId).toBe('THREE_RED');
    expect(roll.dice).toEqual([4, 4, 4, 2, 3, 5]); // 骰型照常显示
    expect(roll.prizeGranted).toBe(false);
    expect(roll.inventoryExhausted).toBe(true);
    expect(roll.scoreGained).toBe(0);
    // 谁的分都不该变
    expect(h.engine.snapshot().players.map((p) => p.score)).toEqual(before);
    expect(h.engine.snapshot().inventory.counts.THREE_RED).toBe(0);
  });

  it('Champion Tier 在掷出的那一刻不发奖也不加分（延后到结算）', () => {
    const roll = playTurn(h, D_FOUR_FOUR);
    expect(roll.isChampionTier).toBe(true);
    expect(roll.prizeGranted).toBe(false);
    expect(roll.inventoryExhausted).toBe(false);
    expect(roll.scoreGained).toBe(0);
    expect(scoreOf(h, roll.playerId)).toBe(0);
    // 状元库存原封不动，等结算时再发
    expect(h.engine.snapshot().inventory.counts.CHAMPION).toBe(1);
    expect(h.engine.snapshot().players.find((p) => p.id === roll.playerId)?.prizes.CHAMPION).toBeUndefined();
  });

  it('不同奖项各自扣各自的库存', () => {
    playTurn(h, D_ONE_SHOW);
    playTurn(h, D_TWO_LIFT);
    playTurn(h, D_DUITANG);
    playTurn(h, D_NONE);
    const snap = h.engine.snapshot();
    const inv = snap.inventory.counts;
    const before = snap.inventory.initial;
    expect(inv.ONE_SHOW).toBe(before.ONE_SHOW - 1);
    expect(inv.TWO_LIFT).toBe(before.TWO_LIFT - 1);
    expect(inv.DUITANG).toBe(before.DUITANG - 1);
    // 没碰过的那样一动不动
    expect(inv.THREE_RED).toBe(before.THREE_RED);
  });

  it('每一位玩家各自累计自己的奖品与积分', () => {
    playTurn(h, D_ONE_SHOW);
    playTurn(h, D_ONE_SHOW);
    playTurn(h, D_ONE_SHOW);
    playTurn(h, D_ONE_SHOW);
    const snap = h.engine.snapshot();
    for (const p of snap.players) {
      expect(p.score).toBe(1);
      expect(p.prizes.ONE_SHOW).toBe(1);
      expect(p.rollCount).toBe(1);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4. 追状元
 * ------------------------------------------------------------------ */

describe('追状元', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
    fill(h, 4);
    startGame(h);
  });

  it('首位状元出现后立刻进入追状元阶段', () => {
    const roll = playTurn(h, D_FOUR_FOUR);
    const snap = h.engine.snapshot();
    expect(roll.becameFirstChampion).toBe(true);
    expect(snap.phase).toBe('CHAMPION_CHASE');
    expect(snap.champion.playerId).toBe(roll.playerId);
    expect(snap.champion.rank).toBe(1);
    expect(snap.champion.awardId).toBe('FOUR_FOUR');
    expect(snap.stats.firstChampionRollIndex).toBe(1);
  });

  it('追状元队列长度为 N-1，且不含首位状元本人', () => {
    // 用 rollOnly：一旦推进时钟，队列的第一位就已经被取走开跑了
    const roll = rollOnly(h, D_FOUR_FOUR);
    const snap = h.engine.snapshot();
    expect(snap.champion.chaseQueue).toHaveLength(3);
    expect(snap.champion.chaseTotal).toBe(3);
    expect(snap.champion.chaseQueue).not.toContain(roll.playerId);
    expect(snap.champion.chaseDone).toBe(0);
    advance(h);
  });

  it('追状元按座位顺序从状元的下家开始', () => {
    const champion = h.engine.snapshot().currentTurn!;
    rollOnly(h, D_FOUR_FOUR); // 状元在座位 1
    const expected = h.players
      .filter((p) => p.id !== champion.playerId)
      .sort((a, b) => a.seat - b.seat)
      .map((p) => p.id);
    expect(h.engine.snapshot().champion.chaseQueue).toEqual(expected);
    advance(h);
    // 下家（座位 2）先追
    expect(currentPlayerId(h)).toBe(expected[0]);
  });

  it('同等级不能反超，先出现者保持状元', () => {
    const first = playTurn(h, D_FOUR_FOUR);
    const challenger = playTurn(h, D_FOUR_FOUR); // 同样是四点红 rank 1
    expect(challenger.replacedChampion).toBe(false);
    expect(challenger.isChampionTier).toBe(true);
    const snap = h.engine.snapshot();
    expect(snap.champion.playerId).toBe(first.playerId);
    expect(snap.champion.replacements).toBe(0);
    expect(snap.stats.championReplacements).toBe(0);
  });

  it('更高等级可以反超，金榜易主', () => {
    const first = playTurn(h, D_FOUR_FOUR); // rank 1
    const challenger = playTurn(h, D_FIVE_SCHOLAR); // rank 2
    expect(challenger.replacedChampion).toBe(true);
    const snap = h.engine.snapshot();
    expect(snap.champion.playerId).toBe(challenger.playerId);
    expect(snap.champion.rank).toBe(2);
    expect(snap.players.find((p) => p.id === first.playerId)?.id).toBe(first.playerId);
    expect(snap.stats.championReplacements).toBe(1);
  });

  it('更低等级不能反超', () => {
    playTurn(h, D_FIVE_SCHOLAR); // rank 2
    const lower = playTurn(h, D_FOUR_FOUR); // rank 1
    expect(lower.replacedChampion).toBe(false);
    expect(h.engine.snapshot().champion.rank).toBe(2);
  });

  it('最后一位挑战者仍然可以反超，追完回到普通回合', () => {
    playTurn(h, D_FOUR_FOUR); // 座位 1 成为状元
    playTurn(h, D_NONE); // 座位 2 追不上
    playTurn(h, D_NONE); // 座位 3 追不上
    const last = playTurn(h, D_SIX_FOUR); // 座位 4，最后一位 —— 六杯红 rank 6
    expect(last.replacedChampion).toBe(true);

    const snap = h.engine.snapshot();
    expect(snap.champion.playerId).toBe(last.playerId);
    expect(snap.champion.rank).toBe(6);
    expect(snap.stats.championReplacements).toBe(1);
  });

  it('只追一圈：N-1 位各追一次后回到普通回合，不是直接收席', () => {
    const champion = playTurn(h, D_FOUR_FOUR); // 1 次 + 3 位挑战者
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('NORMAL_TURN');
    expect(snap.result).toBeNull();
    expect(snap.champion.chaseQueue).toHaveLength(0);
    expect(snap.champion.chaseDone).toBe(3);
    expect(snap.stats.totalRolls).toBe(4);
    // 队列止于状元的前一位，所以下一位正好回到状元本人，接着博
    expect(snap.currentTurn?.playerId).toBe(champion.playerId);
    expect(snap.currentTurn?.kind).toBe('NORMAL');
    // 状元奖要等收席才发，此刻还封在库存里
    expect(snap.inventory.counts.CHAMPION).toBe(1);
    expect(snap.players.some((p) => p.prizes.CHAMPION !== undefined)).toBe(false);
  });

  it('追状元阶段掷出的骰子与普通回合完全一样（都是纯随机）', () => {
    playTurn(h, D_FOUR_FOUR);
    const chase = playTurn(h, D_DUITANG);
    expect(chase.kind).toBe('CHASE');
    expect(chase.dice).toEqual([1, 2, 3, 4, 5, 6]);
    expect(chase.awardId).toBe('DUITANG');
  });

  it('普通回合里只有刷新榜首才开新一轮追状元', () => {
    // 座位 1 先以五子登科（rank 2）坐庄，追完一轮回到普通回合
    const first = playTurn(h, D_FIVE_SCHOLAR);
    playTurn(h, D_NONE); // 座位 2 追
    playTurn(h, D_NONE); // 座位 3
    playTurn(h, D_NONE); // 座位 4 —— 追完，回到普通回合
    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');

    // 座位 1 博出一个**更低**的状元档：不开新一轮、榜首不改
    const lower = playTurn(h, D_FOUR_FOUR); // rank 1 < 2
    expect(lower.isChampionTier).toBe(true);
    expect(lower.replacedChampion).toBe(false);
    expect(lower.becameFirstChampion).toBe(false);
    let snap = h.engine.snapshot();
    expect(snap.phase).toBe('NORMAL_TURN');
    expect(snap.champion.playerId).toBe(first.playerId);
    expect(snap.champion.rank).toBe(2);
    expect(snap.stats.championReplacements).toBe(0);
    expect(snap.stats.firstChampionRollIndex).toBe(1);

    // 转一圈回到座位 1，这次博出一个**更高**的：夺榜 + 重新开一轮追状元
    playTurn(h, D_NONE); // 座位 2
    playTurn(h, D_NONE); // 座位 3
    playTurn(h, D_NONE); // 座位 4
    // 用 rollOnly：推进时钟会把第一位挑战者从队列里取走，就看不到 N-1 这个整队了
    const higher = rollOnly(h, D_SIX_FOUR); // 座位 1，六杯红 rank 6

    expect(higher.replacedChampion).toBe(true);
    snap = h.engine.snapshot();
    expect(snap.phase).toBe('CHAMPION_CHASE');
    expect(snap.champion.playerId).toBe(higher.playerId);
    expect(snap.champion.rank).toBe(6);
    expect(snap.champion.chaseTotal).toBe(3);
    expect(snap.champion.chaseDone).toBe(0);
    expect(snap.champion.chaseQueue).toHaveLength(3);
    expect(snap.champion.chaseQueue).not.toContain(higher.playerId);
    expect(snap.stats.championReplacements).toBe(1);
    expect(snap.stats.firstChampionRollIndex).toBe(1); // 首位状元仍然是第 1 掷
    advance(h);
  });

  it('追状元途中易主只夺榜，不会嵌套开一轮新的', () => {
    const first = playTurn(h, D_FOUR_FOUR); // 座位 1，rank 1
    const second = rollOnly(h, D_FIVE_SCHOLAR); // 座位 2 追状元时反超，rank 2

    const snap = h.engine.snapshot();
    expect(second.replacedChampion).toBe(true);
    expect(snap.champion.playerId).toBe(second.playerId);
    // 队列还是首状元建的那一条（[2,3,4]，座位 2 已经出队），只是换了个人坐庄。
    // 如果易主时重建成了「从新状元的下家开始、再把新状元排除掉」，
    // 这里会变成 [3,4,1] —— 长度 3、且含着座位 1。
    expect(snap.champion.chaseQueue).toEqual([h.players[2]!.id, h.players[3]!.id]);
    expect(snap.champion.chaseQueue).not.toContain(first.playerId);
    expect(snap.champion.chaseTotal).toBe(3);
    expect(snap.champion.chaseDone).toBe(1);
    advance(h);
  });
});

/* ------------------------------------------------------------------ *
 * 5. 结算与状元奖
 * ------------------------------------------------------------------ */

describe('结算与最终状元', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness({ inventory: lastPieceInventory() });
    fill(h, 4);
    startGame(h);
  });

  it('状元奖只发一次，且正好 +100 分', () => {
    const [champion] = playOneGame(h);

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('FINISHED');
    // 四点红基础 30 + 状元奖励 100（最后那一份饼是座位 4 博走的，不进状元的分）
    expect(scoreOf(h, champion!.playerId)).toBe(130);
    expect(snap.players.find((p) => p.id === champion!.playerId)?.prizes.CHAMPION).toBe(1);
    expect(snap.inventory.counts.CHAMPION).toBe(0);
    expect(h.engine.inspect().championPrizeGranted).toBe(true);
  });

  it('结算结果包含完整榜单与状元信息', () => {
    const [champion] = playOneGame(h);

    const result = h.engine.snapshot().result;
    expect(result).not.toBeNull();
    expect(result!.champion).not.toBeNull();
    expect(result!.champion!.playerId).toBe(champion!.playerId);
    expect(result!.champion!.awardId).toBe('FOUR_FOUR');
    expect(result!.champion!.baseScore).toBe(30);
    expect(result!.champion!.bonus).toBe(100);
    expect(result!.champion!.dice).toEqual([4, 4, 4, 4, 2, 6]);
    expect(result!.endReason).toBe('INVENTORY_EMPTY');
    expect(result!.ranking).toHaveLength(4);
    // 榜单按积分降序
    const scores = result!.ranking.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(result!.ranking[0]!.isFinalChampion).toBe(true);
    expect(result!.ranking[0]!.score).toBe(130);
  });

  it('换人之后由最终状元拿奖，被替换者一分不得', () => {
    const first = playTurn(h, D_FOUR_FOUR); // 座位 1，rank 1
    const second = playTurn(h, D_FIVE_SCHOLAR); // 座位 2 反超，rank 2
    playTurn(h, D_NONE); // 座位 3
    playTurn(h, D_TWO_LIFT); // 座位 4 追状元的同时博走最后一份饼 → 收席

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('FINISHED');
    const result = snap.result!;
    expect(result.champion!.playerId).toBe(second.playerId);
    expect(result.champion!.awardId).toBe('FIVE_SCHOLAR');
    // 五子登科基础 40 + 100
    expect(scoreOf(h, second.playerId)).toBe(140);
    // 首位状元（四点红）在掷出时就是延后状态，被反超后什么也拿不到
    expect(scoreOf(h, first.playerId)).toBe(0);
    expect(snap.players.find((p) => p.id === first.playerId)?.prizes.CHAMPION).toBeUndefined();
    expect(snap.inventory.counts.CHAMPION).toBe(0);
    expect(snap.stats.championReplacements).toBe(1);
  });

  it('状元奖在整个房间生命周期内只发一次（重复结算也不会翻倍）', () => {
    playOneGame(h);
    const scoreAfterFinish = Math.max(...h.engine.snapshot().players.map((p) => p.score));

    // 再推进很久，不应该有任何新的发奖
    h.clock.advance(TRANSITION_MS * 10);
    expect(Math.max(...h.engine.snapshot().players.map((p) => p.score))).toBe(scoreAfterFinish);
    expect(h.engine.inspect().championPrizeGranted).toBe(true);
  });

  it('本局用时被记录下来', () => {
    playOneGame(h);
    expect(h.engine.snapshot().stats.durationMs).toBeGreaterThan(0);
  });

  it('游戏结束后再博饼会被拒绝', () => {
    playOneGame(h);
    expect(h.engine.snapshot().phase).toBe('FINISHED');
    const somePlayer = h.players[0]!;
    expectFail(h.engine.roll(somePlayer.id, 'turn_000001', 'act'), 'GAME_FINISHED');
  });
});

/* ------------------------------------------------------------------ *
 * 6. 博到饼尽
 * ------------------------------------------------------------------ */

describe('博到饼尽', () => {
  it('五样普通饼博完就收席，一个状元都没有也是正常结局', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, 4);
    startGame(h);

    // 前三掷全是无奖，谁也没碰上那最后一份饼
    for (let i = 0; i < 3; i += 1) {
      expect(playTurn(h, D_NONE).awardId).toBe('NONE');
      expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    }
    const last = playTurn(h, D_TWO_LIFT);

    const snap = h.engine.snapshot();
    expect(last.prizeGranted).toBe(true);
    expect(last.scoreGained).toBe(2);
    expect(snap.phase).toBe('FINISHED');
    expect(snap.currentTurn).toBeNull();

    const result = snap.result!;
    expect(result).not.toBeNull();
    expect(result.champion).toBeNull();
    expect(result.endReason).toBe('INVENTORY_EMPTY');
    // 五样普通饼全空，状元原封不动留在桌上
    for (const key of ENDING_PRIZE_KEYS) expect(snap.inventory.counts[key]).toBe(0);
    expect(snap.inventory.counts.CHAMPION).toBe(1);
    // 谁也不是状元，谁也拿不到状元奖
    expect(result.ranking).toHaveLength(4);
    expect(result.ranking.every((e) => !e.isFinalChampion)).toBe(true);
    expect(snap.players.every((p) => p.prizes.CHAMPION === undefined)).toBe(true);
    expect(snap.champion.playerId).toBeNull();
    expect(snap.champion.finalPlayerId).toBeNull();
    expect(snap.stats.firstChampionRollIndex).toBeNull();
    h.engine.dispose();
  });

  it('状元与饼尽自洽：有状元就发出那 1 份，没状元就原封留着', () => {
    // 有状元的一局
    const withChampion = createHarness({ inventory: lastPieceInventory() });
    fill(withChampion, 4);
    startGame(withChampion);
    playOneGame(withChampion);

    const a = withChampion.engine.snapshot();
    expect(a.phase).toBe('FINISHED');
    expect(a.inventory.initial.CHAMPION).toBe(1);
    expect(a.inventory.counts.CHAMPION).toBe(0);
    expect(a.result!.champion).not.toBeNull();
    const crowned = a.result!.ranking.filter((e) => e.isFinalChampion);
    expect(crowned).toHaveLength(1);
    expect(crowned[0]!.playerId).toBe(a.result!.champion!.playerId);
    expect(a.players.find((p) => p.id === crowned[0]!.playerId)?.prizes.CHAMPION).toBe(1);
    withChampion.engine.dispose();

    // 没有状元的一局
    const noChampion = createHarness({ inventory: lastPieceInventory() });
    fill(noChampion, 4);
    startGame(noChampion);
    playTurn(noChampion, D_NONE);
    playTurn(noChampion, D_NONE);
    playTurn(noChampion, D_NONE);
    playTurn(noChampion, D_TWO_LIFT);

    const b = noChampion.engine.snapshot();
    expect(b.phase).toBe('FINISHED');
    expect(b.inventory.initial.CHAMPION).toBe(1);
    expect(b.inventory.counts.CHAMPION).toBe(1);
    expect(b.result!.champion).toBeNull();
    expect(b.result!.ranking.every((e) => !e.isFinalChampion)).toBe(true);
    expect(b.players.every((p) => p.prizes.CHAMPION === undefined)).toBe(true);
    noChampion.engine.dispose();
  });

  it('饼尽闸门只看五样普通饼，最后一份饼在追状元期间被博走也一样收席', () => {
    // 这正是 playOneGame 的形状：收席由追状元队列里的最后一位触发，
    // 他博走的瞬间 phase 还是 CHAMPION_CHASE —— 闸门要在回到普通回合之后立刻生效。
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, 4);
    startGame(h);
    const rolls = playOneGame(h);

    expect(rolls[3]!.kind).toBe('CHASE');
    expect(rolls[3]!.prizeKey).toBe('TWO_LIFT');
    expect(h.engine.snapshot().phase).toBe('FINISHED');
    expect(h.engine.snapshot().result!.endReason).toBe('INVENTORY_EMPTY');
    h.engine.dispose();
  });

  it('还没博完就不会收席 —— 默认的一桌 57 份要走很久', () => {
    const h = createHarness();
    fill(h, 4);
    startGame(h);
    // 一秀 31 份，博掉 8 份还远远没完
    for (let i = 0; i < 8; i += 1) playTurn(h, D_ONE_SHOW);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('NORMAL_TURN');
    expect(snap.result).toBeNull();
    expect(snap.inventory.counts.ONE_SHOW).toBe(buildInventory().counts.ONE_SHOW - 8);
    expect(snap.inventory.counts).toEqual({
      ...buildInventory().counts,
      ONE_SHOW: buildInventory().counts.ONE_SHOW - 8,
    });
    h.engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 7. 再来一局
 * ------------------------------------------------------------------ */

describe('再来一局', () => {
  /** 2 人局打完一局小牌：座位 1 坐庄，座位 2 追状元时博走最后一份饼。 */
  function finishOneGame(h: Harness): void {
    playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_TWO_LIFT);
    expect(h.engine.snapshot().phase).toBe('FINISHED');
  }

  it('非房主不能开启新的一局', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, MIN_PLAYERS);
    startGame(h);
    finishOneGame(h);
    const notHost = h.players.find((p) => p.id !== hostId(h))!;
    expectFail(h.engine.restart(notHost.id), 'NOT_HOST');
    h.engine.dispose();
  });

  it('还没结束的时候不能重开', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, MIN_PLAYERS);
    startGame(h);
    expectFail(h.engine.restart(hostId(h)), 'GAME_ALREADY_STARTED');
    h.engine.dispose();
  });

  it('重开后积分与奖品清零、库存重置、座位与昵称保留', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, MIN_PLAYERS);
    startGame(h);
    finishOneGame(h);

    const before = h.engine.snapshot();
    expect(before.players.some((p) => p.score > 0)).toBe(true);

    const res = h.engine.restart(hostId(h));
    expect(res.ok).toBe(true);

    const after = h.engine.snapshot();
    expect(after.phase).toBe('LOBBY');
    expect(after.result).toBeNull();
    expect(after.startedAt).toBeNull();
    expect(after.currentTurn).toBeNull();
    expect(after.champion.playerId).toBeNull();
    expect(after.stats.totalRolls).toBe(0);
    // 空桌必须是字面量的全零，不能是「配货后的最小值」——
    // 配货有 max(1, …) 下限，复用的话台面会清不干净。
    expect(after.inventory.counts.ONE_SHOW).toBe(0);
    expect(after.inventory.counts.CHAMPION).toBe(0);
    for (const p of after.players) {
      expect(p.score).toBe(0);
      expect(p.prizes).toEqual({});
      expect(p.rollCount).toBe(0);
    }
    // 座位与昵称保留
    expect(after.players.map((p) => p.seat)).toEqual(before.players.map((p) => p.seat));
    expect(after.players.map((p) => p.nickname)).toEqual(before.players.map((p) => p.nickname));
    h.engine.dispose();
  });

  it('重开后可以立刻再开一局，且能正常发奖', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, MIN_PLAYERS);
    startGame(h);
    finishOneGame(h);
    h.engine.restart(hostId(h));
    startGame(h);

    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    // 牌重新发过一副，与开局时一模一样
    expect(h.engine.snapshot().inventory.counts).toEqual(lastPieceInventory().counts);
    const roll = playTurn(h, D_TWO_LIFT);
    expect(roll.prizeGranted).toBe(true);
    expect(roll.scoreGained).toBe(2);
    h.engine.dispose();
  });

  it('第二局的 turnId 不会和第一局撞车', () => {
    const h = createHarness({ inventory: lastPieceInventory() });
    fill(h, MIN_PLAYERS);
    startGame(h);
    const firstGameTurnIds = new Set<string>();
    for (let i = 0; i < 2; i += 1) {
      firstGameTurnIds.add(h.engine.snapshot().currentTurn!.turnId);
      playTurn(h, D_NONE);
    }
    // 又轮到座位 1，把这一局打完
    firstGameTurnIds.add(h.engine.snapshot().currentTurn!.turnId);
    finishOneGame(h);
    h.engine.restart(hostId(h));
    startGame(h);
    const secondTurnId = h.engine.snapshot().currentTurn!.turnId;
    expect(firstGameTurnIds.has(secondTurnId)).toBe(false);
    h.engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 8. 快照契约
 * ------------------------------------------------------------------ */

describe('快照契约', () => {
  it('每次状态变化都会让 stateVersion 单调递增', () => {
    const h = createHarness();
    let last = h.engine.snapshot().stateVersion;
    for (let i = 0; i < MIN_PLAYERS; i += 1) {
      addPlayer(h);
      const next = h.engine.snapshot().stateVersion;
      expect(next).toBeGreaterThan(last);
      last = next;
    }
    h.engine.dispose();
  });

  it('快照里带上服务端时间与人数上下限，供客户端校正倒计时', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    const snap = h.engine.snapshot();
    expect(snap.serverTime).toBe(h.clock.now());
    expect(snap.minPlayers).toBe(MIN_PLAYERS);
    expect(snap.maxPlayers).toBe(MAX_PLAYERS);
    expect(snap.roomId).toBe('MAIN_ROOM');
    h.engine.dispose();
  });

  it('快照不会泄露 sessionToken', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const json = JSON.stringify(h.engine.snapshot());
    for (const p of h.players) {
      expect(json).not.toContain(p.token);
    }
    h.engine.dispose();
  });

  it('玩家列表始终按座位排序', () => {
    const h = createHarness();
    fill(h, 6);
    const seats = h.engine.snapshot().players.map((p) => p.seat);
    expect(seats).toEqual([...seats].sort((a, b) => a - b));
    h.engine.dispose();
  });

  it('发给客户端的快照与内部状态解耦（改快照不会污染引擎）', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const snap = h.engine.snapshot();
    snap.inventory.counts.CHAMPION = 999;
    snap.players[0]!.score = 999;
    snap.gameLog.length = 0;

    const fresh = h.engine.snapshot();
    expect(fresh.inventory.counts.CHAMPION).toBe(1);
    expect(fresh.players[0]!.score).toBe(0);
    h.engine.dispose();
  });

  it('事件与快照一起广播，事件里带得动关键信息', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    h.events.length = 0;

    h.rng.push(...D_FOUR_FOUR);
    const turn = h.engine.snapshot().currentTurn!;
    h.engine.roll(turn.playerId, turn.turnId, 'act');

    const types = h.events.map((e) => e.type);
    expect(types).toContain('roll:started');
    expect(types).toContain('roll:result');
    expect(types).toContain('champion:started');

    const result = h.events.find((e) => e.type === 'roll:result');
    expect(result && result.type === 'roll:result' && result.roll.awardId).toBe('FOUR_FOUR');
    h.engine.dispose();
  });

  it('日志按时间顺序记录，且能反映获奖与状元', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    playTurn(h, D_THREE_RED);
    playTurn(h, D_FOUR_FOUR);

    const log = h.engine.snapshot().gameLog;
    expect(log.length).toBeGreaterThan(0);
    const tones = new Set(log.map((l) => l.tone));
    expect(tones.has('champion')).toBe(true);
    for (let i = 1; i < log.length; i += 1) {
      expect(log[i]!.at).toBeGreaterThanOrEqual(log[i - 1]!.at);
    }
    h.engine.dispose();
  });

  it('reconnect 之后能拿到完整的房间状态（含积分、奖品、阶段）', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const roll = playTurn(h, D_THREE_RED);

    const target = h.players.find((p) => p.id === roll.playerId)!;
    h.engine.disconnect(target.id);
    const res = h.engine.join({
      guestId: target.guestId,
      nickname: target.nickname,
      sessionToken: target.token,
      socketId: 'sock_back',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      const me = res.data.snapshot.players.find((p) => p.id === target.id)!;
      const inv = res.data.snapshot.inventory;
      expect(me.score).toBe(5);
      expect(me.prizes.THREE_RED).toBe(1);
      expect(res.data.snapshot.phase).toBe('NORMAL_TURN');
      expect(res.data.snapshot.result).toBeNull();
      expect(inv.counts.THREE_RED).toBe(inv.initial.THREE_RED - 1);
    }
    h.engine.dispose();
  });

  it('刷新页面后昵称、座位、积分、奖品、游戏状态都能恢复', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const roll = playTurn(h, D_DUITANG);
    playTurn(h, D_FOUR_FOUR);

    const target = h.players.find((p) => p.id === roll.playerId)!;
    h.engine.disconnect(target.id);

    const res = h.engine.join({
      guestId: target.guestId,
      nickname: target.nickname,
      sessionToken: target.token,
      socketId: 'sock_refresh',
    });
    expect(res.ok).toBe(true);
    if (res.ok) {
      const snap = res.data.snapshot;
      const me = snap.players.find((p) => p.id === target.id)!;
      expect(me.nickname).toBe(target.nickname);
      expect(me.seat).toBe(target.seat);
      expect(me.score).toBe(15);
      expect(me.prizes.DUITANG).toBe(1);
      expect(snap.phase).toBe('CHAMPION_CHASE');
      expect(snap.champion.playerId).not.toBeNull();
    }
    h.engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 11. 散场回收（全员掉线后房间必须能重新可用）
 * ------------------------------------------------------------------ */

describe('散场回收', () => {
  it('牌局进行中全员掉线，宽限期内不误判——短暂掉线不该毁掉牌局', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    for (const p of h.players) h.engine.disconnect(p.id);

    h.clock.advance(ABANDON_GRACE_MS - 5_000);

    const snap = h.engine.snapshot();
    expect(snap.players).toHaveLength(MIN_PLAYERS);
    expect(snap.phase).not.toBe('LOBBY');
    h.engine.dispose();
  });

  it('宽限期内只要还有一个人在线，就永远不会作废', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    // 只掉线一个（除房主外），留一个在线
    for (const p of h.players.slice(1)) h.engine.disconnect(p.id);

    h.clock.advance(ABANDON_GRACE_MS * 4);

    const snap = h.engine.snapshot();
    expect(snap.players).toHaveLength(MIN_PLAYERS);
    expect(snap.phase).not.toBe('LOBBY');
    h.engine.dispose();
  });

  it('全员掉线且宽限期已过 → 作废本局，房间退回大厅', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    for (const p of h.players) h.engine.disconnect(p.id);

    h.clock.advance(ABANDON_GRACE_MS + TRANSITION_MS + TURN_TIMEOUT_MS);

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('LOBBY');
    expect(snap.players).toHaveLength(0);
    expect(snap.currentTurn).toBeNull();
    expect(snap.hostId).toBeNull();
    expect(snap.inventory.counts.ONE_SHOW).toBe(0);
    h.engine.dispose();
  });

  it('作废之后新的一组人能立刻开新局（这才是修这个 bug 的意义）', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    for (const p of h.players) h.engine.disconnect(p.id);
    h.clock.advance(ABANDON_GRACE_MS + TRANSITION_MS + TURN_TIMEOUT_MS);
    expect(h.engine.snapshot().phase).toBe('LOBBY');

    // 新的一组客人上门
    h.players = [];
    fill(h, MIN_PLAYERS);
    const snap = h.engine.snapshot();
    expect(snap.players).toHaveLength(MIN_PLAYERS);
    expect(snap.phase).toBe('LOBBY');

    startGame(h);
    const started = h.engine.snapshot();
    expect(started.phase).toBe('NORMAL_TURN');
    expect(started.inventory.counts).toEqual(buildInventory().counts);
    expect(started.stats.totalRolls).toBe(0);
    h.engine.dispose();
  });

  it('有人重连回来就取消作废，牌局照常继续', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    for (const p of h.players) h.engine.disconnect(p.id);

    // 差一点就要作废时，一个人回来了
    h.clock.advance(ABANDON_GRACE_MS - 5_000);
    const back = h.players[0];
    const res = h.engine.join({
      guestId: back.guestId,
      nickname: back.nickname,
      sessionToken: back.token,
      socketId: 'sock_back',
    });
    expect(res.ok).toBe(true);

    // 越过原本的作废时刻
    h.clock.advance(ABANDON_GRACE_MS);

    const snap = h.engine.snapshot();
    expect(snap.players).toHaveLength(MIN_PLAYERS);
    expect(snap.phase).not.toBe('LOBBY');
    h.engine.dispose();
  });

  it('结算完成后全员掉线，房间同样能回收给下一组人', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    h.rng.push(...D_SIX_FOUR);
    playTurn(h);

    const before = h.engine.snapshot();
    expect(['CHAMPION_CHASE', 'FINISHED', 'SETTLING']).toContain(before.phase);

    for (const p of h.players) h.engine.disconnect(p.id);
    h.clock.advance(ABANDON_GRACE_MS * 2 + TURN_TIMEOUT_MS * 4 + TRANSITION_MS * 4);

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('LOBBY');
    expect(snap.players).toHaveLength(0);
    expect(snap.result).toBeNull();
    h.engine.dispose();
  });

  it('大厅里全员掉线走的是原有清座位逻辑，不受影响', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    for (const p of h.players) h.engine.disconnect(p.id);

    h.clock.advance(LOBBY_GHOST_TTL_MS + 1_000);

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('LOBBY');
    expect(snap.players).toHaveLength(0);
    h.engine.dispose();
  });

  it('dispose 之后残留的作废计时器不会再触发', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    for (const p of h.players) h.engine.disconnect(p.id);

    h.engine.dispose();
    expect(() => h.clock.advance(ABANDON_GRACE_MS * 3)).not.toThrow();
  });
});
