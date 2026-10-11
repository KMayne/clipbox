import { useAsync } from '../../components/useAsync';
import type { PreviewProps } from '../types';
import { MonacoView } from './MonacoView';

export function TextPreview({ handle }: PreviewProps) {
  const text = useAsync('text', () => handle.text());
  if (text.status !== 'ok') return null;
  return <MonacoView text={text.value} language={handle.summary.language ?? 'plaintext'} />;
}
