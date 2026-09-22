/**
 * 本地身份与偏好设置（全部存在 localStorage）。
 *
 * guestId 与 sessionToken 是断线重连、刷新恢复的关键：
 *   guestId      —— 浏览器身份，第一次访问时生成，永不变
 *   sessionToken —— 服务端发的座位凭证，刷新/掉线后靠它回到原座位
 */
import type { LocalIdentity } from '@bobing/shared';

const KEYS = {
  guestId: 'bobing_guest_id_v1',
  sessionToken: 'bobing_session_token_v1',
  playerId: 'bobing_player_id_v1',
  nickname: 'bobing_nickname_v1',
  rulesSeen: 'bobing_rules_seen_v1',
  audioEnabled: 'bobing_audio_enabled_v1',
  volume: 'bobing_audio_volume_v1',
  reducedMotion: 'bobing_reduced_motion_v1',
} as const;

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式下 localStorage 可能不可用，忽略即可 */
  }
}

function randomGuestId(): string {
  try {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
      return `g_${crypto.randomUUID()}`;
    }
  } catch {
    /* fallthrough */
  }
  const rand = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  return `g_${Date.now().toString(36)}_${rand}`;
}

/** 取（或首次生成）浏览器游客 id。 */
export function getOrCreateGuestId(): string {
  const existing = safeGet(KEYS.guestId);
  if (existing && existing.length >= 6) return existing;
  const created = randomGuestId();
  safeSet(KEYS.guestId, created);
  return created;
}

export function loadIdentity(): LocalIdentity {
  return {
    guestId: getOrCreateGuestId(),
    sessionToken: safeGet(KEYS.sessionToken),
    playerId: safeGet(KEYS.playerId),
    nickname: safeGet(KEYS.nickname) ?? '',
  };
}

export function saveSession(sessionToken: string, playerId: string): void {
  safeSet(KEYS.sessionToken, sessionToken);
  safeSet(KEYS.playerId, playerId);
}

export function clearSession(): void {
  safeSet(KEYS.sessionToken, null);
  safeSet(KEYS.playerId, null);
}

export function saveNickname(nickname: string): void {
  safeSet(KEYS.nickname, nickname);
}

export function hasSeenRules(): boolean {
  return safeGet(KEYS.rulesSeen) === '1';
}

export function markRulesSeen(): void {
  safeSet(KEYS.rulesSeen, '1');
}

export function loadAudioEnabled(): boolean {
  return safeGet(KEYS.audioEnabled) !== '0';
}

export function saveAudioEnabled(enabled: boolean): void {
  safeSet(KEYS.audioEnabled, enabled ? '1' : '0');
}

export function loadVolume(): number {
  const raw = safeGet(KEYS.volume);
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0.72;
}

export function saveVolume(volume: number): void {
  safeSet(KEYS.volume, String(volume));
}

export function loadReducedMotion(): boolean {
  const stored = safeGet(KEYS.reducedMotion);
  if (stored === '1') return true;
  if (stored === '0') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function saveReducedMotion(value: boolean): void {
  safeSet(KEYS.reducedMotion, value ? '1' : '0');
}
