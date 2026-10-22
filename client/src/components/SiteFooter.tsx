import type { AppEnv } from '@shared/types';

const APP_VERSION = __APP_VERSION__;

/**
 * 页脚：六个页面共用一份。
 *
 * 之前每个页面各写一段同样的两行 HTML，改一次版本号或换个域名要动六个文件；
 * 而且站点名一直是纯文本 —— 它本来就该是能点的链接（https，新窗口打开）。
 */
export function SiteFooter({ env }: { env?: AppEnv }): JSX.Element {
  return (
    <footer className="d-footer">
      <p>
        by domonic ·{' '}
        <a href="https://17aitech.com" target="_blank" rel="noopener noreferrer">
          17aitech.com
        </a>
      </p>
      <p>
        WorkBuddy 1024 造物挑战 · v{APP_VERSION}
        {env === 'staging' ? ' · STAGING' : ''}
      </p>
    </footer>
  );
}
