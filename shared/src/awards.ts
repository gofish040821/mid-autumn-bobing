/**
 * 奖项定义表 —— 全站唯一真相。
 *
 * `order` 就是 RuleEngine 的匹配优先级（1 = 最高）。
 * 任何新奖项都必须插入到正确的顺序位置，否则会出现
 * 「低等级覆盖高等级」的经典 bug。
 */
import type { AwardId, PrizeKey, PrizeTier } from './types.js';

export type SoundId =
  | 'result_normal'
  | 'result_small_win'
  | 'result_medium_win'
  | 'result_big_win'
  | 'champion'
  | 'champion_top';

export interface AwardPalette {
  /** 主色 */
  primary: string;
  /** 辅色 */
  secondary: string;
  /** 墨色/描边 */
  ink: string;
  /** 光晕 */
  glow: string;
}

export interface AwardDefinition {
  id: AwardId;
  /** 正式奖项名，如「三红」 */
  name: string;
  tier: PrizeTier;
  /** Champion Rank：四点红=1 … 状元插金花=7；非状元为 0 */
  championRank: number;
  /** 基础积分 */
  score: number;
  prizeKey: PrizeKey | null;
  /** 匹配优先级，1 最高 */
  order: number;
  /** 演出文案主标题，如「桂香初绽 · 一秀」 */
  title: string;
  /** 演出文案副标题 */
  subtitle: string;
  /** 规则说明中展示的一句话 */
  rule: string;
  palette: AwardPalette;
  /** 演出时长（毫秒），客户端会 clamp 以保持节奏 */
  durationMs: number;
  sound: SoundId;
  /** 演出效果标识，客户端 AwardCelebration 用它选动画 */
  effect:
    | 'none'
    | 'osmanthus'
    | 'lanterns'
    | 'seals'
    | 'coins'
    | 'screen'
    | 'scroll'
    | 'clouds'
    | 'petals'
    | 'ink'
    | 'brocade'
    | 'six-red'
    | 'grand';
}

/**
 * 按匹配优先级从高到低排列。
 * RuleEngine 严格按此数组顺序匹配，命中即返回。
 */
export const AWARDS: readonly AwardDefinition[] = [
  {
    id: 'CHAMPION_FLOWER',
    name: '状元插金花',
    tier: 'CHAMPION',
    championRank: 7,
    score: 120,
    prizeKey: 'CHAMPION',
    order: 1,
    title: '状元插金花',
    subtitle: '金榜题名',
    rule: '四颗四点 + 两颗一点',
    palette: { primary: '#C8321E', secondary: '#E8C77A', ink: '#29251F', glow: '#F4D58D' },
    durationMs: 3000,
    sound: 'champion_top',
    effect: 'grand',
  },
  {
    id: 'SIX_FOUR',
    name: '六杯红',
    tier: 'CHAMPION',
    championRank: 6,
    score: 100,
    prizeKey: 'CHAMPION',
    order: 2,
    title: '六杯齐红',
    subtitle: '状元之姿',
    rule: '六颗全是四点',
    palette: { primary: '#A33A2B', secondary: '#D9A441', ink: '#29251F', glow: '#E9B65C' },
    durationMs: 2600,
    sound: 'champion',
    effect: 'six-red',
  },
  {
    id: 'BROCADE',
    name: '遍地锦',
    tier: 'CHAMPION',
    championRank: 5,
    score: 80,
    prizeKey: 'CHAMPION',
    order: 3,
    title: '遍地生锦',
    subtitle: '遍地锦',
    rule: '六颗全是一点',
    palette: { primary: '#B18A55', secondary: '#E8C77A', ink: '#29251F', glow: '#F0D9A0' },
    durationMs: 2400,
    sound: 'champion',
    effect: 'brocade',
  },
  {
    id: 'SIX_BLACK',
    name: '六抔黑',
    tier: 'CHAMPION',
    championRank: 4,
    score: 60,
    prizeKey: 'CHAMPION',
    order: 4,
    title: '六子同辉',
    subtitle: '六抔黑',
    rule: '六颗相同，且点数不是 1 或 4',
    palette: { primary: '#3D5960', secondary: '#B18A55', ink: '#1B1916', glow: '#8FA9AE' },
    durationMs: 2400,
    sound: 'champion',
    effect: 'ink',
  },
  {
    id: 'FIVE_FOUR',
    name: '五红',
    tier: 'CHAMPION',
    championRank: 3,
    score: 50,
    prizeKey: 'CHAMPION',
    order: 5,
    title: '五红映月',
    subtitle: '五红',
    rule: '五颗四点',
    palette: { primary: '#A33A2B', secondary: '#E8C77A', ink: '#29251F', glow: '#EBB9A6' },
    durationMs: 2300,
    sound: 'champion',
    effect: 'petals',
  },
  {
    id: 'FIVE_SCHOLAR',
    name: '五子登科',
    tier: 'CHAMPION',
    championRank: 2,
    score: 40,
    prizeKey: 'CHAMPION',
    order: 6,
    title: '五子登科',
    subtitle: '金榜题名',
    rule: '五颗相同，且点数不是 4',
    palette: { primary: '#B18A55', secondary: '#E8C77A', ink: '#29251F', glow: '#F2DCA8' },
    durationMs: 2300,
    sound: 'champion',
    effect: 'clouds',
  },
  {
    id: 'FOUR_FOUR',
    name: '四点红',
    tier: 'CHAMPION',
    championRank: 1,
    score: 30,
    prizeKey: 'CHAMPION',
    order: 7,
    title: '状元候选！',
    subtitle: '四点红',
    rule: '四颗四点',
    palette: { primary: '#A33A2B', secondary: '#D9A441', ink: '#29251F', glow: '#E9B65C' },
    durationMs: 2200,
    sound: 'champion',
    effect: 'scroll',
  },
  {
    id: 'DUITANG',
    name: '对堂',
    tier: 'NORMAL',
    championRank: 0,
    score: 15,
    prizeKey: 'DUITANG',
    order: 8,
    title: '六子齐聚 · 满堂华彩',
    subtitle: '对堂',
    rule: '一点到六点各一颗',
    palette: { primary: '#3D5960', secondary: '#B18A55', ink: '#29251F', glow: '#9EC0C6' },
    durationMs: 2000,
    sound: 'result_big_win',
    effect: 'screen',
  },
  {
    id: 'FOUR_ADVANCE',
    name: '四进',
    tier: 'NORMAL',
    championRank: 0,
    score: 8,
    prizeKey: 'FOUR_ADVANCE',
    order: 9,
    title: '四方进喜 · 四进',
    subtitle: '四进',
    rule: '四颗相同，且点数不是 4',
    palette: { primary: '#6E7F5C', secondary: '#B18A55', ink: '#29251F', glow: '#BFD0A8' },
    durationMs: 1600,
    sound: 'result_medium_win',
    effect: 'coins',
  },
  {
    id: 'THREE_RED',
    name: '三红',
    tier: 'NORMAL',
    championRank: 0,
    score: 5,
    prizeKey: 'THREE_RED',
    order: 10,
    title: '三元报喜 · 三红',
    subtitle: '三红',
    rule: '三颗四点',
    palette: { primary: '#A33A2B', secondary: '#D9A441', ink: '#29251F', glow: '#EBB9A6' },
    durationMs: 1500,
    sound: 'result_medium_win',
    effect: 'seals',
  },
  {
    id: 'TWO_LIFT',
    name: '二举',
    tier: 'NORMAL',
    championRank: 0,
    score: 2,
    prizeKey: 'TWO_LIFT',
    order: 11,
    title: '双喜临门 · 二举',
    subtitle: '二举',
    rule: '两颗四点',
    palette: { primary: '#C0392B', secondary: '#E8C77A', ink: '#29251F', glow: '#F0C9A0' },
    durationMs: 1300,
    sound: 'result_small_win',
    effect: 'lanterns',
  },
  {
    id: 'ONE_SHOW',
    name: '一秀',
    tier: 'NORMAL',
    championRank: 0,
    score: 1,
    prizeKey: 'ONE_SHOW',
    order: 12,
    title: '桂香初绽 · 一秀',
    subtitle: '一秀',
    rule: '一颗四点',
    palette: { primary: '#B18A55', secondary: '#E8D7A8', ink: '#29251F', glow: '#F0E0B8' },
    durationMs: 1200,
    sound: 'result_small_win',
    effect: 'osmanthus',
  },
  {
    id: 'NONE',
    name: '无奖',
    tier: 'NONE',
    championRank: 0,
    score: 0,
    prizeKey: null,
    order: 13,
    title: '月色尚浅',
    subtitle: '无奖',
    rule: '没有达到任何奖项',
    palette: { primary: '#8A8578', secondary: '#C9C2B2', ink: '#29251F', glow: '#DCD6C6' },
    durationMs: 900,
    sound: 'result_normal',
    effect: 'none',
  },
] as const;

/** 无奖时的随机文案 */
export const NONE_MESSAGES: readonly string[] = [
  '月色尚浅，再候佳音',
  '好事多磨',
  '桂香未到，再来一轮',
  '云开月未明',
];

export const AWARD_MAP: Record<AwardId, AwardDefinition> = AWARDS.reduce(
  (acc, a) => {
    acc[a.id] = a;
    return acc;
  },
  {} as Record<AwardId, AwardDefinition>,
);

export function getAward(id: AwardId): AwardDefinition {
  return AWARD_MAP[id];
}

/** 所有 Champion Tier 奖项（追状元阶段用于比较） */
export const CHAMPION_AWARDS: readonly AwardDefinition[] = AWARDS.filter(
  (a) => a.tier === 'CHAMPION',
);

export const PRIZE_KEYS: readonly PrizeKey[] = [
  'ONE_SHOW',
  'TWO_LIFT',
  'THREE_RED',
  'FOUR_ADVANCE',
  'DUITANG',
  'CHAMPION',
];

export const PRIZE_NAMES: Record<PrizeKey, string> = {
  ONE_SHOW: '一秀',
  TWO_LIFT: '二举',
  THREE_RED: '三红',
  FOUR_ADVANCE: '四进',
  DUITANG: '对堂',
  CHAMPION: '状元',
};

/** 结算页趣味称号：只用于排行榜第 2、3 名的视觉彩蛋，不是正式奖项。 */
export const FUN_TITLES: Record<number, string> = {
  2: '榜眼风采',
  3: '探花雅赏',
};
