/**
 * 全部可调参数集中在这里。
 *
 * 想改玩法（回合时长、月华保底、演出节奏、人数上下限），
 * 只改这个文件就够了，不需要动任何逻辑代码。
 */

/* ---------------- 房间与人数 ---------------- */

/** 第一版只有一桌。 */
export const ROOM_ID = 'MAIN_ROOM';
export const ROOM_TITLE = '月满中秋 · 今夜博饼局';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 15;

/** 凑满（满员）后的自动开局倒计时。 */
export const AUTO_START_COUNTDOWN_MS = 5_000;

/**
 * 等待大厅里，玩家掉线多久之后被移出座位（好腾位置给别人）。
 * 游戏一旦开始就永不移除玩家，只标记 offline。
 * 刷新页面只需 1~2 秒即可重连，60 秒足够宽松。
 */
export const LOBBY_GHOST_TTL_MS = 60_000;

/**
 * 一桌人全部掉线多久之后，判定为「散场」，把这局作废、房间退回大厅。
 *
 * 没有这个兜底会出现死锁：牌局进行中所有人都关了页面（散场、断网、手机没电），
 * 房间会永远停在 NORMAL_TURN / FINISHED —— 真人进不来（提示「本桌已经开席」），
 * 而房主也不在线，没人能重开。只能重启服务进程。
 *
 * 给到 2 分钟是因为要区分两种情况：
 *   - 短暂掉线（切后台、Wi-Fi 抖动、手机息屏）：1~2 秒就重连回来了，不该毁掉牌局；
 *   - 真的散场：人都走了，牌局留着也没意义。
 * 注意这条只在「一个人都不在线」时才计时，只要还有一个人在，牌局一律继续。
 */
export const ABANDON_GRACE_MS = Number(process.env.ABANDON_GRACE_MS ?? 120_000);

/* ---------------- 回合 ---------------- */

/** 每位玩家的思考时间；超过由服务器自动代掷。 */
export const TURN_TIMEOUT_MS = 30_000;

/**
 * 开奖后到下一回合之间的「演出时间」。
 *
 * 具体时长由 shared/src/timing.ts 的 ROLL_TIMING 表决定
 * （骰子动画 + 中奖演出 + 缓冲），客户端读同一张表，
 * 所以两边的节奏永远一致。想整体调快/调慢就改那张表。
 */
export { ROLL_TIMING, TRANSITION_BUFFER_MS, transitionMsFor } from '@bobing/shared';

/* ---------------- 月华加持 / 状元保底 ---------------- */

/** 从第几轮开始开启月华加持（第一轮完全不干预）。 */
export const MOON_BLESSING_START_ROUND = 2;

/** 第二轮第一次额外状元概率。 */
export const MOON_BLESSING_INITIAL_RATE = 0.03;

/** 之后每掷一次仍未出状元，额外提升的概率。 */
export const MOON_BLESSING_RATE_INCREMENT = 0.01;

/** 额外概率上限。 */
export const MOON_BLESSING_MAX_RATE = 0.15;

/** 最多五个完整轮次内必须出现首个状元。 */
export const CHAMPION_GUARANTEE_ROUND = 5;

/**
 * 月华加持触发时，生成 Champion Tier 的权重。
 * 普通状元常见，顶级状元依然罕见。
 */
export const CHAMPION_WEIGHTS: Readonly<Record<string, number>> = {
  FOUR_FOUR: 64,
  FIVE_SCHOLAR: 27,
  FIVE_FOUR: 5,
  SIX_BLACK: 1,
  BROCADE: 1,
  SIX_FOUR: 1,
  CHAMPION_FLOWER: 1,
};

/* ---------------- 积分 ---------------- */

/** 最终状元额外奖励。 */
export const CHAMPION_BONUS = 100;

/* ---------------- 历史与日志 ---------------- */

export const MAX_LOG_ENTRIES = 200;
export const MAX_ROLL_HISTORY = 300;

/* ---------------- 服务端 ---------------- */

export const SERVER_PORT = Number(process.env.PORT ?? 3001);

/** 掉线多久之后视为「离线」（Socket.IO 自己会重连，这里只做展示用兜底）。 */
export const PLAYER_OFFLINE_AFTER_MS = 15_000;

/* ---------------- 汇总对象（方便一次性读取） ---------------- */

export const GAME_CONFIG = {
  ROOM_ID,
  MIN_PLAYERS,
  MAX_PLAYERS,
  AUTO_START_COUNTDOWN_MS,
  LOBBY_GHOST_TTL_MS,
  ABANDON_GRACE_MS,
  TURN_TIMEOUT_MS,
  MOON_BLESSING_START_ROUND,
  MOON_BLESSING_INITIAL_RATE,
  MOON_BLESSING_RATE_INCREMENT,
  MOON_BLESSING_MAX_RATE,
  CHAMPION_GUARANTEE_ROUND,
  CHAMPION_BONUS,
} as const;
