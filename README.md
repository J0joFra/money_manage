# 💶 Le mie spese

App web gratuita e personale per tenere traccia delle spese partendo dagli estratti conto PDF.

- **Carichi il PDF** (Revolut, N26, Satispay, BBVA o altre banche) → viene convertito in movimenti
  nel formato `Amount,Date,Note,Payee,Currency`
- **Categorie dettagliate** (categoria › sottocategoria) assegnate automaticamente
- **Impara da te**: quando correggi una categoria puoi creare una regola per quel beneficiario
- **Riepilogo**: spese per categoria e sottocategoria, andamento mensile, dove spendi di più
- **Privacy**: tutto gira nel browser, i PDF e i dati non vengono mai inviati a un server
  (sono salvati nel `localStorage` del browser: fai il backup da *Impostazioni*)
- **Controllo saldi**: per ogni estratto verifica che i movimenti letti tornino con i saldi del PDF e mostra il saldo di ogni conto
  (per Revolut il disponibile = contabile + movimenti in sospeso, come nell'app)
- **Giroconti e contanti**: riconosce i soldi spostati tra i tuoi conti (anche abbinando uscita ed entrata) e i prelievi
- **Duplicati**: lo stesso movimento importato da estratti diversi (o sovrapposti) viene riconosciuto da conto + data + importo
  e saltato; se il nuovo estratto è più dettagliato aggiorna il beneficiario. In *Movimenti → Trova duplicati* puoi controllare quelli già salvati
- **Conti collegati** (scheda *Conti*): diagramma di quanto sposti da un conto all'altro (giroconti, ricariche,
  prelievi, salvadanai). Il conto di arrivo viene riconosciuto dall'abbinamento uscita/entrata, dall'IBAN
  (letto dagli estratti o inserito a mano) o dal nome
- **Contanti** (e conti senza estratto): saldo impostato a mano, aggiornato con prelievi e spese registrate;
  quando lo riallinei, la differenza può diventare una "spesa in contanti non registrata"
- **Salvadanai / conti deposito**: i trasferimenti interni allo stesso conto non sono spese né entrate
- Esporta CSV (`Amount,Date,Note,Payee,Currency,Category,Subcategory,Account`) e backup JSON

Nessun build, nessuna dipendenza a runtime: HTML + JavaScript + [pdf.js](https://mozilla.github.io/pdf.js/) (in `vendor/`).

## Avvio

Serve un piccolo server statico (i moduli JavaScript non funzionano aprendo il file direttamente):

```bash
python3 -m http.server 8000
# poi apri http://localhost:8000
```

Per usarla dal telefono si può pubblicare gratis con **GitHub Pages**
(Settings → Pages → Deploy from branch → `main` / root) e poi "Aggiungi a schermata Home".

## Banche supportate

| Banca    | Stato |
|----------|-------|
| Revolut  | ✅ testato su un estratto conto reale (movimenti in sospeso inclusi, stornati esclusi) |
| N26      | ✅ testato su un estratto reale ("Estratto conto preliminare" mensile) |
| Satispay | ✅ testato su un estratto reale ("Lista Transazioni" da Esporta report: controllo disponibilità, annullati esclusi, "In corso" in sospeso) |
| BBVA     | ✅ testato su estratti reali: "Estratto conto trimestrale" (con controllo saldi) e "Ultimi movimenti" dall'app (max 6 mesi, con beneficiario e IBAN) |
| PayPal   | ⏳ in attesa di un estratto di esempio |
| Altre    | parser generico: riconosce righe con data + descrizione + importo |

Se un estratto non viene letto bene, nella schermata *Importa* c'è **"Mostra testo estratto"**:
mostra il testo con le posizioni delle colonne, utile per adattare il parser.

## Struttura

```
index.html            interfaccia
src/app.js            logica UI
src/pdf-text.js       estrazione testo dal PDF ricostruendo righe e colonne
src/parsers/          un parser per banca + generico (generic.js) + utilità comuni
src/categories.js     categorie, sottocategorie e regole automatiche
src/store.js          salvataggio locale e deduplica
src/csv.js            import/export CSV
tests/                test dei parser
```

### Aggiungere/migliorare una banca

1. Crea `src/parsers/<banca>.js` con `id`, `label`, `detect(lines)` e `parse(lines)`
   (spesso basta riusare `parseGeneric` con qualche opzione, vedi `n26.js`)
2. Registralo in `src/parsers/index.js`
3. Metti l'estratto in `tests/fixtures/<banca>.pdf` con il CSV atteso `tests/fixtures/<banca>.expected.csv`
   (la cartella `fixtures/` è esclusa da git perché contiene dati personali)

## Test

```bash
npm install
npm test          # aggiungi -- -v per vedere anche le categorie assegnate
node tests/run.mjs --dump estratto.pdf   # mostra il testo estratto e il risultato del parser
```

`tests/synthetic/` contiene PDF inventati che imitano i layout (rigenerabili con `tests/synthetic/make.cjs`).
