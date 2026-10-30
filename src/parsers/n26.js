// Parser per gli estratti conto PDF di N26.
// Layout tipico: "Descrizione | Data di registrazione | Importo" con importi firmati (-12,50€ / +100,00€),
// sotto ogni movimento righe come "Mastercard • Ristoranti", "IBAN: ...", "Data valuta 01.10.2026".
// NB: scritto senza un estratto conto di esempio: se qualcosa non torna usa "Mostra testo estratto".

import { parseGeneric } from './generic.js';
import { parseAmount, parseDate, round2, findIban } from './common.js';

export const id = 'n26';
export const label = 'N26';

export function detect(lines) {
  // BIC di N26 Italia (NTSBITM1) o firma "Il tuo Team N26"; il nome può non comparire nell'intestazione
  return lines.some((l) => /NTSBITM|Team N26|N26 Bank|n26\.com/i.test(l.text));
}

export function parse(lines) {
  const transactions = parseGeneric(lines, {
    noise: /^(data valuta|value date|valuta|pagina|page|bic)\b|^\d+\s*(\/|di|of)\s*\d+$|N26 Bank|Estratto conto|Data di emissione|Emesso in data|^Entrate$|^Uscite$/i,
    // "Mastercard • Ristoranti" -> "Ristoranti"; l'IBAN della controparte viene tolto dalla nota e salvato a parte
    cleanPart: (p) => p.replace(/^(Mastercard|Maestro|Visa)\s*•\s*/i, '').replace(/^(IBAN:\s*[A-Z0-9]+)(\s*•\s*BIC:?\s*[A-Z0-9]+)?/i, '$1').trim(),
  });
  for (const t of transactions) {
    const iban = findIban(t.note);
    if (!iban) continue;
    t.counterIban = iban;
    t.note = t.note.replace(/\s*·?\s*IBAN:\s*[A-Z0-9]+/i, '').replace(/^ · /, '').trim() || t.payee;
  }
  // intestatario: riga del piè di pagina "NOME COGNOME   Emesso in data"
  const holder = lines.find((l) => l.cells.length > 1 && /Emesso in data/i.test(l.cells[1].text))?.cells[0].text || null;
  const saldo = lines.find((l) => /nuovo saldo/i.test(l.text));
  const prev = lines.find((l) => /saldo precedente/i.test(l.text));
  const amountOf = (l) => l && parseAmount(l.cells[l.cells.length - 1].text)?.value;
  const period = lines.find((l) => /fino al/i.test(l.text))?.text.match(/fino al (\d{2}\.\d{2}\.\d{4})/);
  let balance = null;
  if (saldo && amountOf(saldo) != null) {
    const closing = amountOf(saldo);
    const sum = round2(transactions.reduce((s, t) => s + t.amount, 0));
    const warnings = prev && Math.abs(round2(amountOf(prev) + sum) - closing) > 0.005
      ? [`saldo precedente ${amountOf(prev).toFixed(2)} + movimenti ${sum.toFixed(2)} ≠ nuovo saldo ${closing.toFixed(2)}`] : [];
    balance = { date: period ? parseDate(period[1]) : null, booked: closing, pending: 0, available: closing, warnings };
  }
  // IBAN del conto: piè di pagina "IBAN: IT.. • BIC: NTSB..."
  const iban = findIban(lines.find((l) => /IBAN:.*NTSB/i.test(l.text))?.text);
  return { holder, iban, transactions, balance };
}
