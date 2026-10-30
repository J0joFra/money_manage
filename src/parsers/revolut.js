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
  let closing = null;
  let opening = null;
  const booked = []; // [importo, saldo dopo il movimento] per il controllo di coerenza
  let periodEnd = null;

  const flush = () => {
    if (current && (section === 'booked' || section === 'pending') && current.amount != null) {
      txs.push(...finalize(current, currency));
      if (section === 'booked' && currency === 'EUR') booked.push(current);
    }
    current = null;
  };

  for (const line of lines) {
    const t = line.text;
    const cur = t.match(/Estratto conto in ([A-Z]{3})/);
    if (cur) currency = cur[1];

    const end = t.match(/\bal giorno (\d{1,2} \w+ \d{4})/) || t.match(/^In sospeso da .* a (\d{1,2} \w+ \d{4})/);
    if (end && !periodEnd) periodEnd = parseDate(end[1]);
    if (/^In sospeso da/i.test(t)) { flush(); section = 'pending'; continue; }
    if (/^Transazioni (del conto|di deposito)/i.test(t)) { flush(); section = 'booked'; continue; }
    if (/^Transazioni stornate/i.test(t)) { flush(); section = 'reversed'; continue; }
    // il conto deposito ha una sezione a parte con gli stessi movimenti già visti sul conto: non duplicarli
    if (/^Transazioni (deposito|del deposito|salvadanaio)/i.test(t)) { flush(); section = 'deposit'; continue; }
    // saldo di chiusura del conto corrente (riepilogo dell'estratto in EUR)
    if (/^Conto \(conto corrente\)/.test(t) && closing == null && currency === 'EUR') {
      const amounts = line.cells.map((c) => parseAmount(c.text)).filter(Boolean);
      if (amounts.length >= 4) { opening = amounts[0].value; closing = amounts[amounts.length - 1].value; }
    }
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
          if (!col) continue;
          if (col.kind === 'balance') { current.balance = amt.value; continue; }
          if (current.amount == null) current.amount = col.kind === 'out' ? -Math.abs(amt.value) : Math.abs(amt.value);
        } else if (!current.desc) {
          current.desc = cell.text;
        }
      }
      continue;
    }

    if (current) {
      const m = t.match(/^(A|Da|Riferimento|ID transazione|Carta|Costo):\s*(.*?)(\s{2,}.*)?$/);
      if (m) current.details.push({ key: m[1], value: m[2].trim() });
    }
  }
  flush();
  return {
    holder: holder ? cleanSpaces(holder.text) : null,
    transactions: txs,
    balance: closing == null ? null : statementBalance(opening, closing, booked, txs, periodEnd),
  };
}

// Verifica che ogni movimento contabilizzato porti al saldo indicato nel PDF e calcola il saldo disponibile
// (contabile + movimenti in sospeso), che è quello mostrato dall'app Revolut.
function statementBalance(opening, closing, booked, txs, date) {
  const warnings = [];
  let running = opening ?? 0;
  for (const b of booked) {
    running = round2(running + b.amount);
    if (b.balance != null && Math.abs(b.balance - running) > 0.005) {
      warnings.push(`${b.date} ${b.desc}: saldo atteso ${running.toFixed(2)}, nel PDF ${b.balance.toFixed(2)}`);
      running = b.balance;
    }
  }
  if (Math.abs(running - closing) > 0.005) warnings.push(`saldo finale calcolato ${running.toFixed(2)} ≠ ${closing.toFixed(2)} del PDF`);
  const pending = round2(txs.filter((t) => t.pending && t.currency === 'EUR').reduce((s, t) => s + t.amount, 0));
  return { date, booked: closing, pending, available: round2(closing + pending), warnings };
}

function finalize(c, currency) {
  const get = (k) => c.details.find((d) => d.key === k)?.value;
  const ref = get('Riferimento');
  const counterparty = get('A') || get('Da');
  let note;
  if (ref) note = `Riferimento: ${ref}`;
  else if (counterparty) note = cleanCounterparty(counterparty.replace(/,\s*[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/, ''));
  else note = c.desc;
  const tx = {
    date: c.date,
    amount: round2(c.amount),
    currency,
    payee: cleanPayee(c.desc),
    note,
    pending: c.pending || undefined,
  };
  // "Costo: 0,62€" (es. conversioni di valuta): l'importo in tabella è già al netto della commissione.
  // La separo in un movimento a parte così la commissione risulta tra le spese.
  const fee = parseAmount(get('Costo') || '');
  if (!fee || !fee.value) return [tx];
  return [
    { ...tx, amount: round2(c.amount + Math.abs(fee.value)) },
    { ...tx, amount: -Math.abs(fee.value), payee: 'Commissione Revolut', note: `Costo: ${c.desc}` },
  ];
}
