// Estrae il testo da un PDF ricostruendo le righe con le posizioni x delle "celle".
// Funziona sia nel browser che in Node: riceve il modulo pdf.js già caricato.

const SAME_LINE_TOLERANCE = 2.5; // pt di differenza in y per considerare due pezzi sulla stessa riga
const CELL_GAP = 8; // pt di spazio orizzontale oltre il quale inizia una nuova cella

export async function extractLines(pdfjs, data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => it.str && it.str.trim() !== '')
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width }));

    // raggruppa per y (dall'alto verso il basso)
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r.y - it.y) <= SAME_LINE_TOLERANCE);
      if (row) row.items.push(it);
      else rows.push({ y: it.y, items: [it] });
    }
    rows.sort((a, b) => b.y - a.y);

    for (const row of rows) {
      row.items.sort((a, b) => a.x - b.x);
      const cells = [];
      for (const it of row.items) {
        const last = cells[cells.length - 1];
        if (last && it.x - last.end <= CELL_GAP) {
          const gap = it.x - last.end;
          last.text += (gap > 1 && !last.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
          last.end = Math.max(last.end, it.x + it.w);
          last.parts.push({ text: it.str.trim(), x: it.x, end: it.x + it.w });
        } else {
          cells.push({ text: it.str, x: it.x, end: it.x + it.w, parts: [{ text: it.str.trim(), x: it.x, end: it.x + it.w }] });
        }
      }
      for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim();
      const clean = cells.filter((c) => c.text);
      if (!clean.length) continue;
      lines.push({ page: p, y: row.y, cells: clean, text: clean.map((c) => c.text).join('  ') });
    }
  }
  return lines;
}
