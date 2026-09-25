/**
 * 所有来自客户端的输入都必须经过这里的 Zod 校验。
 * 服务端绝不信任 payload 里的任何字段。
 */
import { z } from 'zod';

import { isValidRoomCode, normalizeRoomCode } from './roomCode.js';

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** 去掉控制字符与首尾空白，防止昵称注入换行/终端转义。 */
export const nicknameSchema = z
  .string()
  .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, '').trim())
  .pipe(
    z
      .string()
      .min(NICKNAME_MIN, `昵称至少 ${NICKNAME_MIN} 个字`)
      .max(NICKNAME_MAX, `昵称最多 ${NICKNAME_MAX} 个字`),
  );

export const guestIdSchema = z.string().min(6).max(64);
export const sessionTokenSchema = z.string().min(8).max(128);
export const turnIdSchema = z.string().regex(/^turn_\d{6,}$/, 'turnId 格式不合法');
export const actionIdSchema = z.string().min(1).max(64);

/**
 * 房间码。先规整（去空白、转大写）再校验，
 * 这样朋友发来的「7k3f」和「7K3F」都能进同一桌。
 */
export const roomCodeSchema = z
  .string()
  .max(32)
  .transform(normalizeRoomCode)
  .refine(isValidRoomCode, { message: '房间码不正确，请检查邀请链接' });

export const joinPayloadSchema = z.object({
  guestId: guestIdSchema,
  sessionToken: sessionTokenSchema.nullish(),
  nickname: nicknameSchema,
  roomId: roomCodeSchema,
});

export const syncPayloadSchema = z.object({
  sessionToken: sessionTokenSchema,
});

export const setNicknamePayloadSchema = z.object({
  nickname: nicknameSchema,
});

export const rollPayloadSchema = z.object({
  turnId: turnIdSchema,
  actionId: actionIdSchema,
});

/** game:start / game:restart 不接受任何有效负载。 */
export const emptyPayloadSchema = z.unknown().optional();

/** 单项奖品数量：0~1000，整数。 */
const prizeCountSchema = z.number().int().min(0).max(1000);
/** 单项奖品积分：0~100000，整数。 */
const prizeScoreSchema = z.number().int().min(0).max(100000);

/**
 * 开房配置。counts 只含五类普通奖品（状元恒 1），scores 含全部六类。
 * 缺省不传时服务端回落到 DEFAULT_ROOM_CONFIG。
 */
export const roomConfigSchema = z.object({
  counts: z.object({
    ONE_SHOW: prizeCountSchema,
    TWO_LIFT: prizeCountSchema,
    THREE_RED: prizeCountSchema,
    FOUR_ADVANCE: prizeCountSchema,
    DUITANG: prizeCountSchema,
  }),
  scores: z.object({
    ONE_SHOW: prizeScoreSchema,
    TWO_LIFT: prizeScoreSchema,
    THREE_RED: prizeScoreSchema,
    FOUR_ADVANCE: prizeScoreSchema,
    DUITANG: prizeScoreSchema,
    CHAMPION: prizeScoreSchema,
  }),
});

export type RoomConfigInput = z.input<typeof roomConfigSchema>;

export type JoinPayloadInput = z.input<typeof joinPayloadSchema>;
export type RollPayloadInput = z.input<typeof rollPayloadSchema>;

/** 中秋主题随机昵称池 —— 全部无攻击性，可直接使用。 */
export const RANDOM_NICKNAMES: readonly string[] = [
  '月下客',
  '桂花酿',
  '玉兔先生',
  '广寒游客',
  '月桂小仙',
  '团圆饼',
  '追月人',
  '灯下客',
  '桂香君',
  '月满西楼',
  '把酒问月',
  '清辉照人',
  '蟾宫折桂',
  '秋夕闲人',
  '一壶月白',
  '云间月',
  '桂子飘香',
  '望月怀远',
  '银汉无声',
  '中秋小友',
  '吴刚伐桂',
  '饼中藏月',
  '兔影摇光',
  '月华如练',
  '人间团圆',
  '天心月圆',
  '素月分辉',
  '桂枝香',
  '露华浓',
  '海上生明月',
];

/** 随机取一个不与 taken 冲突的昵称。 */
export function pickRandomNickname(taken: readonly string[] = []): string {
  const used = new Set(taken);
  const free = RANDOM_NICKNAMES.filter((n) => !used.has(n));
  const pool = free.length > 0 ? free : RANDOM_NICKNAMES;
  const idx = Math.floor(Math.random() * pool.length);
  const base = pool[idx];
  if (used.has(base)) {
    // 池子用尽时加一个温和的后缀
    for (let i = 2; i < 99; i += 1) {
      const candidate = `${base.slice(0, NICKNAME_MAX - 2)}·${i}`;
      if (!used.has(candidate)) return candidate;
    }
  }
  return base;
}
