import { css, cx } from '@emotion/css';
import { mdiChevronDown, mdiChevronRight, mdiLoading, mdiPlay } from '@mdi/js';
import { Icon } from '@mdi/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { defaultParams, formFields, type FormField } from '../core/actions/form';
import { ACTION_GROUPS, hasSettings, type ActionInfo } from '../core/actions/types';
import type { Derivation } from '../core/types';
import { derivationKey, runAction, runDerivation, selectionActions } from '../state/actions';
import { useCaptureStore, type Selection } from '../state/captureStore';
import { useRunsFor } from '../state/runs';
import { useUiStore } from '../state/uiStore';
import { theme } from '../theme';
import { InlineRun } from './RunProgress';
import { ui } from './ui';
import { useAsync } from './useAsync';

const styles = {
  filter: css`
    margin: 0 8px 6px;
    padding: 4px 8px;
    background: ${theme.bg};
    border: 1px solid ${theme.border};
    border-radius: 4px;
    &:focus {
      border-color: ${theme.accent};
      outline: none;
    }
  `,
  list: css`
    flex: 1;
    overflow-y: auto;
    padding-bottom: 8px;
  `,
  group: css`
    padding: 8px 10px 2px;
    font-size: 11px;
    color: ${theme.faint};
    text-transform: uppercase;
    letter-spacing: 0.06em;
  `,
  item: css`
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    padding: 4px 10px;
    background: none;
    border: none;
    text-align: left;
    cursor: pointer;
    &:hover,
    &:focus-visible {
      background: ${theme.hover};
    }
    &:disabled {
      cursor: progress;
    }
    & > .trail {
      margin-left: auto;
      display: inline-flex;
      color: ${theme.muted};
    }
  `,
  expanded: css`
    background: ${theme.raised};
  `,
  form: css`
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 10px 10px 24px;
    background: ${theme.raised};
    border-bottom: 1px solid ${theme.subtle};
  `,
  field: css`
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 12px;
    color: ${theme.muted};
    & input:not([type='checkbox']),
    & select,
    & textarea {
      padding: 3px 6px;
      background: ${theme.bg};
      color: ${theme.text};
      border: 1px solid ${theme.border};
      border-radius: 3px;
      font-size: 13px;
    }
    & input:focus,
    & select:focus,
    & textarea:focus {
      border-color: ${theme.accent};
      outline: none;
    }
  `,
  check: css`
    flex-direction: row;
    align-items: center;
    gap: 6px;
    color: ${theme.text};
  `,
  hint: css`
    color: ${theme.faint};
    font-size: 11px;
  `,
  error: css`
    color: ${theme.error};
    font-size: 12px;
  `,
  run: css`
    align-self: flex-start;
  `,
};

/** The sidebar's Actions section: the selected value's actions and "Open" derivations. */
export function ActionsSection() {
  const selection = useCaptureStore(s => s.selection);
  return selection ? (
    <SelectionActions key={`${selection.entryId}:${selection.kind}`} selection={selection} />
  ) : (
    <div className={ui.empty}>Select a value to see its actions</div>
  );
}

type FocusRequest = NonNullable<UiFocus>;
type UiFocus = ReturnType<typeof useUiStore.getState>['focusedAction'];

type Entry = { type: 'action'; info: ActionInfo } | { type: 'derivation'; derivation: Derivation };

function SelectionActions({ selection }: { selection: Selection }) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const available = useAsync(`${selection.entryId}:${selection.kind}`, () =>
    selectionActions(selection),
  );

  // The palette asked for an action's form: expand it (the form focuses itself). Taking the
  // request clears it, so it doesn't reopen on the next selection.
  useEffect(() => {
    const take = (request: FocusRequest | null) => {
      if (!request) return;
      useUiStore.setState({ focusedAction: null });
      setQuery('');
      setExpanded(request.id);
      setFocusRequest(request);
    };
    take(useUiStore.getState().focusedAction);
    return useUiStore.subscribe(s => take(s.focusedAction));
  }, []);

  const groups = useMemo(() => {
    if (available.status !== 'ok') return [];
    const q = query.trim().toLowerCase();
    const match = (title: string, group: string) =>
      !q || title.toLowerCase().includes(q) || group.toLowerCase().includes(q);
    const out: { group: string; entries: Entry[] }[] = [];
    const opens = available.value.derivations.filter(d => match(d.label, 'Open'));
    if (opens.length) {
      out.push({
        group: 'Open',
        entries: opens.map(derivation => ({ type: 'derivation', derivation })),
      });
    }
    for (const group of ACTION_GROUPS) {
      const infos = available.value.actions.filter(a => a.group === group && match(a.title, group));
      if (infos.length) out.push({ group, entries: infos.map(info => ({ type: 'action', info })) });
    }
    return out;
  }, [available, query]);

  return (
    <>
      <input
        className={styles.filter}
        placeholder="Filter actions…"
        aria-label="Filter actions"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            setQuery('');
            e.currentTarget.blur();
          }
        }}
      />
      <div className={styles.list}>
        {available.status === 'loading' && <div className={ui.empty}>Loading…</div>}
        {available.status === 'error' && <div className={ui.empty}>{available.error}</div>}
        {available.status === 'ok' && groups.length === 0 && (
          <div className={ui.empty}>
            {query ? 'No matching actions' : 'No actions for this value'}
          </div>
        )}
        {groups.map(({ group, entries }) => (
          <div key={group} role="group" aria-label={group}>
            <div className={styles.group}>{group}</div>
            {entries.map(e =>
              e.type === 'derivation' ? (
                <DerivationItem
                  key={`open.${e.derivation.id}`}
                  selection={selection}
                  derivation={e.derivation}
                />
              ) : (
                <ActionItem
                  key={e.info.id}
                  selection={selection}
                  info={e.info}
                  expanded={expanded === e.info.id}
                  focusSeq={focusRequest?.id === e.info.id ? focusRequest.seq : 0}
                  onToggle={() => setExpanded(x => (x === e.info.id ? null : e.info.id))}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </>
  );
}

const Spinner = () => <Icon path={mdiLoading} size={0.6} spin aria-label="Running" />;

function DerivationItem({
  selection,
  derivation,
}: {
  selection: Selection;
  derivation: Derivation;
}) {
  const [running, setRunning] = useState(false);
  const runs = useRunsFor(selection, derivationKey(derivation.id));
  return (
    <>
      <button
        className={styles.item}
        disabled={running}
        onClick={() => {
          setRunning(true);
          void runDerivation(selection, derivation).finally(() => setRunning(false));
        }}
      >
        {derivation.label}
        <span className="trail">{running && <Spinner />}</span>
      </button>
      {runs.map(r => (
        <InlineRun key={r.id} run={r} />
      ))}
    </>
  );
}

function ActionItem({
  selection,
  info,
  expanded,
  focusSeq,
  onToggle,
}: {
  selection: Selection;
  info: ActionInfo;
  expanded: boolean;
  focusSeq: number;
  onToggle(): void;
}) {
  const [running, setRunning] = useState(false);
  const runs = useRunsFor(selection, info.id);
  const settings = hasSettings(info);

  const run = async (params?: Record<string, unknown>) => {
    setRunning(true);
    try {
      await runAction(selection, info, params);
    } finally {
      setRunning(false);
    }
  };

  return (
    <>
      <button
        className={cx(styles.item, expanded && styles.expanded)}
        disabled={running}
        aria-expanded={settings ? expanded : undefined}
        title={settings ? 'Show settings' : `Run ${info.title}`}
        onClick={() => (settings ? onToggle() : void run())}
      >
        {info.title}
        <span className="trail">
          {running ? (
            <Spinner />
          ) : settings ? (
            <Icon path={expanded ? mdiChevronDown : mdiChevronRight} size={0.6} />
          ) : null}
        </span>
      </button>
      {runs.map(r => (
        <InlineRun key={r.id} run={r} />
      ))}
      {settings && expanded && (
        <SettingsForm
          info={info}
          running={running}
          focusSeq={focusSeq}
          onRun={run}
          onCancel={onToggle}
        />
      )}
    </>
  );
}

type Values = Record<string, unknown>;

function SettingsForm({
  info,
  running,
  focusSeq,
  onRun,
  onCancel,
}: {
  info: ActionInfo;
  running: boolean;
  focusSeq: number;
  onRun(params: Values): Promise<void>;
  onCancel(): void;
}) {
  const fields = useMemo(() => formFields(info.params), [info]);
  const [values, setValues] = useState<Values>(() => defaultParams(info));
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // Focus the first field when opened, and again whenever the palette asks for this form
  useEffect(() => {
    const first = formRef.current?.querySelector<HTMLElement>('input, select, textarea');
    first?.focus();
    formRef.current?.scrollIntoView({ block: 'nearest' });
  }, [focusSeq]);

  const set = (key: string, value: unknown) => {
    setError(null);
    setValues(v => ({ ...v, [key]: value }));
  };

  const submit = () => {
    if (running) return;
    // Checked here for a quick message; the worker validates again before running
    const parsed = info.params.safeParse(values);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const field = fields.find(f => f.key === issue?.path[0]);
      setError(`${field ? `${field.title}: ` : ''}${issue?.message ?? 'Invalid settings'}`);
      return;
    }
    void onRun(parsed.data);
  };

  return (
    <form
      ref={formRef}
      className={styles.form}
      aria-label={`${info.title} settings`}
      onSubmit={e => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onCancel();
        } else if (
          e.key === 'Enter' &&
          (e.ctrlKey || e.metaKey || !(e.target instanceof HTMLTextAreaElement))
        ) {
          // Enter runs from any field (selects and checkboxes don't submit natively);
          // textareas take plain Enter as a newline, so they run on Ctrl+Enter
          e.preventDefault();
          submit();
        }
      }}
    >
      {fields.map(f => (
        <Field key={f.key} field={f} value={values[f.key]} onChange={v => set(f.key, v)} />
      ))}
      {error && (
        <div className={styles.error} role="alert">
          {error}
        </div>
      )}
      <button type="submit" className={cx(ui.button, styles.run)} disabled={running}>
        {running ? <Spinner /> : <Icon path={mdiPlay} size={0.6} />}
        Run
      </button>
    </form>
  );
}

function Field({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: unknown;
  onChange(v: unknown): void;
}) {
  const hint = field.description && <span className={styles.hint}>{field.description}</span>;
  switch (field.type) {
    case 'boolean':
      return (
        <label className={cx(styles.field, styles.check)}>
          <input
            type="checkbox"
            checked={value === true}
            onChange={e => onChange(e.target.checked)}
          />
          {field.title}
          {hint}
        </label>
      );
    case 'enum':
      return (
        <label className={styles.field}>
          {field.title}
          <select value={String(value)} onChange={e => onChange(e.target.value)}>
            {field.options.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {hint}
        </label>
      );
    case 'number':
      return (
        <label className={styles.field}>
          {field.title}
          <input
            type="number"
            value={typeof value === 'number' && Number.isFinite(value) ? value : ''}
            min={field.min}
            max={field.max}
            step={field.integer ? 1 : 'any'}
            onChange={e => onChange(e.target.value === '' ? NaN : e.target.valueAsNumber)}
          />
          {hint}
        </label>
      );
    case 'string': {
      // Secrets (keys): no autocomplete, spellcheck or password-manager prompts
      const secret = field.secret
        ? { autoComplete: 'off', spellCheck: false, 'data-1p-ignore': true, 'data-lpignore': true }
        : {};
      return (
        <label className={styles.field}>
          {field.title}
          {field.hint === 'multiline' ? (
            <textarea
              {...secret}
              rows={3}
              className={ui.mono}
              value={String(value ?? '')}
              onChange={e => onChange(e.target.value)}
            />
          ) : (
            <input
              {...secret}
              type="text"
              spellCheck={false}
              className={field.hint === 'regex' ? ui.mono : undefined}
              value={String(value ?? '')}
              onChange={e => onChange(e.target.value)}
            />
          )}
          {hint}
        </label>
      );
    }
  }
}
