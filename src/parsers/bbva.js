// Parser per gli estratti conto PDF di BBVA (Italia), es. "Estratto conto trimestrale".
// Layout: "Data contabile | Data valuta | Causale | Importo (EUR) | Saldo (EUR)" con date senza anno (dd/mm)
// e importi firmati. La causale di ogni movimento è su più righe CENTRATE verticalmente sulla
// riga con data e importo: alcune righe stanno sopra, altre sotto. Per assegnarle al movimento giusto
// si sfrutta la simmetria: il blocco si estende sotto la riga della data quanto si estende sopra.

import { parseDate, parseAmount, cleanSpaces, round2 } from './common.js';
import { parseGeneric } from './generic.js';

export const id = 'bbva';
export const label = 'BBVA';

export function detect(lines) {
  return lines.some((l) => /BBVAITMM|BANCO BILBAO|Linea BBVA/i.test(l.text)) ||
    lines.slice(0, 60).some((l) => /^BBVA\b/.test(l.text));
}

const SHORT_DATE = /^\d{2}\/\d{2}$/;
const TOLERANCE = 4; // pt

// tipo di operazione (prima riga della causale) -> etichetta leggibile
const TYPES = [
  [/^BONIFICI\b/, 'Bonifico'],
  [/^ORDINI DI PAGAMENTO EMESSI IN VALUTA LOCALE\b/, 'Ordine di pagamento'],
  [/^LIQUIDAZIONE INTERESSI-COMMISSIONI-SPESE\b/, 'Liquidazione interessi e spese'],
  [/^ADDEBITO A TUO CARICO\b/, 'Addebito diretto'],
  [/^TRASFERIMENTO\b/, 'Trasferimento'],
  [/^PAGAMENTO (CON )?CARTA\b|^PAGAMENTI CARTA\b/, 'Pagamento carta'],
  [/^PRELIEVO\b/, 'Prelievo'],
];

function periodYears(lines) {
  const l = lines.find((x) => /Periodo di riferimento/i.test(x.text));
  const m = l && l.text.match(/(\d{2})\/(\d{2})\/(\d{4}).*?(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? { startMonth: Number(m[2]), startYear: Number(m[3]) } : null;
}

export function parse(lines) {
  const holderLine = lines.find((l) => /^Titolare/i.test(l.cells[0].text));
  const holder = holderLine?.cells[1]?.text.split(/[,;]/)[0].trim() || null;
  const period = periodYears(lines);
  const dateRows = lines.filter((l) => SHORT_DATE.test(l.cells[0].text) && l.cells.some((c) => parseAmount(c.text)));

  if (!period || !dateRows.length) {
    // altro layout BBVA (date complete su una riga): parser generico
    return { holder, transactions: parseGeneric(lines, { noise: /^(data valuta|valuta|pagina|page|iban|bic)\b|BBVA|Estratto conto/i }) };
  }

  const yearOf = (mm) => (mm < period.startMonth ? period.startYear + 1 : period.startYear);
  const toIso = (ddmm) => {
    const [d, m] = ddmm.split('/').map(Number);
    return parseDate(`${d}/${m}/${yearOf(m)}`);
  };

  // x dove inizia la causale: prima cella di testo sulle righe con la data
  const inlineXs = dateRows.flatMap((r) => r.cells.filter((c) => c.x > r.cells[1].end && !parseAmount(c.text)).map((c) => c.x));
  const descX = inlineXs.length ? Math.min(...inlineXs) : 230;
  const isDescLine = (l) => !SHORT_DATE.test(l.cells[0].text) && Math.abs(l.cells[0].x - descX) < 10 && !l.cells.some((c) => parseAmount(c.text));

  const txs = [];
  for (let page = 1; page <= Math.max(...lines.map((l) => l.page)); page++) {
    const pageLines = lines.filter((l) => l.page === page);
    const pageDates = pageLines.filter((l) => dateRows.includes(l));
    if (!pageDates.length) continue;
    const headerY = pageLines.find((l) => /Causale/i.test(l.text))?.y ?? Infinity;
    const desc = pageLines.filter((l) => l.y < headerY && isDescLine(l)).sort((a, b) => b.y - a.y);

    let i = 0;
    for (const row of pageDates) {
      const block = [];
      // righe sopra la data (fino alla riga della data inclusa)
      let top = row.y;
      while (i < desc.length && desc[i].y > row.y + 0.5) {
        top = Math.max(top, desc[i].y);
        block.push(desc[i++]);
      }
      const inline = row.cells.filter((c) => Math.abs(c.x - descX) < 10 && !parseAmount(c.text));
      // righe sotto: fino a una distanza pari a quella sopra
      const bottom = 2 * row.y - top - TOLERANCE;
      const next = pageDates[pageDates.indexOf(row) + 1];
      const below = [];
      while (i < desc.length && desc[i].y >= bottom && (!next || desc[i].y > next.y)) below.push(desc[i++]);
      const texts = [...block.map((l) => l.text), ...inline.map((c) => c.text), ...below.map((l) => l.text)];
      const amountCell = row.cells.find((c) => c.x > descX && parseAmount(c.text));
      txs.push(build(toIso(row.cells[0].text), parseAmount(amountCell.text).value, texts));
    }
  }
  return { holder, transactions: txs };
}

function build(date, amount, texts) {
  // unisci le righe: "INTERESSI-" + "COMMISSIONI-SPESE" senza spazio
  const full = cleanSpaces(texts.reduce((acc, t) => (acc.endsWith('-') ? acc + t : acc ? `${acc} ${t}` : t), ''));
  const type = TYPES.find(([re]) => re.test(full));
  let rest = type ? cleanSpaces(full.replace(type[0], '')) : full;
  rest = rest
    .replace(/^N \d{8,}\s*/, '') // numero mandato SDD
    .replace(/\bS\.P\. A\./, 'S.P.A.');
  // codici/riferimenti senza un nome (es. "TRASF", "2796575564 26503710854589") non sono un beneficiario
  const meaningful = rest && !/^[\d\s]+$/.test(rest) && !/^[a-z]{2,6}\d*$/i.test(rest) && !/^[A-Z]{3,}\d{3,}$/.test(rest);
  let payee = meaningful && type?.[1] !== 'Liquidazione interessi e spese' ? rest : type ? type[1] : rest;
  payee = payee
    .replace(/\s+(Viale|Via|V\.le|Piazza|P\.za|Corso|C\.so)\b.*$/i, '') // indirizzo del creditore
    .replace(/^ACCREDITO COMPETENZE.*$/i, 'Accredito competenze')
    .replace(/^.*\bSALVADANAIO\b.*$/i, 'Salvadanaio');
  return {
    date,
    amount: round2(amount),
    currency: 'EUR',
    payee,
    note: type ? `${type[1]}${rest ? ' · ' + rest : ''}` : full,
  };
}
