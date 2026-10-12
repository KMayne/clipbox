import { css } from '@emotion/css';
import { mdiArrowTopRight, mdiGithub } from '@mdi/js';
import { Icon } from '@mdi/react';
import { theme } from '../theme';

/** The author's site: its root when deployed under a subpath (e.g. /clipbox/), else the live URL. */
const SITE_URL = import.meta.env.BASE_URL !== '/' ? '/' : 'https://kianmayne.co.uk/';
const REPO_URL = 'https://github.com/KMayne/clipbox';

const styles = {
  links: css`
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
  `,
  link: css`
    display: inline-flex;
    align-items: center;
    gap: 2px;
    font-size: var(--text-xs);
    white-space: nowrap;
    /* Subtle but at least 4.5:1 against the panel in every scheme. */
    color: color-mix(in srgb, ${theme.muted}, ${theme.text} 30%);
    text-decoration: none;
    &:hover {
      color: ${theme.text};
      text-decoration: underline;
    }
  `,
};

/** The source repo and the author's site, each opening in a new tab. */
export function SiteLinks() {
  return (
    <span className={styles.links}>
      <a
        className={styles.link}
        href={REPO_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Source on GitHub (opens in a new tab)"
      >
        <Icon path={mdiGithub} size={0.5} />
        Source
        <Icon path={mdiArrowTopRight} size={0.45} />
      </a>
      <a
        className={styles.link}
        href={SITE_URL}
        target="_blank"
        rel="noopener noreferrer"
        title="Opens in a new tab"
      >
        KianMayne.co.uk
        <Icon path={mdiArrowTopRight} size={0.45} />
      </a>
    </span>
  );
}
