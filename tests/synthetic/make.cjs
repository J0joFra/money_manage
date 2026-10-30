// Genera PDF sintetici (dati inventati) che imitano i layout di N26, BBVA e Satispay.
// Uso: node tests/synthetic/make.cjs   (richiede playwright)
const { chromium } = require('playwright');
const path = require('path');
const css = 'body{font-family:Arial;font-size:10px}table{width:100%;border-collapse:collapse}td,th{padding:3px;text-align:left;vertical-align:top}.r{text-align:right}.s{color:#666;font-size:8px}';
const docs = {
  n26: `<h2>N26 Bank SE</h2><p>Estratto conto 01.10.2026 - 31.10.2026</p><p>Mario Rossi</p>
<table><tr><th>Descrizione</th><th>Data di registrazione</th><th class=r>Importo</th></tr>
<tr><td>Esselunga<div class=s>Mastercard • Generi alimentari</div><div class=s>Data valuta 01.10.2026</div></td><td>02.10.2026</td><td class=r>-23,45€</td></tr>
<tr><td>Mario Bianchi<div class=s>Bonifico in entrata • IBAN: IT60X0542811101000000123456</div><div class=s>Cena</div></td><td>05.10.2026</td><td class=r>+30,00€</td></tr>
<tr><td>Netflix<div class=s>Mastercard • Media ed elettronica</div></td><td>10.10.2026</td><td class=r>-13,99€</td></tr>
<tr><td>Saldo finale</td><td>31.10.2026</td><td class=r>1.234,56€</td></tr></table>`,
  bbva: `<h2>BBVA</h2><p>Estratto conto ottobre 2026</p>
<table><tr><th>Data operazione</th><th>Data valuta</th><th>Descrizione</th><th class=r>Uscite</th><th class=r>Entrate</th><th class=r>Saldo</th></tr>
<tr><td>01/10/2026</td><td>01/10/2026</td><td>Saldo iniziale</td><td></td><td></td><td class=r>500,00</td></tr>
<tr><td>03/10/2026</td><td>03/10/2026</td><td>Pagamento con carta presso ENI STATION MILANO</td><td class=r>45,00</td><td></td><td class=r>455,00</td></tr>
<tr><td>07/10/2026</td><td>08/10/2026</td><td>LUCA VERDI<div class=s>Rimborso cena</div></td><td></td><td class=r>20,00</td><td class=r>475,00</td></tr>
<tr><td>15/10/2026</td><td>15/10/2026</td><td>Pagamento con carta presso FARMACIA CENTRALE</td><td class=r>1.012,30</td><td></td><td class=r>-537,30</td></tr></table>`,
  satispay: `<h2>Satispay</h2><p>Resoconto movimenti</p>
<table><tr><th>Data</th><th>Nome</th><th>Descrizione</th><th class=r>Importo</th></tr>
<tr><td>04/10/2026</td><td>Bar Centrale</td><td>Pagamento</td><td class=r>-1,50 €</td></tr>
<tr><td>06/10/2026</td><td>Ricarica</td><td>Ricarica da IBAN</td><td class=r>+100,00 €</td></tr>
<tr><td>09/10/2026</td><td>Anna Neri</td><td>Inviato · pizza</td><td class=r>-8,00 €</td></tr></table>`,
  // layout reale dell'estratto trimestrale: causale su più righe centrata sulla riga di data/importo
  bbva_trimestrale: `<p style="text-align:right">MARIO ROSSI</p><h2>Estratto conto trimestrale</h2>
<p>BIC: BBVAITMMXXX</p><p>Titolare/i: MARIO ROSSI</p>
<p>Periodo di riferimento 01/12/2025 fino a 01/03/2026</p>
<table style="font-size:9px"><tr><th>Data contabile</th><th>Data valuta</th><th>Causale</th><th class=r>Importo (EUR)</th><th class=r>Saldo (EUR)</th></tr>
${[['15/12', 'BONIFICI<br>ACCREDITO COMPETENZE MESE DI', '1.500,00', '2.500,00'],
   ['20/12', 'ADDEBITO A TUO CARICO<br>N 2025224000355716 AGOS DUCATO S.P.<br>A. Viale Fulvi', '-120,00', '2.380,00'],
   ['02/01', 'LIQUIDAZIONE INTERESSI-<br>COMMISSIONI-SPESE<br>ACCREDITO 1,00% A FRONTE DEL SALDO<br>MENSILE', '2,10', '2.382,10'],
   ['10/01', 'BONIFICI<br>TRASF', '-300,00', '2.082,10'],
   ['12/01', 'ORDINI DI PAGAMENTO EMESSI IN<br>VALUTA LOCALE<br>2796575564 26503710854589', '-50,00', '2.032,10'],
   ['20/02', 'TRASFERIMENTO PROGRAMMA IL TUO<br>CONTO<br>OPERAZIONE SALDO MASSIMO<br>SALVADANAIO', '-32,10', '2.000,00'],
  ].map(([d, c, a, s]) => `<tr><td style="vertical-align:middle">${d}</td><td style="vertical-align:middle">${d}</td><td style="width:200px">${c}</td><td class=r style="vertical-align:middle">${a}</td><td class=r style="vertical-align:middle">${s}</td></tr>`).join('')}
</table><p>Saldo fine trimestre: 2.000,00 (EUR)</p>`,
};
const expected = {
  n26: 'Amount,Date,Note,Payee,Currency\n-23.45,2026-10-02,,Esselunga,EUR\n30,2026-10-05,,Mario Bianchi,EUR\n-13.99,2026-10-10,,Netflix,EUR\n',
  bbva: 'Amount,Date,Note,Payee,Currency\n-45,2026-10-03,,ENI STATION MILANO,EUR\n20,2026-10-07,,LUCA VERDI,EUR\n-1012.3,2026-10-15,,FARMACIA CENTRALE,EUR\n',
  bbva_trimestrale: 'Amount,Date,Note,Payee,Currency\n1500,2025-12-15,,Accredito competenze,EUR\n-120,2025-12-20,,AGOS DUCATO S.P.A.,EUR\n2.1,2026-01-02,,Liquidazione interessi e spese,EUR\n-300,2026-01-10,,Bonifico,EUR\n-50,2026-01-12,,Ordine di pagamento,EUR\n-32.1,2026-02-20,,Salvadanaio,EUR\n',
  satispay: 'Amount,Date,Note,Payee,Currency\n-1.5,2026-10-04,,Bar Centrale,EUR\n100,2026-10-06,,Ricarica,EUR\n-8,2026-10-09,,Anna Neri,EUR\n',
};
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage();
  for (const [k, html] of Object.entries(docs)) {
    await p.setContent(`<style>${css}</style>${html}`);
    await p.pdf({ path: path.join(__dirname, `${k}.pdf`), format: 'A4' });
    require('fs').writeFileSync(path.join(__dirname, `${k}.expected.csv`), expected[k]);
  }
  await b.close();
})();
