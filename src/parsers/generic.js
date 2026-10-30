// Parser generico "a tabella": funziona con la maggior parte degli estratti conto
// che hanno una riga per movimento con data + descrizione + importo.
// Il segno dell'importo viene preso, in ordine:
//   1. dal segno esplicito (-12,50 / +100,00)
//   2. dalla colonna in cui si trova (Uscite/Addebiti/Dare vs Entrate/Accrediti/Avere)
//   3. da parole chiave nella descrizione (accredito, ricevuto, rimborso...) altrimenti è una spesa

import { DATE_RE, parseDate, parseAmount, nearestColumn, cleanSpaces, round2, currencyOf } from './common.js';

export const id = 'generic';
export const label = 'Generico';

const COLUMN_KINDS = [
  ['balance', /^(saldo|balance|saldo contabile|saldo disponibile)\b/i],
  ['out', /uscit|addebit|^dare$|debit|^pagamenti$|money out|cargo/i],
  ['in', /entrat|accredit|^avere$|credit|money in|abono/i],
  ['amount', /^(importo|amount|importe|betrag)/i],
  ['valuta', /valuta|value date/i],
  ['date', /^data|^date|^fecha|^booking/i],
  ['desc', /descrizione|description|dettagli|causale|concetto|beneficiario|operazione/i],
];

const SUMMARY_LINE = /saldo (iniziale|finale|precedente|al|contabile|disponibile)|^totale|^total\b|riepilogo|opening balance|closing balance/i;
const DEFAULT_NOISE = /^(data valuta|value date|valuta|pagina|page)\b|^\d+\s*(\/|di|of)\s*\d+$|^(iban|bic|swift)\b/i;
const INCOME_HINT = /accredit|ricevut|rimborso|stipendio|bonifico (in entrata|a vostro favore|ricevuto)|da parte di|incoming|refund|cashback|ricarica ricevuta/i;

const kindOf = (text) => COLUMN_KINDS.find(([, re]) => re.test(text))?.[0];

// Divide una cella in parole stimando la x di ciascuna in proporzione ai caratteri
function words(cell) {
  const out = [];
  for (const p of cell.parts || [cell]) {
    const perChar = (p.end - p.x) / Math.max(p.text.length, 1);
    let pos = 0;
    for (const w of p.text.split(' ')) {
      if (w) out.push({ text: w, x: p.x + pos * perChar, end: p.x + (pos + w.length) * perChar });
      pos += w.length + 1;
    }
  }
  return out;
}


function headerColumns(line) {
  if (line.cells.some((c) => parseAmount(c.text) || DATE_RE.test(c.text))) return null;
  const cols = [];
  for (const c of line.cells) {
    // intestazioni vicine possono finire nella stessa cella ("Uscite Entrate"): in quel caso dividi in parole
    const ws = words(c);
    const units = new Set(ws.map((w) => kindOf(w.text)).filter(Boolean)).size > 1 ? ws : [c];
    for (const u of units) {
      const kind = kindOf(u.text);
      if (kind) cols.push({ x: u.x, end: u.end, kind, label: u.text });
    }
  }
  return cols.length >= 2 && cols.some((c) => ['out', 'in', 'amount'].includes(c.kind)) ? cols : null;
}

export function parseGeneric(lines, opts = {}) {
  const noise = opts.noise || DEFAULT_NOISE;
  const maxDetails = opts.maxDetails ?? 3;
  const txs = [];
  let columns = [];
  let current = null;

  const flush = () => {
    if (current) {
      const t = finalize(current, opts);
      if (t) txs.push(t);
    }
    current = null;
  };

  // intestazioni/piè di pagina: righe identiche ripetute su più pagine (nome, indirizzo, IBAN...)
  const pagesByText = new Map();
  for (const l of lines) pagesByText.set(l.text, (pagesByText.get(l.text) || new Set()).add(l.page));
  const repeated = (l) => pagesByText.get(l.text).size > 1;

  for (const line of lines) {
    if (opts.skipLine && opts.skipLine(line)) continue;
    if (repeated(line) && !line.cells.some((c) => parseAmount(c.text))) continue;
    const hdr = headerColumns(line);
    if (hdr) { flush(); columns = hdr; continue; }

    const dateCells = line.cells.filter((c) => DATE_RE.test(c.text) && parseDate(c.text));
    const amountCells = line.cells.filter((c) => !DATE_RE.test(c.text) && parseAmount(c.text));

    if (dateCells.length && amountCells.length && !SUMMARY_LINE.test(line.text)) {
      flush();
      // l'importo del movimento è il primo che non cade nella colonna "saldo"
      let amount = null;
      let currency = 'EUR';
      for (const c of amountCells) {
        const col = columns.length ? nearestColumn(columns, c) : null;
        if (col && col.kind === 'balance' && amountCells.length > 1) continue;
        const a = parseAmount(c.text);
        currency = currencyOf(c.text);
        if (a.explicit) amount = a.value;
        else if (col && col.kind === 'out') amount = -Math.abs(a.value);
        else if (col && col.kind === 'in') amount = Math.abs(a.value);
        else amount = { unsigned: a.value };
        break;
      }
      if (amount == null) continue;
      const textCells = line.cells.filter((c) => !dateCells.includes(c) && !amountCells.includes(c));
      const desc = textCells[0];
      const rightOfDesc = desc && [...line.cells, ...columns].filter((c) => c.x > desc.end).map((c) => c.x);
      current = {
        date: parseDate(dateCells[0].text),
        page: line.page,
        amount,
        currency,
        texts: textCells.map((c) => c.text),
        details: [],
        desc: desc && { x: desc.x, room: rightOfDesc.length ? Math.min(...rightOfDesc) - desc.end : Infinity },
      };
      continue;
    }

    // i dettagli di un movimento non continuano sulla pagina successiva
    if (current && line.page === current.page && current.details.length < maxDetails && !amountCells.length && !dateCells.length) {
      const t = cleanSpaces(line.text);
      if (!t || noise.test(t) || SUMMARY_LINE.test(t) || t.length >= 140) continue;
      // descrizione andata a capo: stessa colonna e la riga sopra arrivava quasi al bordo della colonna successiva
      const c0 = line.cells[0];
      const firstWord = words(c0)[0];
      if (!current.details.length && current.desc && Math.abs(c0.x - current.desc.x) < 3 &&
          current.desc.room < (firstWord.end - firstWord.x) + 60) {
        current.texts[0] += ' ' + c0.text;
        if (line.cells.length > 1) current.details.push(line.cells.slice(1).map((c) => c.text).join(' '));
        current.desc = null;
      } else {
        current.details.push(t);
      }
    }
  }
  flush();
  return txs;
}

function finalize(c, opts) {
  let parts = [...c.texts, ...c.details].map(cleanSpaces).filter(Boolean);
  if (opts.cleanPart) parts = parts.map(opts.cleanPart).filter(Boolean);
  if (!parts.length) parts = ['(senza descrizione)'];
  let amount = c.amount;
  if (typeof amount === 'object') {
    amount = INCOME_HINT.test(parts.join(' ')) ? Math.abs(amount.unsigned) : -Math.abs(amount.unsigned);
  }
  const [payee, ...rest] = parts;
  return {
    date: c.date,
    amount: round2(amount),
    currency: c.currency,
    payee: cleanPayee(payee),
    note: rest.join(' · ') || payee,
  };
}

const PAYEE_PREFIXES = /^(bonifico|giroconto|pagamento|addebito|accredito)( sepa)?( (ricevuto|disposto|in entrata|in uscita|istantaneo|a vostro favore|a favore|con carta|carta|pos))?( (da|di|a|presso|verso))?\s+/i;

function cleanPayee(p) {
  const cleaned = p.replace(PAYEE_PREFIXES, '').trim();
  return cleaned || p;
}

export function detect() {
  return true;
}

export function parse(lines) {
  return { holder: null, transactions: parseGeneric(lines) };
}
