/**
 * 房间码 —— 私密房间的唯一标识，也是邀请链接里带的那串字符。
 *
 * 字符集刻意剔除了 0/O、1/I/L 这些「口头报码必错」的字符：
 * 最常见的入房方式就是朋友在微信里发一句「房间号 7K3F」，
 * 或者干脆把带 ?room= 的链接甩过来。
 */

/** 去掉 0 O 1 I L 之后剩下的 31 个字符。 */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** 房间码长度。31^5 ≈ 2860 万种，一个中秋夜远远用不完。 */
export const ROOM_CODE_LENGTH = 5;

const ROOM_CODE_RE = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/**
 * 把用户输入规整成标准形式：去掉所有空白、统一大写。
 * 「7k3f」「7 K3F 」都会变成「7K3F」。
 */
export function normalizeRoomCode(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

export function isValidRoomCode(value: string): boolean {
  return ROOM_CODE_RE.test(value);
}

/**
 * 生成一个随机房间码。
 *
 * rng 可注入，测试里传确定性序列即可复现；对返回值做了防御性夹取，
 * rng 返回 1 / NaN 都不会越界取到 undefined。
 */
export function generateRoomCode(rng: () => number = Math.random): string {
  let out = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i += 1) {
    const r = rng();
    const clamped = Number.isFinite(r) ? Math.min(0.9999999, Math.max(0, r)) : 0;
    out += ROOM_CODE_ALPHABET[Math.floor(clamped * ROOM_CODE_ALPHABET.length)];
  }
  return out;
}
