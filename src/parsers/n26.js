// Parser per gli estratti conto PDF di N26.
// Layout tipico: "Descrizione | Data di registrazione | Importo" con importi firmati (-12,50€ / +100,00€),
// sotto ogni movimento righe come "Mastercard • Ristoranti", "IBAN: ...", "Data valuta 01.10.2026".
// NB: scritto senza un estratto conto di esempio: se qualcosa non torna usa "Mostra testo estratto".

import { parseGeneric } from './generic.js';

export const id = 'n26';
export const label = 'N26';

export function detect(lines) {
  // BIC di N26 Italia (NTSBITM1) o firma "Il tuo Team N26"; il nome può non comparire nell'intestazione
  return lines.some((l) => /NTSBITM|Team N26|N26 Bank|n26\.com/i.test(l.text));
}

export function parse(lines) {
  const transactions = parseGeneric(lines, {
    noise: /^(data valuta|value date|valuta|pagina|page|iban|bic)\b|^\d+\s*(\/|di|of)\s*\d+$|N26 Bank|Estratto conto|Data di emissione|Emesso in data|^Entrate$|^Uscite$/i,
    // "Mastercard • Ristoranti" -> "Ristoranti" (utile come nota per la categoria)
    cleanPart: (p) => p.replace(/^(Mastercard|Maestro|Visa)\s*•\s*/i, '').replace(/\s*•?\s*\b(IBAN|BIC):?\s*[A-Z0-9]+/gi, '').trim(),
  });
  // intestatario: riga del piè di pagina "NOME COGNOME   Emesso in data"
  const holder = lines.find((l) => l.cells.length > 1 && /Emesso in data/i.test(l.cells[1].text))?.cells[0].text || null;
  return { holder, transactions };
}
