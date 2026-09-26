/**
 * ChampionService 测试：追状元队列、状元反超判定。
 *
 * 这里只管「谁在什么时候坐上状元位」，与骰子无关 —— 骰子永远均匀随机。
 */
import { describe, expect, it } from 'vitest';
import type { PlayerState } from '@bobing/shared';

import {
  buildChaseQueue,
  emptyChampionState,
  shouldReplaceChampion,
} from '../src/game/ChampionService';
import { MAX_PLAYERS, MIN_PLAYERS } from '../src/config/gameConfig';

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
    expect(state.tiebreak).toBe(0);
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
  const at = (rank: number, tiebreak = 0) => [rank, tiebreak] as const;

  it('等级更高就能反超', () => {
    expect(shouldReplaceChampion(...at(1), ...at(2))).toBe(true);
    expect(shouldReplaceChampion(...at(1), ...at(7))).toBe(true);
    expect(shouldReplaceChampion(...at(6), ...at(7))).toBe(true);
  });

  it('等级更低不能反超，余数再大也没用', () => {
    expect(shouldReplaceChampion(...at(7, 0), ...at(1, 99))).toBe(false);
    expect(shouldReplaceChampion(...at(4, 0), ...at(3, 99))).toBe(false);
    expect(shouldReplaceChampion(...at(2, 0), ...at(1, 99))).toBe(false);
  });

  it('同等级比剩余点数之和：余数大者反超', () => {
    // 同为四点红：444426（余 8）小于 444456（余 11）
    expect(shouldReplaceChampion(...at(1, 8), ...at(1, 11))).toBe(true);
    // 同为五红：剩下那颗 2 小于 6
    expect(shouldReplaceChampion(...at(3, 2), ...at(3, 6))).toBe(true);
  });

  it('同等级余数相等或更小，先出现者保持状元', () => {
    expect(shouldReplaceChampion(...at(1, 8), ...at(1, 8))).toBe(false);
    expect(shouldReplaceChampion(...at(1, 11), ...at(1, 3))).toBe(false);
  });

  it('完整覆盖等级矩阵：高者恒真，低者恒假，同档看余数', () => {
    for (let current = 1; current <= 7; current += 1) {
      for (let challenger = 1; challenger <= 7; challenger += 1) {
        if (challenger !== current) {
          expect(shouldReplaceChampion(...at(current, 5), ...at(challenger, 5))).toBe(
            challenger > current,
          );
        }
      }
    }
    // 同档：余数 4 与 9 一一对比，只有 9 能反超 4
    for (let rank = 1; rank <= 7; rank += 1) {
      expect(shouldReplaceChampion(...at(rank, 4), ...at(rank, 9))).toBe(true);
      expect(shouldReplaceChampion(...at(rank, 9), ...at(rank, 4))).toBe(false);
      expect(shouldReplaceChampion(...at(rank, 4), ...at(rank, 4))).toBe(false);
    }
  });

  it('空榜（rank 0）必被任何状元档取代', () => {
    for (let rank = 1; rank <= 7; rank += 1) {
      expect(shouldReplaceChampion(...at(0, 0), ...at(rank, 0))).toBe(true);
    }
  });
});

describe('shouldReplaceChampion · 现任状元本人以最后一次为准', () => {
  const at = (rank: number, tiebreak = 0) => [rank, tiebreak] as const;

  it('本人再博状元无条件覆盖：同档更小的余数也算数', () => {
    // 444456（余 11）之后再博 444426（余 8）—— 换成最后一次的 8
    expect(shouldReplaceChampion(...at(1, 11), ...at(1, 8), true)).toBe(true);
    expect(shouldReplaceChampion(...at(1, 8), ...at(1, 3), true)).toBe(true);
  });

  it('本人再博更低档也会覆盖：状元位跟着降级', () => {
    expect(shouldReplaceChampion(...at(2, 6), ...at(1, 2), true)).toBe(true);
    expect(shouldReplaceChampion(...at(6, 0), ...at(1, 0), true)).toBe(true);
  });

  it('同样的成绩换个人来博就不成立，说明豁免只属于本人', () => {
    expect(shouldReplaceChampion(...at(1, 11), ...at(1, 8), false)).toBe(false);
    expect(shouldReplaceChampion(...at(2, 6), ...at(1, 2), false)).toBe(false);
  });

  it('本人豁免不改变「空榜必被取代」', () => {
    expect(shouldReplaceChampion(...at(0, 0), ...at(1, 0), true)).toBe(true);
  });
});
