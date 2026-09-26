/**
 * SiteFooter —— 页面底部的 GitHub 项目贡献者。
 * 全部为文本与内联 SVG，不加载外部图片。
 */
import './Common.css';

/** 与仓库 GitHub Contributors 页面一致；新增贡献者时在这里补充账号。 */
const CONTRIBUTORS = ['gofish040821', 'gamer-guangying', 'elephanthy'] as const;

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
  return (
    <footer className="common-footer" aria-label="项目贡献者">
      <p className="common-footer__label t-fang">项目贡献者</p>
      <ul className="common-footer__contributors">
        {CONTRIBUTORS.map((login) => (
          <li key={login}>
            <a
              className="common-footer__link"
              href={`https://github.com/${login}`}
              target="_blank"
              rel="noreferrer noopener"
            >
              @{login}
              <LinkIcon />
            </a>
          </li>
        ))}
      </ul>
    </footer>
  );
}
