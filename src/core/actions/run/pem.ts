// Only the module's light types: @peculiar/x509 stays in the module's chunks
import {
  isPemValueInfo,
  isX509ActionService,
  type PemValueInfo,
} from '../../../modules/x509/types';
import { decodeBase64 } from '../../base64';
import { pemDetails, pemFingerprint, pemPublicKey } from '../catalog/pem';
import { implement, type ActionContext } from '../types';
import { textResult } from './util';

const CERT = /-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g;

/** DER of each certificate block, in paste order. */
export function certificateDers(text: string): Uint8Array<ArrayBuffer>[] {
  return [...text.matchAll(CERT)].flatMap(([, body = '']) => {
    const der = decodeBase64(body.replace(/\s+/g, ''));
    return der ? [der] : [];
  });
}

/** Colon-separated uppercase hex, as browsers and openssl show fingerprints. */
export const colonHex = (bytes: ArrayBuffer) =>
  [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');

const hasCertificate = (v: PemValueInfo) => v.blocks.some(b => b.type === 'certificate');

async function service(ctx: ActionContext) {
  const s = await ctx.service('x509', isX509ActionService);
  if (!s) throw new Error("The X.509 module isn't available");
  return s;
}

export async function fingerprints(
  text: string,
  value: PemValueInfo,
  algorithm: 'SHA-256' | 'SHA-1' | 'both',
): Promise<string> {
  const ders = certificateDers(text);
  if (ders.length === 0) throw new Error('No certificates to fingerprint');
  const algs = algorithm === 'both' ? (['SHA-256', 'SHA-1'] as const) : [algorithm];
  const sections = await Promise.all(
    ders.map(async der => {
      const sha256 = colonHex(await crypto.subtle.digest('SHA-256', der));
      const lines = await Promise.all(
        algs.map(async a => ({
          alg: a,
          hex: a === 'SHA-256' ? sha256 : colonHex(await crypto.subtle.digest(a, der)),
        })),
      );
      const info = value.blocks.find(b => b.type === 'certificate' && b.sha256 === sha256);
      const subject = typeof info?.subject === 'string' ? info.subject : null;
      return { subject, lines };
    }),
  );
  const [only] = sections;
  // One certificate and one algorithm: just the fingerprint, ready to paste
  if (sections.length === 1 && only?.lines.length === 1) return `${only.lines[0]?.hex ?? ''}\n`;
  return `${sections
    .map((s, i) =>
      [
        s.subject ?? `Certificate ${i + 1}`,
        ...s.lines.map(l => `${l.alg.padEnd(8)} ${l.hex}`),
      ].join('\n'),
    )
    .join('\n\n')}\n`;
}

export const pemImpls = [
  implement(pemDetails, {
    value: isPemValueInfo,
    applies: ({ value }) => hasCertificate(value),
    async run({ content }, _params, ctx) {
      const details = await (await service(ctx)).certificateDetails(content.text ?? '');
      if (details.length === 0) throw new Error('No certificates found');
      const json = details.length === 1 ? details[0] : details;
      return textResult(`${JSON.stringify(json, null, 2)}\n`, 'application/json');
    },
  }),
  implement(pemFingerprint, {
    value: isPemValueInfo,
    applies: ({ value }) => hasCertificate(value),
    run: async ({ value, content }, { algorithm }) =>
      textResult(await fingerprints(content.text ?? '', value, algorithm)),
  }),
  implement(pemPublicKey, {
    value: isPemValueInfo,
    applies: ({ value }) =>
      value.blocks.some(b => ['certificate', 'csr', 'public-key'].includes(b.type)),
    async run({ content }, { all }, ctx) {
      const keys = await (await service(ctx)).publicKeys(content.text ?? '');
      const picked = all ? keys : keys.slice(0, 1);
      if (picked.length === 0) throw new Error('No public keys found');
      return textResult(`${picked.map(k => k.pem.trim()).join('\n')}\n`, 'application/x-pem-file');
    },
  }),
];
