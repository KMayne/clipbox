/**
 * HTML entity encoding and decoding: the HTML 4 named set (Latin-1, Greek, symbols, punctuation)
 * plus `&apos;`, and numeric references. Rarer HTML5-only names are left as they are.
 */

// U+00A0 to U+00FF, in order
const LATIN1 =
  'nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn ' +
  'sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave ' +
  'Aacute Acirc Atilde Auml Aring AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ' +
  'ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN ' +
  'szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute ' +
  'icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml ' +
  'yacute thorn yuml';

// U+0391 to U+03C9; U+03A2 is unassigned
const GREEK =
  'Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho - ' +
  'Sigma Tau Upsilon Phi Chi Psi Omega - - - - - - - alpha beta gamma delta epsilon zeta eta ' +
  'theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau upsilon phi chi psi omega';

const OTHERS =
  'quot 34 amp 38 apos 39 lt 60 gt 62 OElig 338 oelig 339 Scaron 352 scaron 353 Yuml 376 ' +
  'fnof 402 circ 710 tilde 732 thetasym 977 upsih 978 piv 982 ensp 8194 emsp 8195 thinsp 8201 ' +
  'zwnj 8204 zwj 8205 lrm 8206 rlm 8207 ndash 8211 mdash 8212 lsquo 8216 rsquo 8217 ' +
  'sbquo 8218 ldquo 8220 rdquo 8221 bdquo 8222 dagger 8224 Dagger 8225 bull 8226 ' +
  'hellip 8230 permil 8240 prime 8242 Prime 8243 lsaquo 8249 rsaquo 8250 oline 8254 ' +
  'frasl 8260 euro 8364 image 8465 weierp 8472 real 8476 trade 8482 alefsym 8501 larr 8592 ' +
  'uarr 8593 rarr 8594 darr 8595 harr 8596 crarr 8629 lArr 8656 uArr 8657 rArr 8658 dArr 8659 ' +
  'hArr 8660 forall 8704 part 8706 exist 8707 empty 8709 nabla 8711 isin 8712 notin 8713 ' +
  'ni 8715 prod 8719 sum 8721 minus 8722 lowast 8727 radic 8730 prop 8733 infin 8734 ang 8736 ' +
  'and 8743 or 8744 cap 8745 cup 8746 int 8747 there4 8756 sim 8764 cong 8773 asymp 8776 ' +
  'ne 8800 equiv 8801 le 8804 ge 8805 sub 8834 sup 8835 nsub 8836 sube 8838 supe 8839 ' +
  'oplus 8853 otimes 8855 perp 8869 sdot 8901 lceil 8968 rceil 8969 lfloor 8970 rfloor 8971 ' +
  'lang 10216 rang 10217 loz 9674 spades 9824 clubs 9827 hearts 9829 diams 9830';

let table: Map<string, number> | null = null;

function entities(): Map<string, number> {
  if (table) return table;
  const map = new Map<string, number>();
  LATIN1.split(' ').forEach((name, i) => map.set(name, 0xa0 + i));
  GREEK.split(' ').forEach((name, i) => name !== '-' && map.set(name, 0x391 + i));
  const others = OTHERS.split(' ');
  for (let i = 0; i < others.length; i += 2) {
    const name = others[i];
    if (name) map.set(name, Number(others[i + 1]));
  }
  table = map;
  return map;
}

const BASIC: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escapes `& < > " '`; with `nonAscii`, every non-ASCII character as `&#N;` too. */
export function encodeEntities(text: string, nonAscii = false): string {
  const pattern = nonAscii ? /[&<>"']|[^\x00-\x7f]/gu : /[&<>"']/g; // eslint-disable-line no-control-regex
  return text.replace(pattern, ch => BASIC[ch] ?? `&#${ch.codePointAt(0) ?? 0};`);
}

/** Decodes named (known ones) and numeric (`&#N;`, `&#xH;`) references; unknown ones stay. */
export function decodeEntities(text: string): string {
  return text.replace(/&(#[xX][0-9a-fA-F]+|#\d+|[A-Za-z][A-Za-z0-9]*);/g, (whole, ref: string) => {
    if (ref.startsWith('#')) {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const code = parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '\uFFFD';
      return String.fromCodePoint(code);
    }
    const code = entities().get(ref);
    return code === undefined ? whole : String.fromCodePoint(code);
  });
}
