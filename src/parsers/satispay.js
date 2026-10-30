// Parser per la "Lista Transazioni" di Satispay (Esporta report dall'app).
// Colonne: Data | Transazione | Importo | Tipo | Disponibilità | Disponibilità dopo la transazione | ID
// Ogni movimento: riga con data e importi, poi ora, seguito della descrizione e stato (Approvato / In corso / Annullato).
// Gli importi in entrata non hanno segno ("100,00 €"), quelli in uscita sì ("-3,00 €").

import { parseDate, parseAmount, cleanSpaces, round2, findIban, DATE_RE } from './common.js';
import { parseGeneric } from './generic.js';

export const id = 'satispay';
export const label = 'Satispay';

export function detect(lines) {
  // solo nell'intestazione/piè di pagina: negli estratti di altre banche "Satispay" compare come esercente
  const own = lines.some((l) => /Satispay Europe S\.A\./.test(l.text) && /^Satispay Europe/.test(l.cells[0].text)) ||
    lines.slice(0, 15).some((l) => /satispay/i.test(l.text));
  return own && !lines.slice(0, 40).some((l) => /Revolut|N26|BBVA/i.test(l.text));
}

// "Tipo" -> nota leggibile e beneficiario per i movimenti senza esercente
const TYPES = {
  'Verso la Banca': 'Verso il conto bancario',
  'Dalla Banca': 'Ricarica Satispay',
};

export function parse(lines) {
  const header = lines.find((l) => l.cells.some((c) => c.text === 'Transazione') && l.cells.some((c) => c.text === 'Tipo'));
  if (!header) {
    return { holder: null, transactions: parseGeneric(lines, { noise: /^(pagina|page|id transazione|codice)\b|Satispay Europe/i }) };
  }
  const x = (name) => header.cells.find((c) => c.text.startsWith(name))?.x;
  const col = { text: x('Transazione'), amount: x('Importo'), type: x('Tipo'), avail: x('Disponibilità'), id: x('ID') };
  const availAfterX = header.cells.filter((c) => c.text.startsWith('Disponibilità'))[1]?.x;
  const near = (c, cx) => cx != null && Math.abs(c.x - cx) < 15;

  const rows = [];
  let cur = null;
  for (const l of lines) {
    if (/^(Satispay Europe|Legenda)/.test(l.cells[0].text)) { cur = null; if (/^Legenda/.test(l.cells[0].text)) break; continue; }
    const first = l.cells[0];
    const amountCell = l.cells.find((c) => near(c, col.amount) && parseAmount(c.text));
    if (DATE_RE.test(first.text) && parseDate(first.text) && amountCell) {
      cur = {
        date: parseDate(first.text),
        amount: parseAmount(amountCell.text).value,
        text: [], type: [], status: null,
        balanceAfter: parseAmount(l.cells.find((c) => near(c, availAfterX))?.text || '')?.value,
      };
      rows.push(cur);
      for (const c of l.cells) {
        if (near(c, col.text)) cur.text.push(c.text);
        else if (near(c, col.type)) cur.type.push(c.text);
      }
      continue;
    }
    if (!cur) continue;
    for (const c of l.cells) {
      if (/^(Approvato|In corso|Annullato)$/.test(c.text)) cur.status = c.text;
      else if (near(c, col.type)) cur.type.push(c.text);
      else if (near(c, col.text) && !/^\d{1,2}:\d{2}$/.test(c.text)) cur.text.push(c.text);
    }
  }

  const holder = lines.find((l) => l.page === 1 && l.cells.length === 1 && l.cells[0].x > 400 && /^[A-ZÀ-Ý][a-zà-ÿ]+( [A-ZÀ-Ý][a-zà-ÿ']+)+$/.test(l.text))?.text || null;
  const iban = lines.slice(0, 10).map((l) => findIban(l.text)).find(Boolean) || null;

  const transactions = [];
  for (const r of rows) {
    if (r.status === 'Annullato') continue;
    const type = cleanSpaces(r.type.join(' '));
    let text = cleanSpaces(r.text.join(' ')).replace(/\s+Verso$/, '');
    const masked = text.match(/\(?((?:[A-Z]{2})?\*+\d{3,4})\)?/);
    const payee = TYPES[type] || text.replace(/^Da\s+\(.*\)$/, '').trim() || type;
    const note = [type, payee !== text ? text : ''].filter(Boolean).join(' · ');
    transactions.push({
      date: r.date,
      amount: round2(r.amount),
      currency: 'EUR',
      payee,
      note,
      pending: r.status === 'In corso' || undefined,
      counterIban: masked ? masked[1].replace(/^\(|\)$/g, '') : undefined,
    });
  }

  // controllo: la disponibilità dopo ogni movimento deve tornare con quella del movimento precedente
  const booked = rows.filter((r) => r.status !== 'Annullato').slice().reverse(); // dal più vecchio
  const warnings = [];
  for (let i = 1; i < booked.length; i++) {
    const prev = booked[i - 1].balanceAfter;
    const now = booked[i].balanceAfter;
    if (prev != null && now != null && Math.abs(round2(prev + booked[i].amount) - now) > 0.005) {
      warnings.push(`${booked[i].date}: disponibilità attesa ${round2(prev + booked[i].amount).toFixed(2)}, nel PDF ${now.toFixed(2)}`);
    }
  }
  const last = booked[booked.length - 1];
  const generated = lines.find((l) => /^Generato il/i.test(l.cells[0].text))?.cells[0].text.match(/(\d{1,2} \w+ \d{4})/);
  const balance = last?.balanceAfter != null
    ? { date: generated ? parseDate(generated[1]) : last.date, booked: last.balanceAfter, pending: 0, available: last.balanceAfter, warnings }
    : null;
  return { holder, iban, transactions, balance };
}
