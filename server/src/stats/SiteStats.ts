/**
 * SiteStats —— 站点统计（累计到访人数）。
 *
 * 到访按 **guestId 去重**，而不是按连接或按次数：
 * 同一个人换桌、刷新页面、开两个标签页、断线重连，都只算一次。
 * 计一个「人头数」，不是「PV」。
 *
 * 状态全在内存里，和房间一样进程重启即归零。这是刻意的——本项目的
 * 原则是不引数据库（一局游戏才几分钟，落库的复杂度不值得）。代价是
 * 这个数字**不是历史总量**，所以界面和文档都照实写「自本次开服以来」，
 * 不把它包装成永久累计。
 *
 * 想要真正跨重启的累计，就得引入持久化存储（一个 JSON 文件在免费档上
 * 也活不过一次重新部署，得上外置存储），那是另一个取舍。
 */
import type { SiteStats as SiteStatsView } from '@bobing/shared';

export class SiteStats {
  private readonly visitors = new Set<string>();

  /**
   * 记一次到访。返回 true 表示这是第一次见到这个人。
   *
   * 返回值用来决定要不要广播——同一个人反复重连不该让所有人刷屏。
   */
  recordVisit(guestId: string): boolean {
    if (guestId.length === 0) return false;
    if (this.visitors.has(guestId)) return false;
    this.visitors.add(guestId);
    return true;
  }

  get visitorCount(): number {
    return this.visitors.size;
  }

  /** 组装对外的统计视图。在线人数与桌数由调用方提供（它们不属于这里）。 */
  snapshot(online: number, rooms: number): SiteStatsView {
    return { visitors: this.visitors.size, online, rooms };
  }
}
