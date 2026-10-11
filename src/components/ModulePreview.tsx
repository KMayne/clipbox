import { Component, Suspense, use, type ReactNode } from 'react';
import type { Kind } from '../core/types';
import type { ModuleId, PreviewProps } from '../modules/types';
import { useModuleStore } from '../state/moduleStore';

/** Renders `fallback` if the module fails to load (e.g. offline and not cached). */
class FallbackBoundary extends Component<
  { fallback: ReactNode; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

interface Props extends PreviewProps {
  module: ModuleId;
  kind: Kind;
  /** Shown while the module loads, if it's off, or if it fails. */
  fallback: ReactNode;
}

export function ModulePreview({ module, kind, handle, fallback }: Props) {
  const off = useModuleStore(s => s.policies[module] === 'off');
  if (off) return <>{fallback}</>;
  return (
    <FallbackBoundary fallback={fallback}>
      <Suspense fallback={fallback}>
        <LoadedPreview module={module} kind={kind} handle={handle} />
      </Suspense>
    </FallbackBoundary>
  );
}

function LoadedPreview({ module, kind, handle }: Omit<Props, 'fallback'>) {
  // loadUi caches its promise per module, so use() sees a stable promise
  const mod = use(useModuleStore.getState().loadUi(module));
  const Preview = mod.previews?.[kind];
  if (!Preview) throw new Error(`Module '${module}' has no '${kind}' preview`);
  return <Preview handle={handle} />;
}
