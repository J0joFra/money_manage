// Parser per i resoconti PDF di Satispay.
// Layout atteso: righe con data, nome negozio/persona, tipo operazione e importo firmato.
// NB: scritto senza un estratto conto di esempio: se qualcosa non torna usa "Mostra testo estratto".

import { parseGeneric } from './generic.js';

export const id = 'satispay';
export const label = 'Satispay';

export function detect(lines) {
  // solo nell'intestazione: negli estratti di altre banche "Satispay" compare come esercente
  return lines.slice(0, 15).some((l) => /satispay/i.test(l.text)) && !lines.slice(0, 40).some((l) => /Revolut|N26|BBVA/i.test(l.text));
}

export function parse(lines) {
  const transactions = parseGeneric(lines, {
    noise: /^(pagina|page|id transazione|codice)\b|^\d+\s*(\/|di|of)\s*\d+$|Satispay Europe|Estratto conto/i,
  });
  return { holder: null, transactions };
}
