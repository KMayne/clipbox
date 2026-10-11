import { css } from '@emotion/css';

// No scripts (sandbox) and no network: blocks tracking pixels and remote CSS in pasted HTML.
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:">`;

const frame = css`
  width: 100%;
  height: 100%;
  border: none;
  background: #fff;
`;

interface Props {
  html: string;
  title: string;
  /** Inline CSS injected before the content (allowed by the CSP's `style-src 'unsafe-inline'`). */
  stylesheet?: string;
  /** Frame background, shown before the document paints. */
  background?: string;
}

/** Renders untrusted HTML in an iframe with no scripts and no network access. */
export function SandboxedHtml({ html, title, stylesheet, background }: Props) {
  const style = stylesheet ? `<style>${stylesheet}</style>` : '';
  return (
    <iframe
      title={title}
      className={frame}
      style={background ? { background } : undefined}
      sandbox=""
      referrerPolicy="no-referrer"
      srcDoc={CSP + style + html}
    />
  );
}
