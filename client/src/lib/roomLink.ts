/**
 * 房间码与 URL 的互转。
 *
 * 房间码一律放在 `?room=XXXXX` 里，这样「邀请朋友」就是把地址栏
 * 原样复制过去 —— 不需要额外的邀请码输入框，刷新页面也能回到同一桌。
 */
import { isValidRoomCode, normalizeRoomCode } from '@bobing/shared';

const PARAM = 'room';

/** 从当前地址读出房间码；没有或不合法都返回 null。 */
export function readRoomCodeFromUrl(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get(PARAM);
    if (!raw) return null;
    const code = normalizeRoomCode(raw);
    return isValidRoomCode(code) ? code : null;
  } catch {
    return null;
  }
}

/**
 * 把房间码写回地址栏。
 *
 * 用 replaceState 而不是 pushState：从「未入席」到「已入席」是同一次
 * 导航的两个阶段，按返回键应该离开这一页，而不是退回上一个空房间。
 */
export function writeRoomCodeToUrl(roomId: string): void {
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get(PARAM) === roomId) return;
    url.searchParams.set(PARAM, roomId);
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* 无痕模式或 file:// 下可能不可用，忽略即可 */
  }
}

/** 把房间码从地址栏抹掉（房间不存在、要重新选桌时）。 */
export function clearRoomCodeFromUrl(): void {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* ignore */
  }
}

/** 可以直接发给朋友的邀请链接。 */
export function buildInviteLink(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, roomId);
  url.hash = '';
  return url.toString();
}
