import { css } from '@emotion/css';
import { z } from 'zod';
import type { ValueHandle } from '../../core/types';
import { commonName, daysUntil, expiryText, type PemBlockInfo } from '../../modules/x509/types';
import { theme } from '../../theme';
import { ui } from '../ui';
import { useAsync } from '../useAsync';

const blockSchema: z.ZodType<PemBlockInfo> = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('certificate'),
    subject: z.string(),
    issuer: z.string(),
    serial: z.string(),
    notBefore: z.string(),
    notAfter: z.string(),
    sans: z.array(z.string()),
    publicKey: z.string(),
    signature: z.string(),
    sha256: z.string(),
    isCA: z.boolean(),
    selfSigned: z.boolean(),
  }),
  z.object({
    type: z.literal('csr'),
    subject: z.string(),
    sans: z.array(z.string()),
    publicKey: z.string(),
    signature: z.string(),
  }),
  z.object({ type: z.literal('public-key'), publicKey: z.string() }),
  z.object({ type: z.literal('private-key'), format: z.string(), key: z.string() }),
  z.object({ type: z.literal('unknown'), label: z.string(), error: z.string() }),
]);
const pemSchema = z.object({ blocks: z.array(blockSchema) });

const AMBER_DAYS = 30;

const styles = {
  wrap: css`
    position: absolute;
    inset: 0;
    overflow: auto;
    padding: 12px 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `,
  card: css`
    border: 1px solid ${theme.subtle};
    border-radius: 6px;
    background: ${theme.panel};
    padding: 10px 14px;
  `,
  head: css`
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
  `,
  type: css`
    color: ${theme.muted};
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  `,
  title: css`
    font-weight: 600;
    overflow-wrap: anywhere;
  `,
  badge: css`
    margin-left: auto;
    padding: 1px 8px;
    border-radius: 10px;
    color: #1e1e1e;
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
  `,
  grid: css`
    display: grid;
    grid-template-columns: minmax(100px, max-content) 1fr;
    gap: 3px 16px;
    font-size: 12px;
  `,
  label: css`
    color: ${theme.muted};
  `,
  value: css`
    font-family: ${theme.mono};
    overflow-wrap: anywhere;
  `,
};

type Tone = 'expired' | 'expiring' | 'valid';
const TONES: Record<Tone, string> = { expired: theme.error, expiring: '#e5c07b', valid: '#98c379' };

function ExpiryBadge({
  notAfter,
  notBefore,
  now,
}: {
  notAfter: string;
  notBefore: string;
  now: number;
}) {
  const days = daysUntil(notAfter, now);
  const notYet = Date.parse(notBefore) > now;
  const tone: Tone = days <= 0 ? 'expired' : days < AMBER_DAYS ? 'expiring' : 'valid';
  const text = notYet && tone !== 'expired' ? 'not yet valid' : expiryText(notAfter, now);
  return (
    <span
      className={styles.badge}
      style={{ background: TONES[tone] }}
      data-testid="expiry-badge"
      data-tone={tone}
    >
      {text}
    </span>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <div className={styles.grid}>
      {rows.map(([label, value]) => (
        <span key={label} style={{ display: 'contents' }}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{value}</span>
        </span>
      ))}
    </div>
  );
}

function BlockCard({ block, index, now }: { block: PemBlockInfo; index: number; now: number }) {
  switch (block.type) {
    case 'certificate':
      return (
        <div className={styles.card} data-testid="pem-card" data-type="certificate">
          <div className={styles.head}>
            <span className={styles.type}>
              {index === 0 ? 'Certificate' : `Chain #${index + 1}`}
              {block.isCA ? ' · CA' : ''}
            </span>
            <span className={styles.title}>{commonName(block.subject)}</span>
            <ExpiryBadge notAfter={block.notAfter} notBefore={block.notBefore} now={now} />
          </div>
          <Fields
            rows={[
              ['Subject', block.subject],
              ['Issuer', block.selfSigned ? `${block.issuer} (self-signed)` : block.issuer],
              ['Valid', `${block.notBefore} → ${block.notAfter}`],
              ['SANs', block.sans.join(', ') || '(none)'],
              ['Public key', block.publicKey],
              ['Signature', block.signature],
              ['Serial', block.serial],
              ['SHA-256', block.sha256],
            ]}
          />
        </div>
      );
    case 'csr':
      return (
        <div className={styles.card} data-testid="pem-card" data-type="csr">
          <div className={styles.head}>
            <span className={styles.type}>Certificate request</span>
            <span className={styles.title}>{commonName(block.subject)}</span>
          </div>
          <Fields
            rows={[
              ['Subject', block.subject],
              ['SANs', block.sans.join(', ') || '(none)'],
              ['Public key', block.publicKey],
              ['Signature', block.signature],
            ]}
          />
        </div>
      );
    case 'public-key':
      return (
        <div className={styles.card} data-testid="pem-card" data-type="public-key">
          <div className={styles.head}>
            <span className={styles.type}>Public key</span>
            <span className={styles.title}>{block.publicKey}</span>
          </div>
        </div>
      );
    case 'private-key':
      return (
        <div className={styles.card} data-testid="pem-card" data-type="private-key">
          <div className={styles.head}>
            <span className={styles.type}>Private key ({block.format})</span>
            <span className={styles.title}>{block.key}</span>
          </div>
          <span className={ui.muted}>Key material is only shown in the Raw tab.</span>
        </div>
      );
    case 'unknown':
      return (
        <div className={styles.card} data-testid="pem-card" data-type="unknown">
          <div className={styles.head}>
            <span className={styles.type}>{block.label}</span>
          </div>
          <span className={ui.muted}>{block.error}</span>
        </div>
      );
  }
}

/** One card per PEM block; certificates in chain order with an expiry badge. */
export function PemView({ handle }: { handle: ValueHandle }) {
  const data = useAsync(handle.summary.label, async () => ({
    ...pemSchema.parse(await handle.json()),
    now: Date.now(),
  }));
  if (data.status === 'loading') return <div className={ui.empty}>Loading…</div>;
  if (data.status === 'error') return <div className={ui.empty}>{data.error}</div>;
  return (
    <div className={styles.wrap} data-testid="pem-view">
      {data.value.blocks.map((b, i) => (
        <BlockCard key={i} block={b} index={i} now={data.value.now} />
      ))}
    </div>
  );
}
