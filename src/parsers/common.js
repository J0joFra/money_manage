// Utility condivise dai parser degli estratti conto.

const MONTHS = {
  gen: 1, feb: 2, mar: 3, apr: 4, mag: 5, giu: 6, lug: 7, ago: 8, set: 9, ott: 10, nov: 11, dic: 12,
  jan: 1, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, dec: 12,
  ene: 1, abr: 4, sept: 9,
  gennaio: 1, febbraio: 2, marzo: 3, aprile: 4, maggio: 5, giugno: 6, luglio: 7, agosto: 8,
  settembre: 9, ottobre: 10, novembre: 11, dicembre: 12,
};

const pad = (n) => String(n).padStart(2, '0');

// Riconosce: "3 ott 2026", "03 ottobre 2026", "03/10/2026", "03.10.2026", "03-10-2026", "2026-10-03", "03/10/26"
export const DATE_RE =
  /^(\d{1,2}\s+[A-Za-zàé]{3,9}\.?\s+\d{4}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})$/;

export function parseDate(s) {
  if (!s) return null;
  s = s.trim().toLowerCase();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${pad(m[2])}-${pad(m[1])}`;
  }
  m = s.match(/^(\d{1,2})\s+([a-zàé]+)\.?\s+(\d{4})$/);
  if (m) {
    const mon = MONTHS[m[2]] || MONTHS[m[2].slice(0, 3)];
    if (mon) return `${m[3]}-${pad(mon)}-${pad(m[1])}`;
  }
  return null;
}

// Importi: "1.259,42€", "-12,50 €", "+100,00€", "€ 3,00", "34.20€", "1,234.56", "12,00-"
export const AMOUNT_RE = /^[+\-−]?\s*(?:€|EUR|\$|£)?\s*[+\-−]?\d{1,3}(?:[.,'\s]?\d{3})*(?:[.,]\d{2})\s*(?:€|EUR|\$|£)?-?$/;

export function parseAmount(s) {
  if (s == null) return null;
  let t = String(s).replace(/−/g, '-').replace(/\s/g, '');
  if (!AMOUNT_RE.test(String(s).replace(/−/g, '-').trim())) return null;
  let sign = 1;
  if (/^-|^[€$£]-|^EUR-|-$/.test(t)) sign = -1;
  const explicit = /^[+\-]|^[€$£]?[+\-]|-$/.test(t);
  t = t.replace(/[^\d.,]/g, '');
  // il separatore decimale è l'ultimo tra . e , seguito da 2 cifre
  const dec = t.match(/[.,](\d{2})$/);
  const intPart = dec ? t.slice(0, -3) : t;
  const value = Number(intPart.replace(/[.,]/g, '') + (dec ? '.' + dec[1] : ''));
  if (Number.isNaN(value)) return null;
  return { value: sign * value, explicit };
}

export function currencyOf(s) {
  if (/\$/.test(s)) return 'USD';
  if (/£/.test(s)) return 'GBP';
  const m = s.match(/\b(EUR|USD|GBP|CHF)\b/);
  if (m) return m[1];
  return 'EUR';
}

export const round2 = (n) => Math.round(n * 100) / 100;

export function cleanSpaces(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

// Trova la colonna d'intestazione più vicina a una cella, considerando
// allineamento a sinistra, a destra e centrato.
export function nearestColumn(columns, cell) {
  let best = null;
  for (const c of columns) {
    const d = Math.min(Math.abs(c.x - cell.x), Math.abs(c.end - cell.end), Math.abs((c.x + c.end) / 2 - (cell.x + cell.end) / 2));
    if (!best || d < best.d) best = { ...c, d };
  }
  return best;
}

// IBAN (anche scritto a gruppi "IT70 O035 7601 ...") -> forma compatta, oppure null
export const IBAN_IN_TEXT = /\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/;
export function findIban(text) {
  const m = (text || '').match(IBAN_IN_TEXT);
  if (!m) return null;
  const iban = m[1].replace(/\s/g, '');
  return iban.length >= 15 && /\d/.test(iban.slice(4)) ? iban : null;
}
