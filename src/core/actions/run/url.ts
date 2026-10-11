import { urlInterpreter, type ParsedUrl } from '../../interpreters/url';
import { urlDecode, urlEncode, urlOpen, urlQueryJson, urlStripTracking } from '../catalog/url';
import { implement, implementEffect } from '../types';
import { textResult } from './util';

const value = urlInterpreter.isValue;

const safeDecode = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/**
 * Click and campaign trackers. Exact names, or prefixes ending in `*`. Matching ignores case.
 * Sources: the utm convention, ad platforms' click ids, and email/social share trackers.
 */
export const TRACKING_PARAMS = [
  'utm_*', // Google Analytics campaign tags (utm_source, utm_medium, …)
  'fbclid', // Facebook
  'gclid', // Google Ads
  'gclsrc',
  'dclid', // Google Display (DoubleClick)
  'gbraid', // Google Ads (iOS)
  'wbraid',
  'msclkid', // Microsoft Ads
  'yclid', // Yandex
  'twclid', // X/Twitter
  'ttclid', // TikTok
  'li_fat_id', // LinkedIn
  'igshid', // Instagram
  'igsh',
  'mc_eid', // Mailchimp
  'mc_cid',
  '_hsenc', // HubSpot
  '_hsmi',
  '__hstc',
  '__hssc',
  '__hsfp',
  'hsctatracking',
  'mkt_tok', // Marketo
  'oly_anon_id', // Omeda
  'oly_enc_id',
  'vero_id', // Vero
  'vero_conv',
  'rb_clickid', // Rakuten
  's_cid', // Adobe
  'ref_src', // X/Twitter embeds
  'ref_url',
  '_ga', // Google cross-domain linker
  '_gl',
  'srsltid', // Google Merchant
  'epik', // Pinterest
  'wickedid',
];

/** Params that only track on some hosts (elsewhere the same name can be meaningful). */
const HOST_TRACKING: { hosts: RegExp; params: string[] }[] = [
  // YouTube and Spotify share links: ?si=…
  { hosts: /(^|\.)(youtube\.com|youtu\.be|spotify\.com|spotify\.link)$/i, params: ['si'] },
];

/** Matcher for exact names and `prefix*` patterns, case-insensitive. */
function matcher(patterns: string[]): (name: string) => boolean {
  const exact = new Set<string>();
  const prefixes: string[] = [];
  for (const p of patterns.map(s => s.trim().toLowerCase()).filter(Boolean)) {
    if (p.endsWith('*')) prefixes.push(p.slice(0, -1));
    else exact.add(p);
  }
  return name => {
    const n = name.toLowerCase();
    return exact.has(n) || prefixes.some(p => n.startsWith(p));
  };
}

/**
 * The URL without tracking params. The other params keep their original encoding and order;
 * an emptied query loses its `?`.
 */
export function stripTracking(href: string, extra: string[] = []): string {
  const u = new URL(href);
  const isTracker = matcher([
    ...TRACKING_PARAMS,
    ...HOST_TRACKING.filter(h => h.hosts.test(u.hostname)).flatMap(h => h.params),
    ...extra,
  ]);
  const query = u.search.replace(/^\?/, '');
  if (!query) return u.href;
  const kept = query.split('&').filter(pair => {
    if (pair === '') return false;
    const name = safeDecode((pair.split('=')[0] ?? '').replace(/\+/g, ' '));
    return !isTracker(name);
  });
  const hashIndex = u.href.indexOf('#');
  const hash = hashIndex >= 0 ? u.href.slice(hashIndex) : '';
  const base = u.href.slice(0, u.href.length - hash.length - u.search.length);
  return `${base}${kept.length ? `?${kept.join('&')}` : ''}${hash}`;
}

/** Query params as an object; a repeated key becomes an array of its values. */
export function queryObject(u: ParsedUrl): Record<string, string | string[]> {
  const grouped = new Map<string, string[]>();
  for (const [k, v] of u.query) grouped.set(k, [...(grouped.get(k) ?? []), v]);
  // fromEntries defines own properties, so a "__proto__" param is just a key
  return Object.fromEntries(
    [...grouped].map(([k, vs]) => [k, vs.length === 1 ? (vs[0] ?? '') : vs]),
  );
}

const lines = (xs: string[]) => textResult(`${xs.join('\n')}\n`);

const isWeb = (u: ParsedUrl) => u.scheme === 'http' || u.scheme === 'https';

export const urlImpls = [
  implement(urlDecode, {
    value,
    run: ({ value }) => lines(value.urls.map(u => safeDecode(u.href))),
  }),
  implement(urlEncode, {
    value,
    run: ({ value }) => lines(value.urls.map(u => encodeURIComponent(u.href))),
  }),
  implement(urlQueryJson, {
    value,
    applies: ({ value }) => value.urls.some(u => u.query.length > 0),
    run({ value }) {
      const [only] = value.urls;
      const json =
        value.urls.length === 1 && only
          ? queryObject(only)
          : value.urls.map(u => ({ url: u.href, query: queryObject(u) }));
      return textResult(`${JSON.stringify(json, null, 2)}\n`, 'application/json');
    },
  }),
  implement(urlStripTracking, {
    value,
    run({ value }, { extra }) {
      const more = extra.split(/[\s,]+/).filter(Boolean);
      return lines(value.urls.map(u => stripTracking(u.href, more)));
    },
  }),
  implementEffect(urlOpen, {
    value,
    // One tab per click: browsers block the rest as popups
    applies: ({ value }) => value.urls.length === 1 && value.urls.every(isWeb),
    run({ value }) {
      const [u] = value.urls;
      if (!u || !isWeb(u)) throw new Error('Only http and https URLs can be opened');
      return { effect: 'open-url', url: u.href };
    },
  }),
];
