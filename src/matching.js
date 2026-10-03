const ZONES = [
  "milano",
  "roma",
  "torino",
  "bologna",
  "firenze",
  "navigli",
  "tortona",
  "isola",
  "brera",
  "porta romana",
  "citylife",
  "centro",
  "prati",
  "eur",
  "trastevere"
];

const STOPWORDS = new Set([
  "a",
  "al",
  "alla",
  "con",
  "da",
  "di",
  "e",
  "il",
  "in",
  "la",
  "le",
  "lo",
  "per",
  "un",
  "una",
  "uno",
  "zona",
  "cerco",
  "cerca",
  "richiesta",
  "immobile",
  "appartamento"
]);

const SYNONYMS = new Map([
  ["terrazzino", "terrazzo"],
  ["terrazza", "terrazzo"],
  ["abitabile", "vivibile"],
  ["ampio", "grande"],
  ["spazioso", "grande"],
  ["luminoso", "luminosita"],
  ["luminosa", "luminosita"],
  ["silenzioso", "tranquillo"],
  ["silenziosa", "tranquillo"],
  ["garage", "box"],
  ["posto", "box"],
  ["auto", "box"],
  ["ristrutturata", "ristrutturato"],
  ["ristrutturazione", "ristrutturato"],
  ["ascensori", "ascensore"]
]);

const TERRACE_QUALITIES = "grande|ampio|ampia|abitabile|vivibile|spazioso|spaziosa";
const AMENITY_PATTERNS = {
  terrace: "terrazz\\w*|spazio esterno",
  garden: "giardino|verde privato",
  lift: "ascensor[ei]",
  parking: "box|garage|posto auto",
  bright: "luminos\\w*|esposizione (?:sud|est|ovest)",
  quiet: "tranquill\\w*|silenzios\\w*"
};

function normalizeText(text = "") {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[€]/g, " euro ")
    .replace(/m²/g, "m2")
    .replace(/[–—]/g, "-")
    .replace(/[^\p{L}\p{N}\s.,;/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensFor(text = "") {
  const normalized = normalizeText(text);
  let comparable = normalized;
  // Remove the complete absent feature, including multiword aliases and
  // positive synonyms elsewhere, before words can earn similarity credit.
  for (const pattern of Object.values(AMENITY_PATTERNS)) {
    if (featurePresence(normalized, pattern) === false) {
      comparable = comparable.replace(new RegExp(`\\b(?:${pattern})\\b`, "g"), " ");
    }
  }
  return (comparable.match(/[\p{L}\p{N}]+/gu) || [])
    .filter((token) => featurePresence(normalized, token) !== false)
    .map((token) => SYNONYMS.get(token) || token)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token));
}

// Deliberately small Italian grammar: nearby explicit negation wins over a
// positive mention elsewhere (for example an optimistic title).
function featurePresence(text, pattern) {
  const mentions = [...text.matchAll(new RegExp(`\\b(?:${pattern})\\b`, "g"))];
  if (!mentions.length) return null;
  for (const mention of mentions) {
    const before = text.slice(0, mention.index);
    const after = text.slice(mention.index + mention[0].length);
    if (/\b(?:senza|no|non|niente|privo di|priva di|manca|mancano|non ha|non dispone di|non e presente|non e dotat[oa] di)\s+(?:(?:un|una|il|la|lo|l)\s+)?$/.test(before) ||
        /^\s+(?:assente|assenti|non presente|non presenti|non disponibile|non necessario|non obbligatorio)\b/.test(after)) return false;
  }
  return true;
}

function weightedTokenMap(text = "") {
  const map = new Map();
  for (const token of tokensFor(text)) {
    map.set(token, (map.get(token) || 0) + tokenWeight(token));
  }
  return map;
}

function tokenWeight(token) {
  if (["terrazzo", "ascensore", "box", "giardino", "navigli", "brera", "citylife"].includes(token)) return 2.2;
  if (["trilocale", "bilocale", "quadrilocale", "luminosita", "ristrutturato"].includes(token)) return 1.7;
  return 1;
}

function cosineSimilarity(leftText = "", rightText = "") {
  const left = weightedTokenMap(leftText);
  const right = weightedTokenMap(rightText);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (const value of left.values()) leftNorm += value * value;
  for (const value of right.values()) rightNorm += value * value;
  for (const [token, value] of left.entries()) {
    dot += value * (right.get(token) || 0);
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function saleAmount(text, sharedUnit = "") {
  const amount = Number(text.replace(/\D/g, ""));
  // Inherit a trailing unit only for shorthand; a full sale amount already
  // at or above the accepted threshold keeps its euro scale.
  const thousands = /k\b|mila\b/.test(text) || (amount < 20000 && !/euro\b/.test(text) && /k\b|mila\b/.test(sharedUnit));
  const value = amount * (thousands ? 1000 : 1);
  return value >= 20000 ? value : null;
}

function budgetBounds(text) {
  const number = String.raw`(?:\d{1,3}(?:[. ]\d{3})+|\d{2,7})`;
  const amount = String.raw`(?:euro\s+)?${number}\s*(?:k|mila|euro)?`;
  const currencyAmount = String.raw`(?:euro\s+${number}|${number}\s*(?:k|mila|euro))`;
  const range = text.match(new RegExp(String.raw`\bbudget\s+(?:(?:da|tra|fra)\s+)?(${amount})\s*(?:-|/|a|e|ed)\s*(${amount})\b`));
  if (range) {
    const min = saleAmount(range[1], range[2]);
    const max = saleAmount(range[2]);
    if (min && max) return { min: Math.min(min, max), max: Math.max(min, max) };
  }
  const bound = (words) => {
    const match = text.match(new RegExp(String.raw`\b(?:budget|prezzo)\s+(?:${words})\s+(${amount})\b|\b(?:${words})\s+(${currencyAmount})\b`));
    return match ? saleAmount(match[1] || match[2]) : null;
  };
  const min = bound("minimo|min|almeno|da");
  let max = bound("massimo|max|fino a|non oltre");
  const plain = text.match(new RegExp(String.raw`\bbudget\s+(${amount})\b`));
  if (!min && !max && plain) max = saleAmount(plain[1]);
  return { min, max };
}

export function extractFeatures(text = "") {
  const t = normalizeText(text);
  const f = {
    zones: [],
    rooms: null,
    sqm: null,
    sqmMin: null,
    sqmMax: null,
    price: null,
    priceMin: null,
    priceMax: null,
    floor: null,
    floorMin: null,
    excludedFloors: [],
    terrace: null,
    terraceSize: null,
    terraceLarge: false,
    balcony: null,
    garden: null,
    lift: null,
    parking: null,
    cellar: null,
    pets: null,
    bright: null,
    quiet: null,
    view: null,
    renovated: null
  };

  const rooms = t.match(/\b(monolocale|bilocale|trilocale|quadrilocale|pentalocale)\b|(\d)\s*(?:locali|vani)/);
  if (rooms) {
    f.rooms = rooms[2]
      ? Number(rooms[2])
      : { monolocale: 1, bilocale: 2, trilocale: 3, quadrilocale: 4, pentalocale: 5 }[rooms[1]];
  }

  // Keep explicit terrace measurements out of the property's surface group.
  const terraceAreaPattern = new RegExp(String.raw`\bterrazz\w*\s+(?:(?:${TERRACE_QUALITIES})\s+)*(?:(?:di|da)\s+)?(\d{1,3})\s*(?:mq|m2)\b|\b(\d{1,3})\s*(?:mq|m2)\s+di\s+terrazz\w*\b`, "g");
  const terraceAreas = [...t.matchAll(terraceAreaPattern)];
  const surfaceText = t.replace(terraceAreaPattern, " ");
  const sqmRange =
    surfaceText.match(/\b(?:da\s+)?(\d{2,4})\s*(?:-|\/)\s*(\d{2,4})\s*(?:mq|m2|m²)\b/) ||
    surfaceText.match(/\b(?:da\s+)?(\d{2,4})\s+a\s+(\d{2,4})\s*(?:mq|m2|m²)\b/) ||
    surfaceText.match(/\btra\s+(\d{2,4})\s+(?:e|ed)\s+(\d{2,4})\s*(?:mq|m2|m²)\b/);
  if (sqmRange) {
    const values = [Number(sqmRange[1]), Number(sqmRange[2])].sort((a, b) => a - b);
    f.sqmMin = values[0];
    f.sqmMax = values[1];
  } else {
    const sqm = surfaceText.match(/(\d{2,4})\s*(?:mq|m2|m²)/);
    if (sqm) f.sqm = Number(sqm[1]);
  }
  const sqmMin = surfaceText.match(/\b(?:almeno|minimo|min|da)\s+(\d{2,4})\s*(?:mq|m2|m²)\b/);
  if (sqmMin) f.sqmMin = Number(sqmMin[1]);
  const sqmMax = surfaceText.match(/\b(?:massimo|max|fino a|non oltre)\s+(\d{2,4})\s*(?:mq|m2|m²)\b/);
  if (sqmMax) f.sqmMax = Number(sqmMax[1]);
  if (f.sqmMin || f.sqmMax) f.sqm = null;

  const prices = [...t.matchAll(/\b(\d{2,4})\s*(?:k|mila)\b|\b(\d{1,3}(?:[. ]\d{3})+|\d{5,7})\s*euro\b|\b(?:euro|prezzo|budget)\s+(?:(?:massimo|max|minimo|min|fino a|non oltre)\s+)?(\d{1,3}(?:[. ]\d{3})+|\d{5,7})\b/g)]
    .map((match) => (match[1] ? Number(match[1]) * 1000 : Number((match[2] || match[3]).replace(/[.\s]/g, ""))))
    .filter((value) => value >= 20000);
  if (prices.length) {
    f.price = prices[0];
  }
  const budget = budgetBounds(t);
  f.priceMin = budget.min;
  f.priceMax = budget.max;

  const floorText = { terra: 0, primo: 1, secondo: 2, terzo: 3, quarto: 4, quinto: 5, sesto: 6, settimo: 7 };
  for (const [word, value] of Object.entries(floorText)) {
    if (new RegExp(`\\b${word}\\s+piano\\b|\\bpiano\\s+${word}\\b`).test(t)) f.floor = value;
  }
  const floor = t.match(/\b(\d{1,2})[°º]?\s*piano\b/);
  if (floor) f.floor = Number(floor[1]);
  if (/piano alto/.test(t)) f.floorMin = 3;
  if (/secondo piano o piu alto|dal secondo|almeno secondo/.test(t)) f.floorMin = 2;
  if (/no piano terra|non piano terra|esclud.*piano terra/.test(t)) f.excludedFloors.push(0);

  f.terrace = featurePresence(t, AMENITY_PATTERNS.terrace);
  if (f.terrace) {
    if (terraceAreas.length) f.terraceSize = Number(terraceAreas[0][1] || terraceAreas[0][2]);
    f.terraceLarge = new RegExp(String.raw`\b(?:terrazz\w*\s+(?:${TERRACE_QUALITIES})|(?:${TERRACE_QUALITIES})\s+terrazz\w*|spazio esterno)\b`).test(t);
  }
  f.balcony = featurePresence(t, "balcon\\w*");
  f.garden = featurePresence(t, AMENITY_PATTERNS.garden);
  f.lift = featurePresence(t, AMENITY_PATTERNS.lift);
  f.parking = featurePresence(t, AMENITY_PATTERNS.parking);
  f.cellar = featurePresence(t, "cantina");
  f.pets = /no animali|niente animali/.test(t) ? false : /animali ammessi|animali ok|cane|gatto/.test(t) ? true : null;
  f.bright = featurePresence(t, AMENITY_PATTERNS.bright);
  f.quiet = featurePresence(t, AMENITY_PATTERNS.quiet);
  f.view = featurePresence(t, "vista|panoramic\\w*");
  f.renovated = featurePresence(t, "ristrutturat\\w*|nuovo|recente");
  f.zones = ZONES.filter((zone) => new RegExp(`\\b${zone.replace(/\s+/g, "\\s+")}\\b`).test(t));
  return f;
}

function normalizeLocation(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueLocationList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const label = String(value || "").trim();
    const key = normalizeLocation(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function featuresFor(item) {
  // Stored aiFeatures are a legacy derived cache, never a source of truth.
  const base = extractFeatures([item?.title, item?.propertyType, item?.address, item?.description].filter(Boolean).join(". "));
  const out = { ...base };
  const budgetMin = typeof item?.budgetMin === "number" ? positiveNumber(item.budgetMin) : null;
  const budgetMax = typeof item?.budgetMax === "number" ? positiveNumber(item.budgetMax) : null;
  if (budgetMin || budgetMax) {
    out.priceMin = budgetMin;
    out.priceMax = budgetMax;
  }
  if (typeof item?.price === "number" && item.price > 0) out.price = item.price;
  const sqm = positiveNumber(item?.sqm);
  const sqmMin = positiveNumber(item?.sqmMin);
  const sqmMax = positiveNumber(item?.sqmMax);
  if (sqm || sqmMin || sqmMax) {
    out.sqm = sqm;
    out.sqmMin = sqmMin;
    out.sqmMax = sqmMax;
  }
  if (out.sqmMin && out.sqmMax && out.sqmMin > out.sqmMax) {
    [out.sqmMin, out.sqmMax] = [out.sqmMax, out.sqmMin];
  }

  const legacyComune = String(item?.comune || "").trim();
  const comuni = uniqueLocationList([...(Array.isArray(item?.comuni) ? item.comuni : []), legacyComune]);
  const comune = legacyComune || comuni[0] || "";
  const quartiere = String(item?.quartiere || "").trim();
  const quartieri = Array.isArray(item?.quartieri)
    ? item.quartieri.map((q) => String(q || "").trim()).filter(Boolean)
    : [];
  out.comune = comune;
  out.comuni = comuni;
  out.quartiere = quartiere;
  out.quartieri = quartieri;
  out.comuneKey = normalizeLocation(comune);
  out.comuneKeys = comuni.map(normalizeLocation).filter(Boolean);
  out.quartiereKey = normalizeLocation(quartiere);
  out.quartieriKeys = quartieri.map(normalizeLocation).filter(Boolean);
  out.lat = Number.isFinite(Number(item?.lat)) ? Number(item.lat) : null;
  out.lon = Number.isFinite(Number(item?.lon)) ? Number(item.lon) : null;
  return out;
}

function preferredComuneKeys(features) {
  const keys = Array.isArray(features.comuneKeys) ? features.comuneKeys.filter(Boolean) : [];
  return keys.length ? keys : (features.comuneKey ? [features.comuneKey] : []);
}

function preferredComuneLabels(features) {
  const labels = Array.isArray(features.comuni) ? features.comuni.filter(Boolean) : [];
  return labels.length ? labels : (features.comune ? [features.comune] : []);
}

function formatList(values = []) {
  return values.length ? values.join(", ") : "non indicato";
}

function areaRange(features, role) {
  let min = positiveNumber(features.sqmMin);
  let max = positiveNumber(features.sqmMax);
  const sqm = positiveNumber(features.sqm);

  if (role === "property") {
    if (!min && !max && sqm) {
      min = sqm;
      max = sqm;
    } else if (min && !max) {
      max = min;
    } else if (!min && max) {
      min = max;
    }
  } else {
    if (!min && !max && sqm) min = Math.round(sqm * 0.9);
  }

  if (!min && !max) return null;
  if (min && max && min > max) [min, max] = [max, min];
  return { min: min || 0, max: max || Infinity };
}

function sqmRangeLabel(range) {
  if (!range) return "mq non indicati";
  const min = Math.round(range.min || 0);
  const max = Number.isFinite(range.max) ? Math.round(range.max) : null;
  if (min && max && min === max) return `${min} mq`;
  if (min && max) return `${min}-${max} mq`;
  if (min) return `da ${min} mq`;
  if (max) return `fino a ${max} mq`;
  return "mq non indicati";
}

function areaCriterion(clientFeatures, propertyFeatures) {
  const requested = areaRange(clientFeatures, "client");
  const offered = areaRange(propertyFeatures, "property");
  if (!requested) return null;
  if (!offered) return { status: "unknown", label: "Superficie non dichiarata" };

  const overlaps = offered.max >= requested.min && offered.min <= requested.max;
  const fullyInside = offered.min >= requested.min && offered.max <= requested.max;
  const nearLow = offered.max < requested.min && offered.max >= requested.min * 0.9;
  const nearHigh = Number.isFinite(requested.max) && offered.min > requested.max && offered.min <= requested.max * 1.1;

  if (fullyInside) {
    return {
      status: "ok",
      label: `${sqmRangeLabel(offered)} nella fascia richiesta ${sqmRangeLabel(requested)}`
    };
  }
  if (overlaps) {
    return {
      status: "soft",
      label: `${sqmRangeLabel(offered)} parzialmente compatibili con ${sqmRangeLabel(requested)}`
    };
  }
  if (nearLow) {
    return {
      status: "soft",
      label: `${sqmRangeLabel(offered)} poco sotto il minimo ${sqmRangeLabel(requested)}`
    };
  }
  if (nearHigh) {
    return {
      status: "soft",
      label: `${sqmRangeLabel(offered)} poco sopra il massimo ${sqmRangeLabel(requested)}`
    };
  }
  return {
    status: "bad",
    label: `${sqmRangeLabel(offered)} fuori dalla fascia richiesta ${sqmRangeLabel(requested)}`
  };
}

export function scoreMatch(client, property, options = {}) {
  const filters = {
    budgetTolerance: 7,
    zoneMode: "soft",
    ...options
  };
  const r = featuresFor(client);
  const p = featuresFor(property);
  const reasons = [];
  const positives = [];
  const risks = [];
  const add = (criterion, weight, status, label) => {
    reasons.push({ criterion, weight, status, label });
    if (status === "ok") positives.push(label);
    if (status === "bad") risks.push(label);
  };

  const requestedComuneKeys = preferredComuneKeys(r);
  const requestedComuneLabels = preferredComuneLabels(r);
  const hasStructuredLocation = requestedComuneKeys.length || r.quartieriKeys.length;
  if (hasStructuredLocation && filters.zoneMode !== "off") {
    const comuneMatch = requestedComuneKeys.length && p.comuneKey && requestedComuneKeys.includes(p.comuneKey);
    const quartiereMatch = r.quartieriKeys.length && p.quartiereKey && r.quartieriKeys.includes(p.quartiereKey);
    if (requestedComuneKeys.length && p.comuneKey && !comuneMatch) {
      if (filters.zoneMode === "strict") add("Comune", 100, "bad", `Fuori comune: ${p.comune}`);
      else add("Comune", 22, "bad", `Comune diverso: ${p.comune} vs ${formatList(requestedComuneLabels)}`);
    } else if (quartiereMatch) {
      add("Quartiere", 22, "ok", `Quartiere preferito: ${p.quartiere}`);
    } else if (r.quartieriKeys.length && p.quartiereKey) {
      if (filters.zoneMode === "strict") add("Quartiere", 100, "bad", `${p.quartiere} fuori dalla lista preferita`);
      else add("Quartiere", 18, "soft", `${p.quartiere} fuori dalla lista preferita`);
    } else if (comuneMatch) {
      add("Comune", 16, "ok", `Stesso comune: ${p.comune}`);
      if (r.quartieriKeys.length) add("Quartiere", 22, "unknown", "Quartiere immobile non strutturato");
    } else if (requestedComuneKeys.length && !p.comuneKey) {
      add("Comune", 16, "unknown", "Comune immobile non strutturato");
    } else if (r.quartieriKeys.length && !p.quartiereKey) {
      add("Quartiere", 22, "unknown", "Quartiere immobile non strutturato");
    }
  } else if (r.zones.length && filters.zoneMode !== "off") {
    const overlap = r.zones.filter((z) => p.zones.includes(z));
    if (overlap.length) add("Zona", 18, "ok", `Zona compatibile: ${overlap.join(", ")}`);
    else if (!p.zones.length) add("Zona", 18, "unknown", "Zona non dichiarata");
    else if (filters.zoneMode === "strict") add("Zona", 100, "bad", "Zona fuori dal perimetro richiesto");
    else add("Zona", 18, "soft", `Zona diversa: ${p.zones.join(", ")}`);
  }

  if ((r.priceMin || r.priceMax) && p.price) {
    const tol = Number(filters.budgetTolerance || 0) / 100;
    const min = r.priceMin || 0;
    const max = r.priceMax || Infinity;
    if (p.price >= min && p.price <= max) add("Prezzo", 20, "ok", "Prezzo nella fascia richiesta");
    else if (p.price > max && p.price <= max * (1 + tol)) add("Prezzo", 20, "soft", "Prezzo poco sopra budget");
    else if (p.price < min && p.price >= min * (1 - tol)) add("Prezzo", 20, "soft", "Prezzo poco sotto la fascia richiesta");
    else if (p.price > max) add("Prezzo", 20, "bad", "Prezzo oltre budget");
    else add("Prezzo", 20, "bad", "Prezzo sotto la fascia richiesta");
  }
  if ((r.priceMin || r.priceMax) && !p.price) add("Prezzo", 20, "unknown", "Prezzo non dichiarato");

  if (r.rooms && p.rooms) add("Locali", 12, p.rooms >= r.rooms ? "ok" : "bad", `${p.rooms} locali rispetto a ${r.rooms} richiesti`);
  if (r.rooms && !p.rooms) add("Locali", 12, "unknown", "Numero di locali non dichiarato");
  const surface = areaCriterion(r, p);
  if (surface) add("Superficie", 10, surface.status, surface.label);
  if (r.floorMin !== null && p.floor !== null) add("Piano", 8, p.floor >= r.floorMin ? "ok" : "bad", `Piano ${p.floor}, minimo ${r.floorMin}`);
  if (r.floorMin !== null && p.floor === null) add("Piano", 8, "unknown", "Piano non dichiarato");
  if (r.excludedFloors.includes(p.floor)) add("Vincoli", 22, "bad", p.floor === 0 ? "Piano terra escluso dalla richiesta" : "Piano escluso dalla richiesta");
  if (r.excludedFloors.length && p.floor === null) add("Vincoli", 22, "unknown", "Piano da verificare rispetto alle esclusioni");

  if (r.terrace) {
    if (p.terrace === null) add("Terrazzo", 15, "unknown", "Terrazzo non dichiarato");
    else if (p.terrace === false) add("Terrazzo", 15, "bad", "Terrazzo richiesto ma mancante");
    else if (r.terraceLarge && !p.terraceSize && !p.terraceLarge) add("Terrazzo", 15, "unknown", "Dimensione del terrazzo da verificare");
    else if (r.terraceLarge && p.terraceSize && p.terraceSize < 15) add("Terrazzo", 15, "soft", `Terrazzo presente ma piccolo`);
    else add("Terrazzo", 15, "ok", p.terraceSize ? `Terrazzo ${p.terraceSize} mq` : "Terrazzo presente");
  }
  const amenity = (key, criterion, weight, present, absent, unknown) => {
    if (r[key] === true) add(criterion, weight, p[key] === true ? "ok" : p[key] === false ? "bad" : "unknown", p[key] === true ? present : p[key] === false ? absent : unknown);
  };
  amenity("lift", "Ascensore", 14, "Ascensore presente", "Ascensore assente", "Ascensore non confermato");
  amenity("parking", "Box", 7, "Box/posto auto presente", "Box/posto auto assente", "Box da verificare");
  amenity("garden", "Giardino", 6, "Giardino presente", "Giardino assente", "Giardino non indicato");
  amenity("bright", "Luminosita", 5, "Luminosita indicata", "Luminosita esclusa", "Luminosita non dichiarata");
  amenity("quiet", "Silenziosita", 4, "Contesto tranquillo", "Silenziosita esclusa", "Silenziosita da verificare");

  const similarity = cosineSimilarity(client.description || "", [property.title, property.propertyType, property.address, property.description].filter(Boolean).join(". "));
  if (similarity >= 0.08) {
    add("Similarita", 14, similarity >= 0.24 ? "ok" : "soft", `Affinita testuale ${Math.round(similarity * 100)}%`);
  }

  if (!reasons.length) add("Dati", 1, "unknown", "Servono piu criteri per un punteggio preciso");
  const total = reasons.reduce((sum, reason) => sum + reason.weight, 0);
  const got = reasons.reduce((sum, reason) => sum + reason.weight * (reason.status === "ok" ? 1 : reason.status === "soft" ? 0.5 : 0), 0);
  const score = Math.max(0, Math.min(100, Math.round((got / total) * 100)));

  return {
    id: `${client.id}|${property.id}`,
    clientId: client.id,
    propertyId: property.id,
    property,
    score,
    confidence: Math.round(100 * reasons.filter((reason) => reason.status !== "unknown").length / reasons.length),
    verdict: score >= 78 ? "Match premium" : score >= 62 ? "Molto interessante" : score >= 45 ? "Parziale" : "Debole",
    summary: reasons.slice(0, 3).map((reason) => reason.label).join("; "),
    positives: positives.slice(0, 4),
    risks: risks.slice(0, 4),
    reasons: reasons.map(({ criterion, status, label }) => ({ criterion, status, label })),
    calculatedAt: new Date().toISOString()
  };
}
