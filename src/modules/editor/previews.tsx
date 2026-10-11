import { useAsync } from '../../components/useAsync';
import type { PreviewProps } from '../types';
import { MonacoView } from './MonacoView';

export function TextPreview({ handle }: PreviewProps) {
  const text = useAsync('full', () => handle.getSlice({ type: 'full' }) as Promise<string>);
  if (text.status !== 'ok') return null;
  return <MonacoView text={text.value} language={handle.summary.language ?? 'plaintext'} />;
}

export function HtmlSourcePreview({ handle }: PreviewProps) {
  const html = useAsync('full', () => handle.getSlice({ type: 'full' }) as Promise<string>);
  if (html.status !== 'ok') return null;
  return <MonacoView text={html.value} language="html" />;
}
