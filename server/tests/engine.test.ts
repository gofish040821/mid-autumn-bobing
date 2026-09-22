/**
 * GameEngine 集成测试 —— 题目 §41 里点名的全部边界情况。
 *
 * 全程使用 FakeClock + 可编排的确定性 Rng：
 * 时间与骰子都被完全掌控，所以「30 秒超时」「三轮保底」这些
 * 平时要靠运气的路径，在这里都是确定性的。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { ErrorCode, RollRecord } from '@bobing/shared';

import {
  ABANDON_GRACE_MS,
  AUTO_START_COUNTDOWN_MS,
  LOBBY_GHOST_TTL_MS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  TURN_TIMEOUT_MS,
} from '../src/config/gameConfig';
import { FakeClock } from '../src/game/Clock';
import { GameEngine } from '../src/game/GameEngine';
import type { EngineEvent, EngineResult } from '../src/game/GameEngine';
import { guaranteeRollNumber } from '../src/game/DiceService';

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
 * 队列为空时回落到 fallback —— fallback 取 0.99 有两个作用：
 *   1. 月华概率判定（rng() < rate）永远不命中，测试不会「意外加持」；
 *   2. 保底时按权重抽出最顶级的状元插金花，结果仍然确定。
 */
class ScriptRng {
  private queue: number[] = [];

  constructor(private readonly fallback = 0.99) {}

  next = (): number =>
    this.queue.length > 0 ? (this.queue.shift() as number) : this.fallback;

  push(...values: number[]): void {
    this.queue.push(...values);
  }

  clear(): void {
    this.queue = [];
  }
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

function createHarness(): Harness {
  const clock = new FakeClock();
  const rng = new ScriptRng(0.99);
  const events: EngineEvent[] = [];
  const engine = new GameEngine({
    clock,
    rng: rng.next,
    emit: (batch) => {
      events.push(...batch);
    },
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
 * 传空数组表示不预设骰子，交由 rng 的回落值决定（用于保底等路径）。
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

  it('10 个人可以开局', () => {
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

  it('满 10 人后 5 秒自动开局', () => {
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
    expect(snap.inventory.counts.THREE_RED).toBe(4 - 1);
    expect(snap.inventory.initial.THREE_RED).toBe(4);
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
    // 4 人局三红库存正好 4 个，一圈领完之后就没了
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
    const inv = h.engine.snapshot().inventory.counts;
    expect(inv.ONE_SHOW).toBe(4 * 4 - 1);
    expect(inv.TWO_LIFT).toBe(2 * 4 - 1);
    expect(inv.DUITANG).toBe(1 - 1);
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

  it('最后一位挑战者仍然可以反超', () => {
    playTurn(h, D_FOUR_FOUR); // 座位 1 成为状元
    playTurn(h, D_NONE); // 座位 2 追不上
    playTurn(h, D_NONE); // 座位 3 追不上
    const last = playTurn(h, D_SIX_FOUR); // 座位 4，最后一位 —— 六杯红 rank 6
    expect(last.replacedChampion).toBe(true);
    expect(h.engine.snapshot().phase).toBe('FINISHED');
    expect(h.engine.snapshot().result?.finalChampionId).toBe(last.playerId);
    expect(h.engine.snapshot().result?.championAwardId).toBe('SIX_FOUR');
    expect(h.engine.snapshot().result?.championBaseScore).toBe(100);
  });

  it('只追一圈：N-1 位各追一次后立即结算', () => {
    playTurn(h, D_FOUR_FOUR); // 1 次 + 3 位挑战者
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('FINISHED');
    expect(snap.currentTurn).toBeNull();
    expect(snap.champion.chaseQueue).toHaveLength(0);
    expect(snap.champion.chaseDone).toBe(3);
    expect(snap.stats.totalRolls).toBe(4);
  });

  it('追状元阶段关闭月华加持，normalRollCount 不再增长', () => {
    playTurn(h, D_FOUR_FOUR);
    expect(h.engine.inspect().normalRollCount).toBe(1);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    expect(h.engine.inspect().normalRollCount).toBe(1);
    expect(h.engine.snapshot().stats.blessedRolls).toBe(0);
  });

  it('追状元阶段掷出的骰子纯随机，不经过任何干预', () => {
    playTurn(h, D_FOUR_FOUR);
    const chase = playTurn(h, D_DUITANG);
    expect(chase.kind).toBe('CHASE');
    expect(chase.blessed).toBe(false);
    expect(chase.guaranteed).toBe(false);
    expect(chase.dice).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('状元确认后月华机制关闭', () => {
    playTurn(h, D_FOUR_FOUR);
    const view = h.engine.snapshot().moonBlessing;
    expect(view.stage).toBe('DONE');
    expect(view.progress).toBe(1);
  });
});

/* ------------------------------------------------------------------ *
 * 5. 结算与状元奖
 * ------------------------------------------------------------------ */

describe('结算与最终状元', () => {
  let h: Harness;
  beforeEach(() => {
    h = createHarness();
    fill(h, 4);
    startGame(h);
  });

  it('状元奖只发一次，且正好 +100 分', () => {
    const champion = playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);

    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('FINISHED');
    // 四点红基础 30 + 状元奖励 100
    expect(scoreOf(h, champion.playerId)).toBe(130);
    expect(snap.players.find((p) => p.id === champion.playerId)?.prizes.CHAMPION).toBe(1);
    expect(snap.inventory.counts.CHAMPION).toBe(0);
    expect(h.engine.inspect().championPrizeGranted).toBe(true);
  });

  it('结算结果包含完整榜单与状元信息', () => {
    const champion = playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_THREE_RED);
    playTurn(h, D_TWO_LIFT);
    playTurn(h, D_NONE);

    const result = h.engine.snapshot().result;
    expect(result).not.toBeNull();
    expect(result!.finalChampionId).toBe(champion.playerId);
    expect(result!.championBaseScore).toBe(30);
    expect(result!.championBonus).toBe(100);
    expect(result!.championDice).toEqual([4, 4, 4, 4, 2, 6]);
    expect(result!.ranking).toHaveLength(4);
    // 榜单按积分降序
    const scores = result!.ranking.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(result!.ranking[0]!.isFinalChampion).toBe(true);
    expect(result!.ranking[0]!.score).toBe(130);
  });

  it('换人之后由最终状元拿奖，被替换者一分不得', () => {
    const first = playTurn(h, D_FOUR_FOUR); // rank 1
    const second = playTurn(h, D_FIVE_SCHOLAR); // rank 2 反超
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);

    const snap = h.engine.snapshot();
    const result = snap.result!;
    expect(result.finalChampionId).toBe(second.playerId);
    expect(result.championAwardId).toBe('FIVE_SCHOLAR');
    // 五子登科基础 40 + 100
    expect(scoreOf(h, second.playerId)).toBe(140);
    // 首位状元（四点红）在掷出时就是延后状态，被反超后什么也拿不到
    expect(scoreOf(h, first.playerId)).toBe(0);
    expect(snap.players.find((p) => p.id === first.playerId)?.prizes.CHAMPION).toBeUndefined();
    expect(snap.inventory.counts.CHAMPION).toBe(0);
    expect(snap.stats.championReplacements).toBe(1);
  });

  it('状元奖在整个房间生命周期内只发一次（重复结算也不会翻倍）', () => {
    playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    const scoreAfterFinish = Math.max(...h.engine.snapshot().players.map((p) => p.score));

    // 再推进很久，不应该有任何新的发奖
    h.clock.advance(TRANSITION_MS * 10);
    expect(Math.max(...h.engine.snapshot().players.map((p) => p.score))).toBe(scoreAfterFinish);
    expect(h.engine.inspect().championPrizeGranted).toBe(true);
  });

  it('本局用时被记录下来', () => {
    playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    expect(h.engine.snapshot().stats.durationMs).toBeGreaterThan(0);
  });

  it('游戏结束后再博饼会被拒绝', () => {
    playTurn(h, D_FOUR_FOUR);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    playTurn(h, D_NONE);
    expect(h.engine.snapshot().phase).toBe('FINISHED');
    const somePlayer = h.players[0]!;
    expectFail(h.engine.roll(somePlayer.id, 'turn_000001', 'act'), 'GAME_FINISHED');
  });
});

/* ------------------------------------------------------------------ *
 * 6. 三轮保底
 * ------------------------------------------------------------------ */

describe('三轮保底', () => {
  it(`最少人数局最多 3N 次之内必定出现首位状元`, () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);

    const guaranteeAt = guaranteeRollNumber(MIN_PLAYERS); // 6
    for (let i = 1; i < guaranteeAt; i += 1) {
      const roll = playTurn(h, D_NONE);
      expect(roll.isChampionTier).toBe(false);
    }
    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    expect(h.engine.snapshot().champion.playerId).toBeNull();

    // 第 6 次：无条件保底。传空数组表示不预设骰子 —— 队列为空时 rng 回落到 0.99，
    // 按权重抽到最顶级的状元插金花，结果依然完全确定。
    playTurn(h, []);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('CHAMPION_CHASE');
    expect(snap.champion.playerId).not.toBeNull();
    expect(snap.stats.firstChampionRollIndex).toBe(guaranteeAt);
    expect(snap.stats.firstChampionRollIndex!).toBeLessThanOrEqual(3 * MIN_PLAYERS);
    expect(snap.champion.awardId).toBe('CHAMPION_FLOWER');
    h.engine.dispose();
  });

  it(`10 人局最多 30 次之内必定出现首位状元`, () => {
    const h = createHarness();
    fill(h, MAX_PLAYERS);
    startGame(h);

    const guaranteeAt = guaranteeRollNumber(MAX_PLAYERS); // 30
    for (let i = 1; i < guaranteeAt; i += 1) playTurn(h, D_NONE);
    expect(h.engine.snapshot().champion.playerId).toBeNull();

    playTurn(h, []);
    const snap = h.engine.snapshot();
    expect(snap.phase).toBe('CHAMPION_CHASE');
    expect(snap.stats.firstChampionRollIndex).toBe(guaranteeAt);
    h.engine.dispose();
  });

  it('第一轮完全随机，不会加持（IDLE 且 blessedRolls 为 0）', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);

    for (let i = 0; i < MIN_PLAYERS; i += 1) {
      const roll = playTurn(h, D_NONE);
      expect(roll.blessed).toBe(false);
      expect(roll.guaranteed).toBe(false);
      if (i < MIN_PLAYERS - 1) {
        expect(h.engine.snapshot().moonBlessing.stage).toBe('IDLE');
      }
    }
    expect(h.engine.snapshot().stats.blessedRolls).toBe(0);
    // 第一轮走完，月亮开始蓄力
    expect(h.engine.snapshot().moonBlessing.stage).toBe('CHARGING');
    h.engine.dispose();
  });

  it('月华值随掷骰推进而增长，临近保底时会提示「状元将至」', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);

    const progress: number[] = [];
    for (let i = 1; i < guaranteeRollNumber(MIN_PLAYERS); i += 1) {
      playTurn(h, D_NONE);
      progress.push(h.engine.snapshot().moonBlessing.progress);
    }
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }
    const near = h.engine.snapshot().moonBlessing;
    expect(near.nearGuarantee).toBe(true);
    expect(near.stage).toBe('FULL');
    h.engine.dispose();
  });

  it('任何阶段下发的月华文案都不含明示保底的字眼', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const banned = ['必出', '必中', '保证', '一定', '必定'];
    for (let i = 0; i < guaranteeRollNumber(MIN_PLAYERS) - 1; i += 1) {
      const text = h.engine.snapshot().moonBlessing.text;
      for (const word of banned) expect(text).not.toContain(word);
      playTurn(h, D_NONE);
    }
    for (const word of banned) {
      expect(h.engine.snapshot().moonBlessing.text).not.toContain(word);
    }
    h.engine.dispose();
  });
});

/* ------------------------------------------------------------------ *
 * 7. 再来一局
 * ------------------------------------------------------------------ */

describe('再来一局', () => {
  function finishOneGame(h: Harness): void {
    playTurn(h, D_FOUR_FOUR);
    for (let i = 0; i < MIN_PLAYERS - 1; i += 1) playTurn(h, D_NONE);
    expect(h.engine.snapshot().phase).toBe('FINISHED');
  }

  it('非房主不能开启新的一局', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    finishOneGame(h);
    const notHost = h.players.find((p) => p.id !== hostId(h))!;
    expectFail(h.engine.restart(notHost.id), 'NOT_HOST');
    h.engine.dispose();
  });

  it('还没结束的时候不能重开', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    expectFail(h.engine.restart(hostId(h)), 'GAME_ALREADY_STARTED');
    h.engine.dispose();
  });

  it('重开后积分与奖品清零、库存重置、座位与昵称保留', () => {
    const h = createHarness();
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
    expect(after.inventory.counts.ONE_SHOW).toBe(0);
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
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    finishOneGame(h);
    h.engine.restart(hostId(h));
    startGame(h);

    expect(h.engine.snapshot().phase).toBe('NORMAL_TURN');
    expect(h.engine.snapshot().inventory.counts.ONE_SHOW).toBe(4 * MIN_PLAYERS);
    const roll = playTurn(h, D_DUITANG);
    expect(roll.scoreGained).toBe(15);
    h.engine.dispose();
  });

  it('第二局的 turnId 不会和第一局撞车', () => {
    const h = createHarness();
    fill(h, MIN_PLAYERS);
    startGame(h);
    const firstGameTurnIds = new Set<string>();
    for (let i = 0; i < 3; i += 1) {
      firstGameTurnIds.add(h.engine.snapshot().currentTurn!.turnId);
      playTurn(h, D_NONE);
    }
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
      expect(me.score).toBe(5);
      expect(me.prizes.THREE_RED).toBe(1);
      expect(res.data.snapshot.phase).toBe('NORMAL_TURN');
      expect(res.data.snapshot.inventory.counts.THREE_RED).toBe(MIN_PLAYERS - 1);
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
    expect(started.inventory.counts.ONE_SHOW).toBe(4 * MIN_PLAYERS);
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
