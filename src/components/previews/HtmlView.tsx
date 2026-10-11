import type { ValueHandle } from '../../core/types';
import { useAsync } from '../useAsync';
import { SandboxedHtml } from './SandboxedHtml';

/** The rendered page; its source is the Inspector's Text view. */
export function HtmlView({ handle }: { handle: ValueHandle }) {
  const html = useAsync('text', () => handle.text());
  if (html.status !== 'ok') return null;
  return <SandboxedHtml title="HTML preview" html={html.value} />;
}
