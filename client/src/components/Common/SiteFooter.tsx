/**
 * SiteFooter —— 页脚：站点统计 + 创作者署名。
 *
 * 两件事挤在一行里，都是有意的：
 *   - 统计是「给人看的气氛数字」，不该占据正文的注意力，压在页脚最合适；
 *   - 署名是创作者要的，但也没必要做成一个显眼的卡片。
 *
 * 关于统计的两个诚实之处（写得啰嗦一点，免得日后有人把文案改成「累计至今」）：
 *   1. 服务端状态全在内存，进程重启就归零。所以文案是「自本次开服以来」，
 *      不是「累计至今」——后者在重启之后就是一句假话。
 *   2. 第一份统计还没到（stats === null）时**什么都不显示**。宁可留白，
 *      也不要先画一个 0：那个 0 会被当成真的。
 *   3. 「桌开着」数的是**此刻桌上有人**的桌。服务端那边一度用的是「房间表
 *      里的条目数」，于是朋友散场后这个数字还要虚挂两分钟才掉。现在两个
 *      口径都是「有人才算」，所以这两句话都不用改文案。
 *
 * 全部为文本与内联 SVG，没有任何外部图片 —— 既不 hotlink 来源不明的图，
 * 也不会让验收脚本里「没有访问任何外部网络」那条断言失败。
 */
import './Common.css';

import { useGameStore } from '../../stores/gameStore';

const CREATOR = 'gofish040821';
const CREATOR_URL = `https://github.com/${CREATOR}`;

/** 极简的「外链」小图标（内联 SVG，不依赖任何外部资源）。 */
function LinkIcon(): JSX.Element {
  return (
    <svg
      className="common-footer__icon"
      viewBox="0 0 12 12"
      width="10"
      height="10"
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M7.2 1.6h3.2v3.2M10.4 1.6 6.1 5.9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M9.3 7.4v2.4a.9.9 0 0 1-.9.9H2.5a.9.9 0 0 1-.9-.9V3.9a.9.9 0 0 1 .9-.9h2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function SiteFooter(): JSX.Element {
  const stats = useGameStore((s) => s.stats);

  return (
    <footer className="common-footer">
      <p className="common-footer__row">
        <span className="common-footer__label t-fang">创作者</span>
        <a
          className="common-footer__creator"
          href={CREATOR_URL}
          target="_blank"
          rel="noreferrer noopener"
        >
          @{CREATOR}
          <LinkIcon />
        </a>
      </p>

      {stats ? (
        <p
          className="common-footer__row common-footer__row--stats"
          title="统计只存在于服务器内存里，服务重启后会重新计起。"
        >
          <span className="common-footer__stat">
            <span className="common-footer__num">{stats.visitors}</span>
            <span className="common-footer__label t-fang">人到访</span>
          </span>
          <span className="common-footer__dot" aria-hidden="true">
            ·
          </span>
          <span className="common-footer__stat">
            <span className="common-footer__num">{stats.online}</span>
            <span className="common-footer__label t-fang">人在席</span>
          </span>
          <span className="common-footer__dot" aria-hidden="true">
            ·
          </span>
          <span className="common-footer__stat">
            <span className="common-footer__num">{stats.rooms}</span>
            <span className="common-footer__label t-fang">桌开着</span>
          </span>
          <span className="common-footer__label common-footer__note t-fang">自本次开服以来</span>
        </p>
      ) : null}
    </footer>
  );
}
