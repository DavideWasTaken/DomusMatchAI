# Deterministic matching

DomusMatchAI ranks property/client pairs with local JavaScript rules in [`src/matching.js`](../src/matching.js). It uses regular expressions, structured fields and weighted word overlap. It does not call an LLM, use embeddings, train a model or send matching text to an external API. The score is a rule-based sorting aid for an operator; it is not a probability of a sale, a valuation or a verified statement about a property.

## Inputs and Italian support

Each evaluation extracts features afresh from title, property type, address and description. Internal `notes` are excluded: an appointment comment or a reference to another property must not become an amenity or requirement. Legacy `aiFeatures` values are ignored, including malformed or stale caches.

Structured budget, price, surface area and municipality/neighborhood fields take precedence over the corresponding extracted values. Any valid structured surface value replaces the entire extracted surface group (exact size, minimum and maximum); any valid structured budget bound replaces both extracted budget bounds. An omitted structured bound therefore stays open rather than inheriting a conflicting value from text. Use the structured fields for these facts whenever possible. Municipality and neighborhood comparisons ignore accents and letter case but preserve the original spelling in explanations. A client may select several municipalities.

The parser supports a small Italian vocabulary, including:

- Room words from `monolocale` to `pentalocale`, or a single digit followed by `locali` or `vani`.
- Whole square meters with `mq`, `m2` or `m²`; ranges such as `80-110 mq`, `80/110 mq`, `80–110 mq`, `da 80 a 110 mq` and `tra 80 e 110 mq`; `almeno` and `massimo` bounds.
- Sale amounts such as `450k`, `450 mila`, `450.000 euro`, `€ 450.000` and `prezzo 450000`. Bare numbers without a currency or price/budget prefix are not treated as prices. Extracted amounts below EUR 20,000 are ignored; use structured prices for amounts outside this sale-oriented heuristic.
- Budget bounds immediately attached to an amount: `budget minimo 300.000 euro`, `almeno 300k`, `budget fino a 450000`, `prezzo massimo 450000` and `non oltre € 450.000`. Minimum words are `minimo`, `min`, `almeno` and `da`; maximum words are `massimo`, `max`, `fino a` and `non oltre`. Without a `budget`/`prezzo` prefix the amount must include `euro`, `€`, `k` or `mila`. A plain `budget 450k` still creates only a maximum. Unrelated words such as `massimo 100 mq` do not turn another amount into a maximum budget.
- Budget intervals with the explicit word `budget`, followed by optional `da`, `tra` or `fra`: `budget da 300k a 450k`, `budget tra 300.000 e 450.000 euro` and `budget 300-450 mila`. Separators are `-`, `/`, `a`, `e` or `ed`; Unicode dashes are normalized. A final `k`/`mila` suffix applies to an unsuffixed first number only when that number is below 20,000. Full amounts at or above 20,000 retain their euro scale: `budget da 300.000 a 450k`, `budget da 300 000 a 450 mila` and `budget 300000-450 mila` all mean 300,000–450,000 euros. An explicit unit on either amount remains authoritative. These patterns set both budget bounds; structured bounds still take precedence.
- Floor words from ground to seventh floor, digit floor expressions, `piano alto`, `dal secondo` and explicit ground-floor exclusion.
- Terrace, garden, lift (`ascensore` and `ascensori`), parking, brightness and quietness terms. Balcony, cellar, pets, view and renovation are extracted but have no dedicated scoring criterion.

Direct terrace measurements such as `terrazzo di 22 mq`, `terrazzo abitabile da 22 m²` and `22 mq di terrazzo` are stored as terrace size and removed before property-surface extraction. The measurement is a whole number of one to three digits with `mq`, `m2` or `m²`; `di`/`da` and the listed terrace adjectives may appear between the noun and number. The remaining apartment size is extracted independently, regardless of whether it comes before or after the terrace measurement. If no apartment size remains, its surface is unknown.

A large/usable terrace adjective must be directly before or after the terrace noun: `ampio terrazzo`, `terrazza ampia`, `terrazzo abitabile`. Recognized adjectives are `grande`, `ampio`, `ampia`, `abitabile`, `vivibile`, `spazioso` and `spaziosa`. `Terrazzo, soggiorno ampio` and `terrazzo. Cucina abitabile` do not confirm a large terrace. The original `spazio esterno` alias still implies a large/usable terrace.

Amenities use three values: `true` for a positive mention, `false` for recognized absence and `null` when not mentioned. Simple negations include `senza terrazzo`, `no box`, `giardino assente`, `ascensore non presente` and `non luminoso`. Short verb phrases immediately before the feature are also supported: `non ha`, `non dispone di`, `non è presente`, `non è dotato di` and `non è dotata di`, with an optional `un`, `una`, `il`, `la`, `lo` or `l'` article. For example, `non dispone di ascensore` and `non ha l'ascensore` explicitly report absence. Recognized explicit negation takes precedence when the same feature also appears positively elsewhere. Before text similarity is calculated, the entire absent scored amenity and its recognized aliases are removed, including all words of `posto auto`, `verde privato`, `spazio esterno` and `esposizione sud/est/ovest`.

## Score and explanations

Every emitted reason has a weight and one of four statuses:

| Status | Score multiplier | Meaning |
| --- | ---: | --- |
| `ok` | 1 | Supported compatibility |
| `soft` | 0.5 | Known partial compatibility or a permitted tolerance |
| `bad` | 0 | Explicit incompatibility |
| `unknown` | 0 | Required information is missing |

`score = round(100 × sum(weight × multiplier) / sum(weight))`, bounded to 0–100.

Missing requested facts remain in the denominator and in the explanations. They are not listed as explicit incompatibilities. With no usable criterion, the matcher emits an unknown `Dati` reason and returns score 0. Scores across clients with different requirements therefore do not measure the same set of facts.

| Criterion | Weight | Main rule |
| --- | ---: | --- |
| Municipality | 16 for a match or unknown; 22 for a mismatch | Any selected municipality is accepted |
| Neighborhood | 22 for a match or unknown; 18 for a different neighborhood | Preferred neighborhood replaces municipality credit; a matching municipality still earns credit when the neighborhood is missing, with a separate unknown reason |
| Text-extracted zone | 18 | Used only when the client has no structured location request |
| Strict location mismatch | 100 | Replaces the ordinary location-mismatch weight |
| Price | 20 | Inside the budget interval; partial credit within the selected tolerance outside it (default 7%) |
| Rooms | 12 | At least the requested number |
| Surface | 10 | Offered interval is inside the requested interval; partial credit for overlap or a value within 10% outside a bound |
| Minimum floor | 8 | Offered floor meets the requested minimum |
| Excluded floor | 22 | An explicitly excluded floor is a mismatch; an unreported floor is unknown |
| Terrace | 15 | Required terrace is present; a requested large terrace under 15 mq earns partial credit; missing size is unknown unless a large/usable terrace is explicitly described |
| Lift | 14 | Required amenity is explicitly present |
| Parking | 7 | Required amenity is explicitly present |
| Garden | 6 | Required amenity is explicitly present |
| Brightness | 5 | Requested quality is explicitly described |
| Quietness | 4 | Requested quality is explicitly described |
| Text similarity | 14 | Cosine similarity at least 0.24 earns full credit; 0.08–0.24 earns partial credit; below 0.08 emits no reason |

Text similarity compares the client description with the property's title, type, address and description. Token counts use a small synonym dictionary and weights of 2.2 for selected amenities/zones, 1.7 for selected room/quality words and 1 otherwise. It is word overlap rather than semantic understanding.

`zoneMode: "off"` disables location reasons. `"soft"` uses ordinary location weights; `"strict"` applies the weight of 100 to an explicit mismatch. Strict mode is a heavy score penalty, **not a hard filter**: it does not remove properties. An unknown location is still unknown in strict mode.

A single unbounded surface request such as `100 mq` retains the original approximate rule: minimum 90 mq, with no maximum. Explicit bounds avoid that approximation. A single bound on a property is treated as its offered size. Prefer an exact size or a complete interval for properties.

The legacy return field `confidence` is **criteria coverage**: `round(100 × number of non-unknown reasons / number of reasons)`. It includes known mismatches and text similarity; it measures how many emitted reasons could be assessed. It is not statistical confidence, extraction accuracy or a probability. A pair with only one assessable criterion may have 100% coverage.

Verdict labels are fixed thresholds: at least 78 is `Match premium`, 62 is `Molto interessante`, 45 is `Parziale`, otherwise `Debole`. Explanations should be read with the score. `positives` and `risks` contain up to four known matches and mismatches respectively; `reasons` contains the full list. `calculatedAt` changes with time; the scoring result for unchanged inputs and options is deterministic.

## Known limits

This is a small application for a shared agency workflow, not a general Italian language engine. Phrase patterns do not understand arbitrary negation scope, coordinated lists, double negatives, conditionals, alternatives, historical descriptions or sarcasm. Prefer short factual sentences, repeating the negation for each absent feature. Correct ambiguous source descriptions before relying on the ranking.

Descriptions, titles and addresses are still text: a street name containing an amenity word can be misread. Multiple sizes or prices can be ambiguous. Terrace intervals, nonadjacent measurement phrases and sizes of other spaces such as a garden or box can still be mistaken for apartment area. Complex currency formats, decimal amounts, rentals, currencies other than euros and intervals outside the listed budget patterns are not fully parsed. Use structured price/budget/surface fields. A bare price mentioned in a client description without a budget/bound phrase does not create a budget constraint. Adjectives separated from the terrace noun by other words are not interpreted.

A numeric terrace size in a client description does not create an exact-size or minimum-size requirement. The existing large/usable-terrace criterion uses the fixed 15 mq threshold for a measured property terrace. Negations with intervening adjectives, arbitrary verb forms, coordinated absences and double negatives remain outside the supported grammar. The parser does not provide general Italian NLP.

Only the listed city/neighborhood vocabulary is recognized in unstructured zone text; structured locations support other names. There is no geographic radius, travel time, address validation or branch-based ranking. Client negations suppress positive amenity requirements; except for the explicit floor exclusion rule they do not create a general “must not have” constraint. “Mandatory” amenities and strict locations remain weighted reasons, so other matching criteria can offset them. Human review is required before proposing a property to a client.

## Regression tests

Run `node --test src/matching.test.js` or the repository test script. The tests preserve the original matching cases and cover separator normalization, postal-code/reference false prices, currency-prefix amounts, textual minimum/range budgets, unrelated bound words, max-only surfaces, separate terrace/apartment sizes, adjacent terrace adjectives, stale caches, internal notes, verb-negated amenities, whole-phrase negation in similarity, missing criteria, missing neighborhood/terrace details and no-data scores. The tests use invented records and require no network or Firebase access.
