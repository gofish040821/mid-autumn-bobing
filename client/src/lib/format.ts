/** 展示层的小工具：时间、骰子、文案。 */
import { AWARD_MAP, NONE_MESSAGES } from '@bobing/shared';
import type { AwardId, RankingEntry } from '@bobing/shared';

const FACE_CN = ['', '一', '二', '三', '四', '五', '六'] as const;

/** 21:04 */
export function clockText(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/** 本局用时：3 分 12 秒 */
export function durationText(ms: number | null): string {
  if (ms === null || ms < 0) return '—';
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s} 秒`;
  return `${m} 分 ${s} 秒`;
}

/** 四 四 四 一 一 六 */
export function diceChinese(dice: readonly number[]): string {
  return dice.map((d) => FACE_CN[d] ?? '?').join(' ');
}

/** 444116 */
export function diceDigits(dice: readonly number[]): string {
  return dice.join('');
}

export function awardName(id: AwardId): string {
  return AWARD_MAP[id]?.name ?? '无奖';
}

export function awardTitle(id: AwardId): string {
  return AWARD_MAP[id]?.title ?? '月色尚浅';
}

/** 无奖时随机一句（每次调用都换）。 */
export function randomNoneMessage(): string {
  return NONE_MESSAGES[Math.floor(Math.random() * NONE_MESSAGES.length)];
}

/** 排行榜名次前缀 */
export function rankLabel(rank: number): string {
  if (rank === 1) return '第一';
  if (rank === 2) return '第二';
  if (rank === 3) return '第三';
  return `第 ${rank}`;
}

export function isTopThree(entry: RankingEntry): boolean {
  return entry.rank <= 3;
}

/** 昵称首字，用于头像圆牌。 */
export function initialOf(nickname: string): string {
  return nickname.trim().slice(0, 1) || '月';
}

/** 倒计时秒数 → 显示文本 */
export function countdownText(remainingMs: number): string {
  const seconds = Math.max(0, Math.ceil(remainingMs / 1000));
  return String(seconds);
}
