/**
 * ChampionService 测试：追状元队列、状元反超判定、月华值视图。
 */
import { describe, expect, it } from 'vitest';
import type { MoonBlessingView, PlayerState } from '@bobing/shared';

import {
  buildChaseQueue,
  buildMoonBlessingView,
  emptyChampionState,
  shouldReplaceChampion,
} from '../src/game/ChampionService';
import { guaranteeRollNumber } from '../src/game/DiceService';
import { MOON_BLESSING_START_ROUND, MAX_PLAYERS, MIN_PLAYERS } from '../src/config/gameConfig';

/** 造一批玩家，座位从 1 开始。 */
function makePlayers(count: number): PlayerState[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `player_${String(i + 1).padStart(4, '0')}`,
    guestId: `guest_${i + 1}`,
    nickname: `客${i + 1}`,
    seat: i + 1,
    online: true,
    connectedAt: 0,
    lastSeenAt: 0,
    score: 0,
    prizes: {},
    rollCount: 0,
    isHost: i === 0,
  }));
}

describe('emptyChampionState', () => {
  it('初始状态里没有任何状元', () => {
    const state = emptyChampionState();
    expect(state.playerId).toBeNull();
    expect(state.nickname).toBeNull();
    expect(state.seat).toBeNull();
    expect(state.awardId).toBeNull();
    expect(state.dice).toBeNull();
    expect(state.rank).toBe(0);
    expect(state.chaseQueue).toEqual([]);
    expect(state.chaseTotal).toBe(0);
    expect(state.chaseDone).toBe(0);
    expect(state.replacements).toBe(0);
    expect(state.finalPlayerId).toBeNull();
  });
});

describe('buildChaseQueue · 追状元队列', () => {
  it('从首位状元的下家开始，按座位绕一圈，且不含状元本人', () => {
    const players = makePlayers(4);
    const queue = buildChaseQueue(players, players[0]!.id);
    expect(queue).toEqual([players[1]!.id, players[2]!.id, players[3]!.id]);
    expect(queue).not.toContain(players[0]!.id);
  });

  it('状元坐在中间时同样绕圈', () => {
    const players = makePlayers(5);
    const queue = buildChaseQueue(players, players[2]!.id); // 座位 3
    expect(queue).toEqual([
      players[3]!.id,
      players[4]!.id,
      players[0]!.id,
      players[1]!.id,
    ]);
  });

  it('状元坐在最后一席时从第一席接上', () => {
    const players = makePlayers(4);
    const queue = buildChaseQueue(players, players[3]!.id);
    expect(queue).toEqual([players[0]!.id, players[1]!.id, players[2]!.id]);
  });

  it('队列长度恒为 N - 1', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      const players = makePlayers(n);
      for (const champion of players) {
        const queue = buildChaseQueue(players, champion.id);
        expect(queue).toHaveLength(n - 1);
        expect(new Set(queue).size).toBe(n - 1);
        expect(queue).not.toContain(champion.id);
      }
    }
  });

  it('队列里包含除状元外的每一位玩家，且不重复', () => {
    const players = makePlayers(6);
    const queue = buildChaseQueue(players, players[1]!.id);
    const expected = players.filter((p) => p.id !== players[1]!.id).map((p) => p.id);
    expect([...queue].sort()).toEqual([...expected].sort());
  });

  it('玩家顺序打乱也不影响结果（内部按座位排序）', () => {
    const players = makePlayers(4);
    const shuffled = [players[2]!, players[0]!, players[3]!, players[1]!];
    expect(buildChaseQueue(shuffled, players[0]!.id)).toEqual(
      buildChaseQueue(players, players[0]!.id),
    );
  });

  it('找不到状元时退化为「按座位全部挑战」，不会返回空队列', () => {
    const players = makePlayers(3);
    const queue = buildChaseQueue(players, 'player_9999');
    expect(queue).toEqual(players.map((p) => p.id));
  });
});

describe('shouldReplaceChampion · 反超判定', () => {
  it('只有严格更高等级才能反超', () => {
    expect(shouldReplaceChampion(1, 2)).toBe(true);
    expect(shouldReplaceChampion(1, 7)).toBe(true);
    expect(shouldReplaceChampion(6, 7)).toBe(true);
  });

  it('同等级先出现者优先，不能反超', () => {
    for (let rank = 1; rank <= 7; rank += 1) {
      expect(shouldReplaceChampion(rank, rank)).toBe(false);
    }
  });

  it('更低等级不能反超', () => {
    expect(shouldReplaceChampion(7, 1)).toBe(false);
    expect(shouldReplaceChampion(4, 3)).toBe(false);
    expect(shouldReplaceChampion(2, 1)).toBe(false);
  });

  it('完整覆盖 7×7 的等级矩阵', () => {
    for (let current = 1; current <= 7; current += 1) {
      for (let challenger = 1; challenger <= 7; challenger += 1) {
        expect(shouldReplaceChampion(current, challenger)).toBe(challenger > current);
      }
    }
  });
});

describe('buildMoonBlessingView · 月华值视图', () => {
  const N = MIN_PLAYERS;

  const view = (normalRollCount: number, championFound = false, playerCount = N): MoonBlessingView =>
    buildMoonBlessingView({ normalRollCount, playerCount, championFound });

  it('第一轮完全低调（IDLE），不展示任何进度', () => {
    for (let done = 0; done < N; done += 1) {
      const v = view(done);
      expect(v.stage).toBe('IDLE');
      expect(v.rate).toBe(0);
      expect(v.progress).toBe(0);
      expect(v.text).toBe('月华未起');
      expect(v.nearGuarantee).toBe(false);
    }
  });

  it('第二轮起开始蓄力（CHARGING），进度随掷骰次数增长', () => {
    const startRoll = (MOON_BLESSING_START_ROUND - 1) * N + 1;
    const first = view(startRoll - 1);
    expect(first.stage).toBe('CHARGING');
    expect(first.progress).toBe(0);

    const later = view(startRoll + 1);
    expect(later.stage).toBe('CHARGING');
    expect(later.progress).toBeGreaterThan(first.progress);

    // 进度严格单调不减
    let prev = -1;
    for (let done = 0; done <= guaranteeRollNumber(N); done += 1) {
      const v = view(done);
      if (v.stage !== 'IDLE') {
        expect(v.progress).toBeGreaterThanOrEqual(prev);
        prev = v.progress;
      }
    }
  });

  it('临近保底时进入 FULL 并提示「月华将满 · 状元将至」', () => {
    const near = view(guaranteeRollNumber(N) - 1);
    expect(near.stage).toBe('FULL');
    expect(near.nearGuarantee).toBe(true);
    expect(near.text).toBe('月华将满 · 状元将至');
    expect(near.progress).toBeGreaterThanOrEqual(0.75);
  });

  it('进度永远不超过 1', () => {
    for (let done = 0; done <= 200; done += 1) {
      expect(view(done).progress).toBeLessThanOrEqual(1);
    }
  });

  it('状元出现后机制关闭（DONE）', () => {
    const v = view(3, true);
    expect(v.stage).toBe('DONE');
    expect(v.rate).toBe(0);
    expect(v.progress).toBe(1);
    expect(v.text).toBe('状元已出 · 月华归隐');
    expect(v.nearGuarantee).toBe(false);
  });

  it('guaranteeAtRoll 始终等于 guaranteeRollNumber(n)', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n += 1) {
      expect(view(0, false, n).guaranteeAtRoll).toBe(guaranteeRollNumber(n));
    }
  });

  it('人数为 0 时不崩、不展示', () => {
    const v = view(0, false, 0);
    expect(v.stage).toBe('IDLE');
    expect(v.rate).toBe(0);
  });

  it('所有文案都不出现「必出」「保证」这类明示保底的说法', () => {
    const banned = ['必出', '必中', '保证', '一定', '必定', '包出'];
    for (let done = 0; done <= 300; done += 1) {
      for (const found of [false, true]) {
        const text = view(done, found).text;
        for (const word of banned) {
          expect(text).not.toContain(word);
        }
      }
    }
  });

  it('rate 单调不减且封顶 0.2', () => {
    let prev = -1;
    for (let done = 0; done <= 60; done += 1) {
      const rate = view(done).rate;
      expect(rate).toBeGreaterThanOrEqual(prev);
      expect(rate).toBeLessThanOrEqual(0.2);
      prev = rate;
    }
  });
});
