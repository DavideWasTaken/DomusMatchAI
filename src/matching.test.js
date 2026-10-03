import test from "node:test";
import assert from "node:assert/strict";

import { extractFeatures, featuresFor, scoreMatch } from "./matching.js";

test("structured scalar surface replaces the entire extracted surface interval", () => {
  const property = { id: "p", sqm: 150, description: "80-100 mq" };
  const features = featuresFor(property);
  assert.equal(features.sqm, 150);
  assert.equal(features.sqmMin, null);
  assert.equal(features.sqmMax, null);
  const match = scoreMatch({ id: "c", sqmMin: 140 }, property);
  assert.ok(match.reasons.some((r) => r.criterion === "Superficie" && r.status === "ok"));
});

test("structured minimum surface does not retain a conflicting extracted maximum", () => {
  const client = { id: "c", sqmMin: 140, description: "Cerco almeno 80 mq fino a 100 mq" };
  const features = featuresFor(client);
  assert.equal(features.sqmMin, 140);
  assert.equal(features.sqmMax, null);
  assert.equal(features.sqm, null);
  const match = scoreMatch(client, { id: "p", sqmMin: 120, sqmMax: 120 });
  assert.ok(match.reasons.some((r) => r.criterion === "Superficie" && r.status === "bad"));
});

test("structured maximum surface does not retain an extracted minimum", () => {
  const client = { id: "c", sqmMax: 200, description: "80-100 mq" };
  const features = featuresFor(client);
  assert.equal(features.sqmMax, 200);
  assert.equal(features.sqmMin, null);
  assert.equal(features.sqm, null);
  const match = scoreMatch(client, { id: "p", sqm: 40 });
  assert.ok(match.reasons.some((r) => r.criterion === "Superficie" && r.status === "ok"));
});

test("a structured minimum budget replaces an extracted maximum budget", () => {
  const client = { id: "c", budgetMin: 200000, description: "Budget massimo 100.000 euro" };
  const features = featuresFor(client);
  assert.equal(features.priceMin, 200000);
  assert.equal(features.priceMax, null);
  const match = scoreMatch(client, { id: "p", price: 250000 });
  assert.ok(match.reasons.some((r) => r.criterion === "Prezzo" && r.status === "ok"));
});

test("extracts Italian real-estate requirements without an LLM", () => {
  const features = extractFeatures(
    "Famiglia cerca trilocale luminoso zona Navigli, budget massimo 450.000 euro, terrazzo abitabile e ascensore obbligatorio. No piano terra."
  );

  assert.equal(features.rooms, 3);
  assert.equal(features.priceMax, 450000);
  assert.equal(features.terrace, true);
  assert.equal(features.terraceLarge, true);
  assert.equal(features.lift, true);
  assert.deepEqual(features.excludedFloors, [0]);
  assert.deepEqual(features.zones, ["navigli"]);
});

test("scores strong matches higher than weak matches with explainable reasons", () => {
  const client = {
    id: "c1",
    name: "Cliente",
    description:
      "Cerco trilocale luminoso ai Navigli, budget fino a 450.000 euro, terrazzo abitabile, ascensore e box."
  };
  const strongProperty = {
    id: "p1",
    title: "Trilocale Navigli con terrazzo",
    status: "available",
    description:
      "Trilocale luminoso zona Navigli, 92 mq, prezzo 430.000 euro, terrazzo abitabile di 22 mq, ascensore e box."
  };
  const weakProperty = {
    id: "p2",
    title: "Bilocale fuori zona",
    status: "available",
    description: "Bilocale a Torino, 55 mq, prezzo 510.000 euro, piano terra senza ascensore."
  };

  const strong = scoreMatch(client, strongProperty);
  const weak = scoreMatch(client, weakProperty);

  assert.ok(strong.score >= 80);
  assert.ok(weak.score < 45);
  assert.ok(strong.score > weak.score);
  assert.ok(strong.reasons.some((reason) => reason.criterion === "Similarita"));
  assert.ok(strong.positives.length > 0);
  assert.ok(weak.risks.length > 0);
});

test("penalizes explicit negative constraints", () => {
  const client = {
    id: "c1",
    description: "Cerco almeno trilocale, ascensore obbligatorio, no piano terra."
  };
  const property = {
    id: "p1",
    title: "Piano terra",
    status: "available",
    description: "Trilocale al piano terra senza ascensore."
  };

  const match = scoreMatch(client, property);

  assert.ok(match.score < 55);
  assert.ok(match.risks.some((risk) => /piano terra/i.test(risk)));
  assert.ok(match.risks.some((risk) => /ascensore/i.test(risk)));
});

test("uses explicit property price before text extraction", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    budgetMax: 450000
  };
  const property = {
    id: "p1",
    title: "Trilocale",
    price: 430000,
    description: "Trilocale 90 mq, prezzo scritto male o assente."
  };

  const match = scoreMatch(client, property);

  assert.ok(match.reasons.some((r) => r.criterion === "Prezzo" && r.status === "ok"));
});

test("structured location matching is case- and accent-insensitive", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    comune: "  MILANO  ",
    quartieri: ["Navìgli", "TORTONA"]
  };
  const property = {
    id: "p1",
    title: "Trilocale",
    description: "Trilocale",
    comune: "milano",
    quartiere: "navigli"
  };
  const match = scoreMatch(client, property);
  assert.ok(match.reasons.some((r) => r.criterion === "Quartiere" && r.status === "ok"),
    "should treat 'MILANO' == 'milano' and 'Navìgli' == 'navigli'");
});

test("client can search across multiple comuni", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale con ascensore",
    comuni: ["Milano", "Roma"]
  };
  const roma = {
    id: "p1",
    title: "Trilocale Prati",
    description: "Trilocale luminoso con ascensore",
    comune: "Roma",
    quartiere: "Prati"
  };
  const torino = {
    id: "p2",
    title: "Trilocale Torino",
    description: "Trilocale luminoso con ascensore",
    comune: "Torino",
    quartiere: "Centro"
  };

  const good = scoreMatch(client, roma);
  const bad = scoreMatch(client, torino);

  assert.ok(good.score > bad.score);
  assert.ok(good.reasons.some((r) => r.criterion === "Comune" && r.status === "ok"));
  assert.ok(bad.reasons.some((r) => r.criterion === "Comune" && r.status === "bad"));
});

test("strict zone mode accepts any preferred comune", () => {
  const client = {
    id: "c1",
    description: "Cerco bilocale",
    comuni: ["Milano", "Roma"]
  };
  const property = {
    id: "p1",
    title: "Bilocale Roma",
    description: "Bilocale con balcone",
    comune: "Roma"
  };

  const match = scoreMatch(client, property, { zoneMode: "strict" });

  assert.ok(match.score >= 50);
  assert.ok(!match.reasons.some((r) => r.criterion === "Comune" && r.status === "bad"));
});

test("location labels preserve original case from the source data", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    comune: "Milano",
    quartieri: ["Navigli", "Tortona"]
  };
  const matchingProperty = {
    id: "p1",
    title: "Trilocale",
    description: "Trilocale",
    comune: "Milano",
    quartiere: "Navigli"
  };
  const sameComune = {
    id: "p2",
    title: "Trilocale Isola",
    description: "Trilocale",
    comune: "Milano",
    quartiere: "Isola"
  };
  const wrongComune = {
    id: "p3",
    title: "Trilocale Torino",
    description: "Trilocale",
    comune: "Torino",
    quartiere: "Centro"
  };

  const a = scoreMatch(client, matchingProperty);
  const b = scoreMatch(client, sameComune);
  const c = scoreMatch(client, wrongComune);

  assert.ok(
    a.reasons.some((r) => r.criterion === "Quartiere" && r.label.includes("Navigli")),
    "preferred-quartiere label must show original 'Navigli' case"
  );
  assert.ok(
    b.reasons.some((r) => r.criterion === "Quartiere" && r.label.includes("Isola")),
    "out-of-list label must show original 'Isola' case"
  );
  assert.ok(
    c.reasons.some((r) => r.criterion === "Comune" && r.label.includes("Torino") && r.label.includes("Milano")),
    "comune-mismatch label must show both original 'Torino' and 'Milano' cases"
  );
});

test("extracts square meter ranges from natural language", () => {
  const features = extractFeatures("Cerco trilocale da 80 a 110 mq, budget massimo 450.000 euro.");

  assert.equal(features.sqmMin, 80);
  assert.equal(features.sqmMax, 110);
});

test("preserves numeric range separators and Italian square meter units", () => {
  for (const text of ["80-110 mq", "80/110 mq", "80–110 m²"]) {
    const features = extractFeatures(text);
    assert.equal(features.sqmMin, 80, text);
    assert.equal(features.sqmMax, 110, text);
    assert.equal(features.sqm, null, text);
  }
});

test("does not confuse postal codes or internal reference numbers with prices", () => {
  assert.equal(extractFeatures("Via Esempio 5, 20100 Milano, riferimento 450000").price, null);
  assert.equal(extractFeatures("Prezzo 450000").price, 450000);
  assert.equal(extractFeatures("450.000 euro").price, 450000);
  assert.equal(extractFeatures("Budget 450k").priceMax, 450000);
});

test("supports a euro symbol before the amount", () => {
  assert.equal(extractFeatures("Prezzo richiesto € 450.000").price, 450000);
});

test("a textual minimum budget sets a lower bound without inventing a maximum", () => {
  for (const text of ["Budget minimo 300.000 euro", "Budget min 300k", "Almeno 300 mila euro"]) {
    const features = extractFeatures(text);
    assert.equal(features.priceMin, 300000, text);
    assert.equal(features.priceMax, null, text);
    const match = scoreMatch({ id: "c", description: text }, { id: "p", price: 200000 });
    assert.ok(match.reasons.some((r) => r.criterion === "Prezzo" && r.status === "bad"), text);
  }
});

test("textual budget ranges retain both bounds for price scoring", () => {
  for (const text of ["Budget da 300k a 450k", "Budget tra 300.000 e 450.000 euro", "Budget 300–450 mila"]) {
    const features = extractFeatures(text);
    assert.equal(features.priceMin, 300000, text);
    assert.equal(features.priceMax, 450000, text);
    for (const [price, expected] of [[200000, "bad"], [400000, "ok"], [500000, "bad"]]) {
      const match = scoreMatch({ id: "c", description: text }, { id: "p", price });
      assert.ok(match.reasons.some((r) => r.criterion === "Prezzo" && r.status === expected), `${text}: ${price}`);
    }
  }
});

test("budget bounds come from their own amount rather than unrelated maximum words", () => {
  const features = extractFeatures("Budget minimo 300k, massimo 100 mq");
  assert.equal(features.priceMin, 300000);
  assert.equal(features.priceMax, null);
  assert.equal(extractFeatures("Prezzo 430.000 euro, massimo 100 mq").priceMax, null);
});

test("textual maximums retain the supported price prefix and currency forms", () => {
  for (const text of ["Prezzo massimo 450000", "Budget fino a 450000", "Massimo 450k", "Non oltre € 450.000"]) {
    const features = extractFeatures(text);
    assert.equal(features.priceMin, null, text);
    assert.equal(features.priceMax, 450000, text);
  }
});

test("missing preferred neighborhood remains unverified even when the municipality matches", () => {
  const match = scoreMatch({ id: "c", comune: "Milano", quartieri: ["Navigli"] }, { id: "p", comune: "Milano" });
  assert.ok(match.reasons.some((r) => r.criterion === "Comune" && r.status === "ok"));
  assert.ok(match.reasons.some((r) => r.criterion === "Quartiere" && r.status === "unknown"));
  assert.ok(match.score < 100);
});

test("large terrace requirement remains unverified when terrace size is missing", () => {
  const match = scoreMatch({ id: "c", description: "Terrazzo abitabile" }, { id: "p", description: "Terrazzo" });
  assert.ok(match.reasons.some((r) => r.criterion === "Terrazzo" && r.status === "unknown"));
});

test("large room adjectives cannot confirm the size of an unrelated terrace", () => {
  for (const description of ["Terrazzo, soggiorno ampio", "Terrazzo e soggiorno spazioso", "Terrazzo. Cucina abitabile"]) {
    assert.equal(extractFeatures(description).terraceLarge, false, description);
    const match = scoreMatch({ id: "c", description: "Terrazzo abitabile" }, { id: "p", description });
    assert.ok(match.reasons.some((r) => r.criterion === "Terrazzo" && r.status === "unknown"), description);
  }
});

test("large terrace adjectives are recognized directly before or after the noun", () => {
  for (const description of ["Ampio terrazzo", "Terrazza ampia", "Terrazzo abitabile", "Spaziosa terrazza"]) {
    assert.equal(extractFeatures(description).terraceLarge, true, description);
    const match = scoreMatch({ id: "c", description: "Terrazzo abitabile" }, { id: "p", description });
    assert.ok(match.reasons.some((r) => r.criterion === "Terrazzo" && r.status === "ok"), description);
  }
});

test("sqm maximum does not create an unintended minimum", () => {
  const match = scoreMatch({ id: "c", description: "Massimo 100 mq" }, { id: "p", sqm: 60 });
  assert.ok(match.reasons.some((r) => r.criterion === "Superficie" && r.status === "ok"));
});

test("an explicitly measured terrace does not supply the property surface", () => {
  for (const text of ["Trilocale con terrazzo di 22 mq", "Terrazzo abitabile da 22 m²", "22 mq di terrazzo"]) {
    const features = extractFeatures(text);
    assert.equal(features.sqm, null, text);
    assert.equal(features.sqmMin, null, text);
    assert.equal(features.sqmMax, null, text);
    assert.equal(features.terraceSize, 22, text);
    const match = scoreMatch({ id: "c", sqmMin: 80 }, { id: "p", description: text });
    assert.ok(match.reasons.some((r) => r.criterion === "Superficie" && r.status === "unknown"), text);
  }
});

test("property surface and terrace size remain separate in either description order", () => {
  for (const text of [
    "Terrazzo abitabile di 22 mq, appartamento di 95 mq",
    "Appartamento di 95 m² con terrazzo di 22 m2",
    "Terrazzo da 22 mq. Cerco da 80 a 110 mq"
  ]) {
    const features = extractFeatures(text);
    assert.equal(features.terraceSize, 22, text);
    if (text.includes("Cerco")) {
      assert.equal(features.sqmMin, 80);
      assert.equal(features.sqmMax, 110);
    } else {
      assert.equal(features.sqm, 95, text);
    }
  }
});

test("always derives features from current source fields instead of stale or malformed caches", () => {
  for (const aiFeatures of [{}, { zones: null, excludedFloors: "invalid" }, { terrace: true }, "invalid"]) {
    const property = { id: "p", description: "Bilocale senza terrazzo", aiFeatures };
    assert.equal(featuresFor(property).rooms, 2);
    assert.notEqual(featuresFor(property).terrace, true);
    assert.doesNotThrow(() => scoreMatch({ id: "c", description: "Cerco trilocale" }, property));
  }
});

test("internal notes do not introduce property facts or client requirements", () => {
  const client = { id: "c", description: "Cerco trilocale", notes: "Il precedente immobile aveva terrazzo" };
  const property = { id: "p", description: "Trilocale", notes: "Il cliente ha chiesto un giardino con terrazzo" };
  assert.notEqual(featuresFor(client).terrace, true);
  assert.notEqual(featuresFor(property).garden, true);
  const plain = scoreMatch({ ...client, notes: "" }, { ...property, notes: "" });
  const annotated = scoreMatch(client, property);
  assert.equal(annotated.score, plain.score);
  assert.deepEqual(annotated.reasons, plain.reasons);
});

test("distinguishes unmentioned amenities from explicit Italian negations", () => {
  const absent = extractFeatures("Senza terrazzo. Giardino assente. No box. Ascensore non presente. Non luminoso. Non silenzioso.");
  for (const key of ["terrace", "garden", "parking", "lift", "bright", "quiet"]) {
    assert.equal(absent[key], false, key);
    assert.equal(extractFeatures("Trilocale")[key], null, key);
  }
  assert.equal(extractFeatures("Terrazzo e giardino con box, ascensore, luminoso e silenzioso").terrace, true);
});

test("recognizes short explicit Italian verb phrases for an absent amenity", () => {
  for (const description of [
    "Non dispone di ascensore",
    "Non ha l'ascensore",
    "Non è presente un ascensore",
    "Non è dotato di ascensore"
  ]) {
    assert.equal(extractFeatures(description).lift, false, description);
    const match = scoreMatch({ id: "c", description: "Ascensore" }, { id: "p", description });
    assert.ok(match.reasons.some((r) => r.criterion === "Ascensore" && r.status === "bad"), description);
    assert.equal(match.score, 0, description);
  }
  assert.equal(extractFeatures("Dispone di un ascensore").lift, true);
});

test("explicit verb absence wins over a positive title and suppresses client requirements", () => {
  const property = { id: "p", title: "Appartamento con ascensore", description: "Non dispone di ascensore" };
  assert.equal(featuresFor(property).lift, false);
  const client = { id: "c", description: "Non ha ascensore" };
  assert.ok(!scoreMatch(client, property).reasons.some((r) => r.criterion === "Ascensore"));
});

test("explicit absence cannot earn a text similarity reward for the requested amenity", () => {
  const match = scoreMatch({ id: "c", description: "Terrazzo" }, { id: "p", description: "Senza terrazzo" });
  assert.ok(match.reasons.some((r) => r.criterion === "Terrazzo" && r.status === "bad"));
  assert.equal(match.score, 0);
});

test("every word in a denied multiword amenity is excluded from text similarity", () => {
  for (const [description, criterion] of [
    ["Posto auto", "Box"],
    ["Verde privato", "Giardino"],
    ["Spazio esterno", "Terrazzo"],
    ["Esposizione sud", "Luminosita"]
  ]) {
    const match = scoreMatch({ id: "c", description }, { id: "p", description: `Senza ${description}` });
    assert.ok(match.reasons.some((r) => r.criterion === criterion && r.status === "bad"), description);
    assert.ok(!match.reasons.some((r) => r.criterion === "Similarita"), description);
    assert.equal(match.score, 0, description);
  }
});

test("a denied amenity cannot regain text similarity through a positive synonym in the title", () => {
  const match = scoreMatch(
    { id: "c", description: "Box" },
    { id: "p", title: "Garage", description: "Senza posto auto" }
  );
  assert.ok(match.reasons.some((r) => r.criterion === "Box" && r.status === "bad"));
  assert.equal(match.score, 0);
  const present = scoreMatch({ id: "c", description: "Box" }, { id: "p", description: "Garage" });
  assert.equal(present.score, 100);
});

test("unknown requested facts remain visible and earn no score or coverage", () => {
  const client = { id: "c", comune: "Milano", budgetMax: 450000, sqmMin: 80, description: "Trilocale con terrazzo, ascensore, giardino, box, luminoso e silenzioso, piano alto" };
  const match = scoreMatch(client, { id: "p", title: "Immobile da verificare" });
  for (const criterion of ["Comune", "Prezzo", "Superficie", "Locali", "Piano", "Terrazzo", "Ascensore", "Giardino", "Box", "Luminosita", "Silenziosita"]) {
    assert.ok(match.reasons.some((r) => r.criterion === criterion && r.status === "unknown"), criterion);
  }
  assert.equal(match.score, 0);
  assert.equal(match.confidence, 0);
  assert.equal(match.risks.length, 0);
});

test("no usable requirements yields zero score and coverage", () => {
  const match = scoreMatch({ id: "c" }, { id: "p" });
  assert.equal(match.score, 0);
  assert.equal(match.confidence, 0);
});

test("an unknown price cannot outperform a documented in-budget price", () => {
  const client = { id: "c", budgetMax: 450000, description: "Trilocale" };
  const known = scoreMatch(client, { id: "p1", description: "Trilocale", price: 430000 });
  const unknown = scoreMatch(client, { id: "p2", description: "Trilocale" });
  assert.ok(known.score > unknown.score);
  assert.ok(known.confidence > unknown.confidence);
});

test("scores structured square meter min and max ranges", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    sqmMin: 80,
    sqmMax: 110
  };
  const compatible = {
    id: "p1",
    title: "Trilocale giusto",
    description: "Trilocale luminoso",
    sqmMin: 92,
    sqmMax: 92
  };
  const tooLarge = {
    id: "p2",
    title: "Quadrilocale grande",
    description: "Quadrilocale luminoso",
    sqmMin: 135,
    sqmMax: 135
  };

  const good = scoreMatch(client, compatible);
  const bad = scoreMatch(client, tooLarge);

  assert.ok(good.score > bad.score);
  assert.ok(good.reasons.some((r) => r.criterion === "Superficie" && r.status === "ok"));
  assert.ok(bad.reasons.some((r) => r.criterion === "Superficie" && r.status === "bad"));
});

test("strict zone mode heavily penalizes a wrong comune", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    comune: "Milano"
  };
  const wrongComune = {
    id: "p1",
    title: "Trilocale Torino",
    description: "Trilocale luminoso con ascensore e terrazzo",
    comune: "Torino"
  };
  const match = scoreMatch(client, wrongComune, { zoneMode: "strict" });
  assert.ok(match.score < 30, "strict mode must crush score for wrong comune");
  assert.ok(match.reasons.some((r) => r.criterion === "Comune" && r.status === "bad"));
});

test("strict zone mode heavily penalizes a different structured quartiere", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale con ascensore",
    comune: "Milano",
    quartieri: ["Navigli"]
  };
  const wrongQuartiere = {
    id: "p1",
    title: "Trilocale Isola",
    description: "Trilocale luminoso con ascensore",
    comune: "Milano",
    quartiere: "Isola"
  };

  const match = scoreMatch(client, wrongQuartiere, { zoneMode: "strict" });

  assert.ok(match.score < 30, "strict mode must crush score for a different quartiere");
  assert.ok(match.reasons.some((r) => r.criterion === "Quartiere" && r.status === "bad"));
});

test("client without structured location falls back to regex zone matching", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale ai Navigli con ascensore"
  };
  const property = {
    id: "p1",
    title: "Trilocale Navigli",
    description: "Trilocale luminoso ai Navigli con ascensore"
  };
  const match = scoreMatch(client, property);
  assert.ok(match.reasons.some((r) => r.criterion === "Zona" && r.status === "ok"));
});

test("property without structured quartiere still gets comune credit", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale",
    comune: "Milano",
    quartieri: ["Navigli"]
  };
  const noQuartiere = {
    id: "p1",
    title: "Trilocale",
    description: "Trilocale luminoso con ascensore",
    comune: "Milano"
  };
  const match = scoreMatch(client, noQuartiere);
  assert.ok(match.reasons.some((r) => r.criterion === "Comune" && r.status === "ok"),
    "same comune should still count when quartiere is missing on property");
});

test("rewards structured location match (same comune + preferred quartiere)", () => {
  const client = {
    id: "c1",
    description: "Cerco trilocale con ascensore",
    comune: "Milano",
    quartieri: ["Navigli", "Tortona"]
  };
  const matchingProperty = {
    id: "p1",
    title: "Trilocale via Tortona",
    description: "Trilocale 90mq con ascensore",
    comune: "Milano",
    quartiere: "Tortona"
  };
  const wrongComune = {
    id: "p2",
    title: "Trilocale Torino",
    description: "Trilocale 90mq con ascensore",
    comune: "Torino",
    quartiere: "Centro"
  };
  const sameComuneDifferentQuartiere = {
    id: "p3",
    title: "Trilocale Isola",
    description: "Trilocale 90mq con ascensore",
    comune: "Milano",
    quartiere: "Isola"
  };

  const a = scoreMatch(client, matchingProperty);
  const b = scoreMatch(client, wrongComune);
  const c = scoreMatch(client, sameComuneDifferentQuartiere);

  assert.ok(a.score > c.score, "preferred quartiere should beat same-comune-different-quartiere");
  assert.ok(c.score > b.score, "same-comune should beat wrong-comune");
  assert.ok(a.reasons.some((r) => r.criterion === "Quartiere" && r.status === "ok"));
  assert.ok(b.reasons.some((r) => r.criterion === "Comune" && r.status === "bad"));
});
