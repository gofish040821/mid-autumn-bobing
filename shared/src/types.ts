/**
 * 全局共享类型 —— 服务端与客户端唯一的契约来源。
 *
 * 任何一端修改这里的结构，另一端会在 tsc 阶段立刻报错，
 * 从而保证「服务端权威 / 客户端只读」的模型不会被悄悄破坏。
 */

/* ------------------------------------------------------------------ *
 * 基础枚举
 * ------------------------------------------------------------------ */

/** 十二个正式奖项 + 无奖。匹配顺序即声明顺序（从高到低）。 */
export type AwardId =
  | 'CHAMPION_FLOWER' // 状元插金花  4 个 4 + 2 个 1
  | 'SIX_FOUR' //       六杯红      6 个 4
  | 'BROCADE' //        遍地锦      6 个 1
  | 'SIX_BLACK' //      六抔黑      6 个相同(2/3/5/6)
  | 'FIVE_FOUR' //      五红        5 个 4
  | 'FIVE_SCHOLAR' //   五子登科    5 个相同非 4
  | 'FOUR_FOUR' //      四点红      4 个 4
  | 'DUITANG' //        对堂        1~6 各一个
  | 'FOUR_ADVANCE' //   四进        4 个相同非 4
  | 'THREE_RED' //      三红        3 个 4
  | 'TWO_LIFT' //       二举        2 个 4
  | 'ONE_SHOW' //       一秀        1 个 4
  | 'NONE'; //          无奖

/** 库存与奖品的种类。所有 Champion Tier 共用一个 CHAMPION 库存。 */
export type PrizeKey =
  | 'ONE_SHOW'
  | 'TWO_LIFT'
  | 'THREE_RED'
  | 'FOUR_ADVANCE'
  | 'DUITANG'
  | 'CHAMPION';

/** 除状元外的五类普通奖品。状元全桌唯一，数量恒为 1，不参与数量自定义。 */
export type NormalPrizeKey = Exclude<PrizeKey, 'CHAMPION'>;

/**
 * 开房时可自定义的奖品配置。
 *
 * 状元数量恒为 1（只发一次给最终状元），所以 counts 只包含五类普通奖品；
 * scores 则包含全部六类——状元的积分取「统一基础分」，另加 CHAMPION_BONUS。
 */
export interface RoomConfig {
  /** 五类普通奖品的数量。 */
  counts: Record<NormalPrizeKey, number>;
  /** 每类奖品的积分；状元为统一基础分。 */
  scores: Record<PrizeKey, number>;
}

export type PrizeTier = 'NONE' | 'NORMAL' | 'CHAMPION';

/** 服务端状态机阶段。 */
export type Phase = 'LOBBY' | 'NORMAL_TURN' | 'CHAMPION_CHASE' | 'SETTLING' | 'FINISHED';

/** 单个回合的子状态。 */
export type TurnStatus = 'WAITING' | 'ROLLING' | 'RESOLVING';

export type TurnKind = 'NORMAL' | 'CHASE';

export type ErrorCode =
  | 'ROOM_FULL'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_LIMIT_REACHED'
  | 'GAME_ALREADY_STARTED'
  | 'NOT_ENOUGH_PLAYERS'
  | 'NOT_HOST'
  | 'NOT_YOUR_TURN'
  | 'INVALID_TURN'
  | 'TURN_ALREADY_ROLLED'
  | 'GAME_FINISHED'
  | 'INVALID_SESSION'
  | 'INVALID_PAYLOAD'
  | 'NICKNAME_REQUIRED'
  | 'INTERNAL_ERROR';

/* ------------------------------------------------------------------ *
 * 领域模型
 * ------------------------------------------------------------------ */

export interface PlayerState {
  /** 服务端生成的稳定玩家 id（绝不使用 socket.id） */
  id: string;
  /** 浏览器 localStorage 中的游客 id */
  guestId: string;
  nickname: string;
  /** 座位号，从 1 开始，按加入顺序分配 */
  seat: number;
  online: boolean;
  connectedAt: number;
  lastSeenAt: number;
  /** 本局积分 */
  score: number;
  /** 本局已获得的奖品数量 */
  prizes: Partial<Record<PrizeKey, number>>;
  /** 本局博饼次数 */
  rollCount: number;
  isHost: boolean;
}

export interface TurnState {
  /** 形如 turn_000023 —— 一个 turnId 只允许成功开奖一次 */
  turnId: string;
  playerId: string;
  nickname: string;
  seat: number;
  status: TurnStatus;
  startedAt: number;
  /** 服务端权威的截止时间戳（客户端倒计时仅作展示） */
  deadlineAt: number;
  kind: TurnKind;
  /** 本局第几次博饼（从 1 开始） */
  rollIndex: number;
  /** 追状元阶段：当前是第几位挑战者（从 1 开始）；普通阶段为 0 */
  chaseIndex: number;
}

export interface InventoryState {
  /** 剩余库存 */
  counts: Record<PrizeKey, number>;
  /** 开局时的库存，用于 UI 展示 "18/24" */
  initial: Record<PrizeKey, number>;
}

export interface ChampionState {
  /** 当前状元（可能被后来者反超） */
  playerId: string | null;
  nickname: string | null;
  seat: number | null;
  awardId: AwardId | null;
  dice: number[] | null;
  /** 当前状元的 Champion Rank，用于比较 */
  rank: number;
  /** 同档状元的次级比较值：剩余点数之和（仅 rank 相同时才用） */
  tiebreak: number;
  /** 追状元阶段：尚未投掷的挑战者 playerId，按座位顺序 */
  chaseQueue: string[];
  /** 追状元总人数 = N - 1 */
  chaseTotal: number;
  /** 已完成的挑战者人数 */
  chaseDone: number;
  /** 最终状元（结算后才有值） */
  finalPlayerId: string | null;
  /** 发生了几次金榜易主 */
  replacements: number;
}

export interface RollRecord {
  id: string;
  rollIndex: number;
  playerId: string;
  nickname: string;
  seat: number;
  dice: number[];
  awardId: AwardId;
  tier: PrizeTier;
  isChampionTier: boolean;
  /** 骰型对应的奖品种类（Champion Tier 为 CHAMPION） */
  prizeKey: PrizeKey | null;
  /** 是否真的发出了奖品（库存为 0 时为 false） */
  prizeGranted: boolean;
  /** 因库存耗尽而未能发奖 */
  inventoryExhausted: boolean;
  /** 本次实际加到的分数（Champion Tier 在结算前恒为 0） */
  scoreGained: number;
  /** 是否为服务器超时自动代掷 */
  auto: boolean;
  /** NORMAL 或 CHASE */
  kind: TurnKind;
  /** 是否在追状元阶段反超成为新状元 */
  replacedChampion: boolean;
  /** 是否为本局首位状元 */
  becameFirstChampion: boolean;
  at: number;
}

export interface LogEntry {
  id: string;
  at: number;
  text: string;
  tone: 'normal' | 'win' | 'champion' | 'system' | 'warn';
}

export interface GameStats {
  totalRolls: number;
  /**
   * 首个状元出现在第几次博饼。
   *
   * 纯随机之下约十分之一的牌局一个状元都博不出来，此时它是 null ——
   * 这是正常的结局，不是异常，界面照实显示「—」即可。
   */
  firstChampionRollIndex: number | null;
  championReplacements: number;
  autoRolls: number;
  durationMs: number | null;
}

export interface PrizeLine {
  key: PrizeKey;
  name: string;
  count: number;
}

export interface RankingEntry {
  playerId: string;
  nickname: string;
  seat: number;
  score: number;
  /** 1 起 */
  rank: number;
  /** 趣味称号：第 2 名「榜眼」、第 3 名「探花」，不影响正式奖项 */
  funTitle: string | null;
  prizes: PrizeLine[];
  rollCount: number;
  isFinalChampion: boolean;
}

/**
 * 本局的状元。
 *
 * 整块可空 —— 骰子完全随机之后，约十分之一的牌局一个状元都博不出来，
 * 那时状元饼原封留在桌上，本局照样收席。做成一个可空对象而不是六七个
 * 平铺的 `| null` 字段，是因为类型收窄：`if (result.champion)` 一次就把
 * 下面每个字段都收窄了，平铺的话每加一个字段、每个调用方都要再判一次。
 */
export interface ChampionOutcome {
  playerId: string;
  nickname: string;
  seat: number;
  awardId: AwardId;
  dice: number[];
  /** 骰型对应的基础分 */
  baseScore: number;
  /** 最终状元奖励（CHAMPION_BONUS） */
  bonus: number;
}

/**
 * 本局为什么收席。
 *   INVENTORY_EMPTY —— 五样普通饼博完了，正常终局
 *   ABORTED         —— 轮座时找不到下家（名单被清空等），兜底收席
 */
export type GameEndReason = 'INVENTORY_EMPTY' | 'ABORTED';

export interface GameResult {
  champion: ChampionOutcome | null;
  ranking: RankingEntry[];
  finishedAt: number;
  endReason: GameEndReason;
}

/** 服务端广播给所有客户端的完整状态快照。客户端不得用旧 stateVersion 覆盖新状态。 */
export interface GameSnapshot {
  roomId: string;
  phase: Phase;
  stateVersion: number;
  players: PlayerState[];
  currentTurn: TurnState | null;
  inventory: InventoryState;
  /** 每类奖品的积分（状元为统一基础分），供规则说明与展示读取，随开房配置变化。 */
  prizeScores: Record<PrizeKey, number>;
  champion: ChampionState;
  lastRoll: RollRecord | null;
  rollHistory: RollRecord[];
  gameLog: LogEntry[];
  stats: GameStats;
  hostId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  result: GameResult | null;
  /** 服务端当前时间，用于校正客户端倒计时 */
  serverTime: number;
  minPlayers: number;
  maxPlayers: number;
  /** 未满员时房主手动开始；满员时自动开局倒计时 */
  autoStartAt: number | null;
}

/** 客户端本地身份，保存在 localStorage。 */
export interface LocalIdentity {
  guestId: string;
  sessionToken: string | null;
  playerId: string | null;
  nickname: string;
}

/* ------------------------------------------------------------------ *
 * ACK
 * ------------------------------------------------------------------ */

export interface AckError {
  ok: false;
  error: ErrorCode;
  message: string;
  snapshot?: GameSnapshot;
}

export interface AckOk<T> {
  ok: true;
  data: T;
}

export type Ack<T> = AckOk<T> | AckError;

export interface JoinResult {
  playerId: string;
  sessionToken: string;
  seat: number;
  isHost: boolean;
  snapshot: GameSnapshot;
}

/** room:create 的返回：新房间的房间码。 */
export interface CreateRoomResult {
  roomId: string;
}

/**
 * 站点统计。
 *
 * `visitors` 是**自本次开服以来**的去重到访人数，不是历史总量——
 * 统计和房间一样全在内存里，进程重启就归零。界面文案与文档都照实写，
 * 不把它包装成「累计至今」，否则重启之后那个数字就是在说谎。
 */
export interface SiteStats {
  /** 累计到访人数（按浏览器身份 guestId 去重，换桌/重连/多标签页只算一次） */
  visitors: number;
  /** 此刻坐在桌上的人（已入席且连接还在） */
  online: number;
  /**
   * 此刻**有人**的桌数（桌上至少坐着一位玩家）。
   *
   * 不是「房间表里的条目数」—— 人走光但还在空置宽限期里的桌不算，房主刚
   * 建好、朋友还没点进链接的空桌也不算。界面上的文案是「N 桌开着」，
   * 这个数要对得上那句话。
   */
  rooms: number;
}

export interface RollAck {
  accepted: boolean;
  turnId: string;
  roll?: RollRecord;
  snapshot: GameSnapshot;
}
