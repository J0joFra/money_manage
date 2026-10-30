# 💶 Le mie spese

App web gratuita e personale per tenere traccia delle spese partendo dagli estratti conto PDF.

- **Carichi il PDF** (Revolut, N26, Satispay, BBVA o altre banche) → viene convertito in movimenti
  nel formato `Amount,Date,Note,Payee,Currency`
- **Categorie dettagliate** (categoria › sottocategoria) assegnate automaticamente
- **Impara da te**: quando correggi una categoria puoi creare una regola per quel beneficiario
- **Riepilogo**: spese per categoria e sottocategoria, andamento mensile, dove spendi di più
- **Privacy**: tutto gira nel browser, i PDF e i dati non vengono mai inviati a un server
  (sono salvati nel `localStorage` del browser: fai il backup da *Impostazioni*)
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
| Satispay | 🟡 parser basato sul layout tipico, da verificare con un estratto reale |
| BBVA     | ✅ testato su un estratto reale ("Estratto conto trimestrale": la somma dei movimenti torna con i saldi) |
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
