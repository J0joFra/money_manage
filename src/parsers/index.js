import * as revolut from './revolut.js';
import * as n26 from './n26.js';
import * as bbva from './bbva.js';
import * as satispay from './satispay.js';
import * as generic from './generic.js';

// L'ordine conta: i parser più specifici prima, il generico per ultimo.
export const PARSERS = [revolut, n26, bbva, satispay, generic];

export function parseStatement(lines, bankId) {
  const parser = (bankId && PARSERS.find((p) => p.id === bankId)) || PARSERS.find((p) => p.detect(lines));
  const res = parser.parse(lines);
  return { bank: parser.id, bankLabel: parser.label, ...res };
}
