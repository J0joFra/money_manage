// Parser per gli estratti conto PDF di Revolut (versione italiana).
// Struttura: sezioni "In sospeso", "Transazioni del conto", "Transazioni stornate";
// ogni movimento ha una riga con data/descrizione/importi e righe di dettaglio
// ("A: ...", "Da: ...", "Riferimento: ...", "ID transazione: ...", "Carta: ...").

import { DATE_RE, parseDate, parseAmount, nearestColumn, cleanSpaces, round2 } from './common.js';

export const id = 'revolut';
export const label = 'Revolut';

export function detect(lines) {
  return lines.slice(0, 40).some((l) => /Revolut Bank|revolut\.com/i.test(l.text));
}

const PAYEE_PREFIXES = [/^Pagamento a favore di\s+/i, /^Pagamento da parte di\s+/i, /^Pagamento da\s+/i, /^To\s+/, /^From\s+/, /^Trasferimento (a|da)\s+/i];

function cleanPayee(desc) {
  let p = desc;
  for (const re of PAYEE_PREFIXES) p = p.replace(re, '');
  return cleanSpaces(p);
}

function cleanCounterparty(s) {
  // "Paypal *paga In 3 Rate" -> "Paypal paga In 3 Rate"; "Aspit Milano Sud -, Fi" -> "Aspit Milano Sud, Fi"
  return cleanSpaces(s.replace(/\*/g, ' ').replace(/\s+-\s*,/g, ',').replace(/_/g, ' ')).replace(/\s+,/g, ',');
}

export function parse(lines) {
  const holder = lines.find((l) => l.page === 1 && /^[A-ZÀ-Ý' ]{4,}$/.test(l.text) && !/^EUR|IBAN|BIC/.test(l.text));
  const txs = [];
  let currency = 'EUR';
  let section = null; // 'pending' | 'booked' | 'reversed' | null
  let columns = [];
  let current = null;

  const flush = () => {
    if (current && section !== 'reversed' && current.amount != null) txs.push(finalize(current, currency));
    current = null;
  };

  for (const line of lines) {
    const t = line.text;
    const cur = t.match(/Estratto conto in ([A-Z]{3})/);
    if (cur) currency = cur[1];

    if (/^In sospeso da/i.test(t)) { flush(); section = 'pending'; continue; }
    if (/^Transazioni (del conto|di deposito)/i.test(t)) { flush(); section = 'booked'; continue; }
    if (/^Transazioni stornate/i.test(t)) { flush(); section = 'reversed'; continue; }
    if (/^(Attenzione|Riepilogo del saldo|Altre informazioni)/i.test(t)) { flush(); section = null; continue; }

    // intestazione colonne
    if (/Denaro in uscita/.test(t) && /Denaro in entrata/.test(t)) {
      flush();
      columns = line.cells
        .map((c) => ({ x: c.x, end: c.end, kind: /uscita/i.test(c.text) ? 'out' : /entrata/i.test(c.text) ? 'in' : /^Saldo$/i.test(c.text) ? 'balance' : null }))
        .filter((c) => c.kind);
      continue;
    }
    if (!section) continue;

    const first = line.cells[0];
    if (DATE_RE.test(first.text) && parseDate(first.text)) {
      flush();
      current = { date: parseDate(first.text), desc: '', amount: null, details: [], pending: section === 'pending' };
      for (const cell of line.cells.slice(1)) {
        const amt = parseAmount(cell.text);
        if (amt) {
          const col = nearestColumn(columns, cell);
          if (!col || col.kind === 'balance') continue;
          if (current.amount == null) current.amount = col.kind === 'out' ? -Math.abs(amt.value) : Math.abs(amt.value);
        } else if (!current.desc) {
          current.desc = cell.text;
        }
      }
      continue;
    }

    if (current) {
      const m = t.match(/^(A|Da|Riferimento|ID transazione|Carta):\s*(.*)$/);
      if (m) current.details.push({ key: m[1], value: m[2].trim() });
    }
  }
  flush();
  return { holder: holder ? cleanSpaces(holder.text) : null, transactions: txs };
}

function finalize(c, currency) {
  const get = (k) => c.details.find((d) => d.key === k)?.value;
  const ref = get('Riferimento');
  const counterparty = get('A') || get('Da');
  let note;
  if (ref) note = `Riferimento: ${ref}`;
  else if (counterparty) note = cleanCounterparty(counterparty.replace(/,\s*[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, ''));
  else note = c.desc;
  return {
    date: c.date,
    amount: round2(c.amount),
    currency,
    payee: cleanPayee(c.desc),
    note,
    pending: c.pending || undefined,
  };
}
