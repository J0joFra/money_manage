// Parser per gli estratti conto PDF di BBVA (Italia).
// Layout atteso: "Data operazione | Data valuta | Descrizione | Importo/Uscite/Entrate | Saldo".
// NB: scritto senza un estratto conto di esempio: se qualcosa non torna usa "Mostra testo estratto".

import { parseGeneric } from './generic.js';

export const id = 'bbva';
export const label = 'BBVA';

export function detect(lines) {
  return lines.slice(0, 60).some((l) => /\bBBVA\b/i.test(l.text));
}

export function parse(lines) {
  const transactions = parseGeneric(lines, {
    noise: /^(data valuta|valuta|pagina|page|iban|bic)\b|^\d+\s*(\/|di|of)\s*\d+$|BBVA|Estratto conto/i,
    cleanPart: (p) => p.replace(/^(Pagamento con carta|Pagamento carta|Acquisto carta)\s*(presso|da|-)?\s*/i, '').trim(),
  });
  return { holder: null, transactions };
}
