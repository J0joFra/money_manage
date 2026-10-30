// Categorie dettagliate (categoria > sottocategoria) e regole automatiche.
// type: 'expense' spese, 'income' entrate, 'transfer' movimenti tra conti propri (esclusi dai totali)

export const CATEGORIES = [
  { name: 'Alimentari', type: 'expense', icon: '🛒', subs: ['Supermercato', 'Discount', 'Panetteria e pasticceria', 'Macelleria e pescheria', 'Frutta e verdura', 'Altro'] },
  { name: 'Ristorazione', type: 'expense', icon: '🍽️', subs: ['Ristorante', 'Pizzeria', 'Fast food', 'Bar e caffè', 'Gelateria e dolci', 'Autogrill', 'Delivery', 'Mensa', 'Altro'] },
  { name: 'Trasporti', type: 'expense', icon: '🚗', subs: ['Carburante', 'Pedaggi', 'Parcheggio', 'Treno', 'Mezzi pubblici', 'Taxi e NCC', 'Sharing (auto, bici, monopattini)', 'Aereo', 'Manutenzione auto', 'Bollo e revisione', 'Altro'] },
  { name: 'Casa', type: 'expense', icon: '🏠', subs: ['Affitto', 'Mutuo', 'Condominio', 'Arredamento', 'Fai da te e ferramenta', 'Pulizia', 'Altro'] },
  { name: 'Bollette', type: 'expense', icon: '💡', subs: ['Luce', 'Gas', 'Acqua', 'Internet', 'Telefono', 'Rifiuti', 'Altro'] },
  { name: 'Abbonamenti', type: 'expense', icon: '🔁', subs: ['Streaming video', 'Musica', 'Software e AI', 'Cloud e storage', 'Giornali e riviste', 'Palestra', 'Condivisione abbonamenti', 'Altro'] },
  { name: 'Shopping', type: 'expense', icon: '🛍️', subs: ['Abbigliamento', 'Scarpe', 'Elettronica', 'Online (Amazon ecc.)', 'Libri', 'Cartoleria e copisteria', 'Regali', 'Altro'] },
  { name: 'Salute', type: 'expense', icon: '🩺', subs: ['Farmacia', 'Visite mediche', 'Dentista', 'Ottico', 'Analisi', 'Altro'] },
  { name: 'Cura personale', type: 'expense', icon: '💇', subs: ['Parrucchiere e barbiere', 'Estetica', 'Cosmetici', 'Altro'] },
  { name: 'Istruzione', type: 'expense', icon: '🎓', subs: ['Università', 'Corsi', 'Libri di testo', 'Altro'] },
  { name: 'Svago', type: 'expense', icon: '🎉', subs: ['Eventi e concerti', 'Cinema e teatro', 'Sport', 'Musei e cultura', 'Giochi e videogiochi', 'Uscite serali', 'Altro'] },
  { name: 'Viaggi', type: 'expense', icon: '✈️', subs: ['Alloggio', 'Voli', 'Attività', 'Altro'] },
  { name: 'Assicurazioni', type: 'expense', icon: '🛡️', subs: ['Auto', 'Casa', 'Salute', 'Vita', 'Altro'] },
  { name: 'Tasse e PA', type: 'expense', icon: '🏛️', subs: ['PagoPA', 'Multe', 'Imposte', 'Bolli', 'Altro'] },
  { name: 'Finanza', type: 'expense', icon: '💳', subs: ['Rate e BNPL', 'Commissioni bancarie', 'Interessi', 'Altro'] },
  { name: 'Persone', type: 'expense', icon: '👥', subs: ['Amici', 'Famiglia', 'Collette e regali di gruppo', 'Altro'] },
  { name: 'Donazioni', type: 'expense', icon: '💝', subs: ['Beneficenza', 'Altro'] },
  { name: 'Animali', type: 'expense', icon: '🐾', subs: ['Cibo', 'Veterinario', 'Altro'] },
  { name: 'Entrate', type: 'income', icon: '💰', subs: ['Stipendio', 'Rimborsi', 'Da amici e famiglia', 'Vendite', 'Interessi e dividendi', 'Cashback', 'Altro'] },
  { name: 'Trasferimenti', type: 'transfer', icon: '🔄', subs: ['Giroconto tra miei conti', 'Ricarica Satispay', 'Investimenti e risparmi', 'Prelievo contanti', 'Altro'] },
  { name: 'Da categorizzare', type: 'expense', icon: '❓', subs: ['Altro'] },
];

export const UNCATEGORIZED = { category: 'Da categorizzare', subcategory: 'Altro' };

export function categoryType(name) {
  return CATEGORIES.find((c) => c.name === name)?.type || 'expense';
}

// [regex sul testo "payee note", categoria, sottocategoria, segno ('-' solo spese, '+' solo entrate, undefined entrambi)]
export const RULES = [
  // trasferimenti e risparmi (prima di tutto il resto)
  [/ricarica (dell'app )?satispay|satispay europe/i, 'Trasferimenti', 'Ricarica Satispay'],
  [/^ricarica\b|ricarica da (iban|carta|conto)/i, 'Trasferimenti', 'Ricarica Satispay', '+'],
  [/conto di investimento|salvadanaio|spazio|pocket|vault|trade republic|scalable|directa|fineco|degiro|moneyfarm/i, 'Trasferimenti', 'Investimenti e risparmi'],
  [/prelievo|atm\b|bancomat/i, 'Trasferimenti', 'Prelievo contanti', '-'],

  // finanza
  [/paga in 3 rate|klarna|scalapay|afterpay|paypal pay in|\brata\b/i, 'Finanza', 'Rate e BNPL', '-'],
  [/commission|canone (conto|mensile)|imposta di bollo|spese tenuta/i, 'Finanza', 'Commissioni bancarie', '-'],

  // trasporti
  [/tamoil|\beni\b|eni ?station|enilive|\bq8\b|\bip\b|italiana petroli|\besso\b|\bshell\b|\btotal ?erg\b|\bapi\b|repsol|carburant|benzin|distributore/i, 'Trasporti', 'Carburante', '-'],
  [/autostrad|aspit|telepass|pedaggi|\bunipolmove|\bbrebemi|tangenziale/i, 'Trasporti', 'Pedaggi', '-'],
  [/\bpark\b|parchegg|easypark|telepass pay sosta|mycicero sosta|\bsosta\b/i, 'Trasporti', 'Parcheggio', '-'],
  [/trenord|trenitalia|\bitalo\b|\bfs\b|ferrovie|frecciarossa/i, 'Trasporti', 'Treno', '-'],
  [/\batm milano|\batac\b|\bgtt\b|\bamt\b|\bmetro\b|\bautobus\b|flixbus|mycicero|tper|busitalia/i, 'Trasporti', 'Mezzi pubblici', '-'],
  [/\buber\b|free ?now|\btaxi\b|itaxi|\bncc\b|\bbolt\b/i, 'Trasporti', 'Taxi e NCC', '-'],
  [/\benjoy\b|share now|car2go|\blime\b|\bdott\b|\btier\b|\bbird\b|bikemi|mimoto|cooltra|\bzity\b/i, 'Trasporti', 'Sharing (auto, bici, monopattini)', '-'],
  [/ryanair|easyjet|wizz|ita airways|vueling|volotea|lufthansa|aeroport/i, 'Viaggi', 'Voli', '-'],
  [/meccanic|gommist|officina|autoricambi|norauto|carrozzeria/i, 'Trasporti', 'Manutenzione auto', '-'],

  // ristorazione
  [/autogrill|chef express|sarni|\bmy chef\b|area di servizio|\bads\b/i, 'Ristorazione', 'Autogrill', '-'],
  [/mc ?donald|burger king|\bkfc\b|old wild west|roadhouse|\bpoke\b|kebab|kebap|\bsubway\b|five guys|alice pizza/i, 'Ristorazione', 'Fast food', '-'],
  [/pizz/i, 'Ristorazione', 'Pizzeria', '-'],
  [/just ?eat|deliveroo|glovo|uber ?eats/i, 'Ristorazione', 'Delivery', '-'],
  [/gelat|dessert|pasticc|cioccolat|crem\b|frangipane/i, 'Ristorazione', 'Gelateria e dolci', '-'],
  [/\bbar\b|caff[eè]|coffee|starbucks|espresso|cafe\b|bistrot/i, 'Ristorazione', 'Bar e caffè', '-'],
  [/\brist|trattoria|osteria|\bsushi\b|\bramen\b|braceria|steak|tavola calda|cucina|cozzaro/i, 'Ristorazione', 'Ristorante', '-'],
  [/\bmensa\b|edisu|\bdsu\b/i, 'Ristorazione', 'Mensa', '-'],

  // alimentari
  [/\blidl\b|eurospin|\bmd\b|\bpenny\b|\baldi\b|todis|in'?s mercato|discount/i, 'Alimentari', 'Discount', '-'],
  [/coop|esselunga|conad|carrefour|sigma|\bpam\b|panorama|despar|interspar|eurospar|famila|\btigre\b|\bcrai\b|simply|\biper\b|bennet|\bunes\b|tigros|carrefour|naturasi|supermercat|market|alimentari/i, 'Alimentari', 'Supermercato', '-'],
  [/panific|panetteria|\bforno|fornaio/i, 'Alimentari', 'Panetteria e pasticceria', '-'],
  [/macelleri|pescheri/i, 'Alimentari', 'Macelleria e pescheria', '-'],
  [/frutta|ortofrutta|verdur/i, 'Alimentari', 'Frutta e verdura', '-'],

  // abbonamenti
  [/netflix|disney|prime video|now ?tv|dazn|paramount|crunchyroll|infinity|timvision/i, 'Abbonamenti', 'Streaming video', '-'],
  [/spotify|apple music|deezer|tidal|youtube premium/i, 'Abbonamenti', 'Musica', '-'],
  [/anthropic|claude|openai|chatgpt|github|notion|adobe|microsoft|office 365|jetbrains|canva|figma|cursor|midjourney/i, 'Abbonamenti', 'Software e AI', '-'],
  [/icloud|google one|google storage|dropbox|onedrive|apple\.com\/bill/i, 'Abbonamenti', 'Cloud e storage', '-'],
  [/spliiit|together price/i, 'Abbonamenti', 'Condivisione abbonamenti', '-'],
  [/palestra|\bgym\b|fitness|mcfit|virgin active|anytime fitness|technogym/i, 'Abbonamenti', 'Palestra', '-'],

  // bollette
  [/\benel\b|a2a|edison|\biren\b|\bhera\b|sorgenia|plenitude|\bacea\b|octopus|illumia|e\.on|servizio elettrico/i, 'Bollette', 'Luce', '-'],
  [/fastweb|\btim\b|vodafone|\bwind\b|\btre\b|\biliad\b|ho\. mobile|\bkena\b|very mobile|fibra|\blinkem\b|\beolo\b/i, 'Bollette', 'Telefono', '-'],

  // shopping
  [/amazon|amzn|ebay|aliexpress|temu|shein|zalando|vinted/i, 'Shopping', 'Online (Amazon ecc.)', '-'],
  [/mediaworld|unieuro|euronics|\bexpert\b|apple store|trony/i, 'Shopping', 'Elettronica', '-'],
  [/zara|h&m|h & m|primark|\bovs\b|decathlon|uniqlo|bershka|pull ?& ?bear|kiabi|terranova|calzedonia|intimissimi/i, 'Shopping', 'Abbigliamento', '-'],
  [/foot ?locker|scarpe|pittarello|deichmann/i, 'Shopping', 'Scarpe', '-'],
  [/feltrinelli|mondadori|libreri|ibs\.it|giunti/i, 'Shopping', 'Libri', '-'],
  [/copisteri|copigraf|cartoleri|fotocop|stampa/i, 'Shopping', 'Cartoleria e copisteria', '-'],
  [/ikea|leroy merlin|brico|\bobi\b|maisons du monde|\btiger\b|\baction\b/i, 'Casa', 'Arredamento', '-'],

  // salute e cura
  [/\bfarmaci|parafarmac|pharma/i, 'Salute', 'Farmacia', '-'],
  [/dentist|odontoiatr/i, 'Salute', 'Dentista', '-'],
  [/\bottic|occhial/i, 'Salute', 'Ottico', '-'],
  [/\bmedic|clinic|poliambulator|ospedal|asl|\bats\b|laborator|analisi/i, 'Salute', 'Visite mediche', '-'],
  [/parrucch|barber|barbier|\bhair\b/i, 'Cura personale', 'Parrucchiere e barbiere', '-'],
  [/sephora|douglas|\bkiko\b|acqua ?& ?sapone|tigota|profumeri/i, 'Cura personale', 'Cosmetici', '-'],

  // istruzione
  [/universit|ateneo|politecnico|mercatorum|pegaso|ecampus|tasse universitarie/i, 'Istruzione', 'Università', '-'],
  [/udemy|coursera|\bcorso|\bscuola|\bacademy\b|growishpay ?scuola|growishpayscuola/i, 'Istruzione', 'Corsi', '-'],

  // svago e viaggi
  [/festival|ticketone|ticketmaster|vivaticket|dice\.fm|concert|eventbrite|medieval/i, 'Svago', 'Eventi e concerti', '-'],
  [/cinema|\buci\b|the space|teatro/i, 'Svago', 'Cinema e teatro', '-'],
  [/calcetto|padel|tennis|piscina|\bsport\b|\bcampo\b/i, 'Svago', 'Sport', '-'],
  [/\bmuseo|museum|\bmostra\b/i, 'Svago', 'Musei e cultura', '-'],
  [/steam|playstation|xbox|nintendo|epic games/i, 'Svago', 'Giochi e videogiochi', '-'],
  [/booking\.com|airbnb|hotel|b&b|ostello|hostel|expedia/i, 'Viaggi', 'Alloggio', '-'],

  // assicurazioni e PA
  [/prima assicurazioni|prima\.it|genertel|\blinear\b|\bverti\b|allianz|unipol|generali|zurich|\baxa\b|conte\.it|quixa|assicuraz/i, 'Assicurazioni', 'Auto', '-'],
  [/pagopa|agenzia entrate|f24|comune di|inps|\baci\b|motorizzazione/i, 'Tasse e PA', 'PagoPA', '-'],
  [/multa|sanzione|contravvenzion/i, 'Tasse e PA', 'Multe', '-'],

  // persone
  [/leetchi|growish|colletta|regalo/i, 'Persone', 'Collette e regali di gruppo', '-'],

  // entrate
  [/stipendio|emolumenti|salary|busta paga/i, 'Entrate', 'Stipendio', '+'],
  [/rimborso|refund|storno/i, 'Entrate', 'Rimborsi', '+'],
  [/cashback/i, 'Entrate', 'Cashback', '+'],
  [/interessi|dividend/i, 'Entrate', 'Interessi e dividendi', '+'],
  [/vinted|subito\.it|ebay/i, 'Entrate', 'Vendite', '+'],
];

const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Un movimento verso/da una persona (nome tutto maiuscolo o "Nome Cognome" senza parole tipiche da negozio)
function looksLikePerson(t) {
  return /^Riferimento:/i.test(t.note || '') && !/srl|spa|s\.p\.a|s\.r\.l|europe|s\.a\.|ltd|gmbh/i.test(t.payee || '');
}

/**
 * Restituisce { category, subcategory, source } per un movimento.
 * opts.ownNames: nomi del titolare per riconoscere i giroconti
 * opts.userRules: [{ match, category, subcategory }] regole create dall'utente (hanno la precedenza)
 */
export function categorize(t, opts = {}) {
  const text = `${t.payee || ''} ${t.note || ''}`;
  const payeeN = norm(t.payee);
  const textN = norm(text);

  for (const r of opts.userRules || []) {
    const m = norm(r.match);
    if (m && (payeeN === m || textN.includes(m))) return { category: r.category, subcategory: r.subcategory, source: 'regola' };
  }

  const own = (opts.ownNames || []).map(norm).filter(Boolean);
  if (own.some((n) => payeeN === n || payeeN === n.split(' ').reverse().join(' '))) {
    return { category: 'Trasferimenti', subcategory: 'Giroconto tra miei conti', source: 'auto' };
  }

  const sign = t.amount < 0 ? '-' : '+';
  for (const [re, category, subcategory, onlySign] of RULES) {
    if (onlySign && onlySign !== sign) continue;
    if (re.test(text)) return { category, subcategory, source: 'auto' };
  }

  if (looksLikePerson(t)) {
    return sign === '+'
      ? { category: 'Entrate', subcategory: 'Da amici e famiglia', source: 'auto' }
      : { category: 'Persone', subcategory: 'Amici', source: 'auto' };
  }
  if (sign === '+') return { category: 'Entrate', subcategory: 'Altro', source: 'auto' };
  return { ...UNCATEGORIZED, source: 'auto' };
}
