# SB Helper

Four Hypixel SkyBlock market tools:

- **Craft vs buy** — search an item, see every active BIN listing, and for each one the cost to build that exact configuration yourself from Bazaar instabuy prices. Covers enchant books, essence stars, master stars, recombobulator, gemstone slot unlocks and gems, potato books, reforges, ability scrolls, drill parts and more.
- **Forge flips** — every Dwarven Forge recipe, ranked on profit per hour: materials at Bazaar instabuy, output sold at AH lowest BIN, minus the forge timer.
- **Bazaar flips** — buy-order to sell-offer spreads, net of tax, filtered to products with real two-sided volume.
- **Compaction** — whether an item is worth more sold raw or crafted into its compacted form (80 Ink Sac → 1 Enchanted Ink Sac), with the coin difference and pinnable watchlist.

## Running

```bash
npm install
npm run dev
```

`npm run build` produces a fully static `dist/`.

## Deploying

Cloudflare Pages, free plan. Build command `npm run build`, output directory `dist`, no environment variables and no Pages Functions.

The whole deployment is 5 files and ~465 KB against limits of 20,000 files and 25 MiB per file, so nothing here is close to a ceiling. Static asset requests on Pages are unmetered, and since there are no Functions the Workers request quota does not apply at all. The free plan's real constraint is 500 builds/month — one push per build.

The part that *looks* expensive costs Cloudflare nothing: the ~120 MB auction sweep goes browser → `api.hypixel.net` directly, never through the origin, and the ~90 MB cached index lives in the user's own IndexedDB. Hypixel's rate limits apply per visitor rather than to one shared server IP, which is strictly better than a backend would manage.

`public/_redirects` is required, not optional — routing is client-side, so without the `/* /index.html 200` fallback a refresh or a shared link to `/forge` returns a 404.

The boundary: sharing one prebuilt auction index across visitors, or hiding the sweep from them, would need a server — and that is where the free tier stops working (see below).

## Architecture

**There is no backend.** Hypixel's public endpoints send `access-control-allow-origin: *`, so the browser calls the API directly. This is what makes the app deployable to Cloudflare Pages' free tier — unlimited static requests, nothing to pay for, and no difference between the local build and the deployed one.

A server-side auction indexer would *not* fit the free tier: Workers allows 10 ms CPU per invocation (a full NBT sweep needs ~20–30 s), caps isolate memory at 128 MB, and permits 1000 KV writes/day against the 1440 a 60-second refresh would need.

### The auction index

Hypixel offers no server-side search, so finding every listing of one item means holding all ~48k active auctions (50 pages, ~120 MB). That sweep sits behind an explicit button rather than running on page load, and is cached in IndexedDB for five minutes.

The expensive part — gunzip + NBT parse of every listing's `item_bytes` — is avoided. `item_name` and `extra` are plaintext in the page JSON, so a search narrows 48k listings to a few hundred candidates by string match first and decodes only those, in a worker. The decoded `ExtraAttributes.id` is then the authority, so reforge prefixes and star symbols can't cause a false match.

### Pricing

Every component is priced at Bazaar instabuy (`quick_status.buyPrice`). Two details matter:

- **Enchant books are solved for the cheapest path.** Two books of level N combine into one of N+1, so `cost(L) = min(price(L), 2 × cost(L-1))`. Buying two level-5s often beats one level-6 outright.
- **Self-levelling enchants cost one level 1 book.** Hecatomb is applied from a level 1 book and climbs to X through dungeon runs — there is no Hecatomb X book and no combining. Charging 2^9 level 1 books for it would be a cost nobody pays, and since craft cost is subtracted from the listing price, that inflation would manufacture deals. Champion, Compact, Cultivating, Expertise and Toxophilite share the mechanic but are deliberately not listed yet: wrongly flattening a genuinely tiered enchant would understate craft cost, so each needs confirming first. Until then they price as unavailable, which is the safe direction.
- **Ultimate enchants drop the prefix.** `ultimate_wisdom` is a namespace, not a name — nobody says "Ultimate Wisdom V". The label reads "Wisdom 5" and the line is tinted light purple, which is how the game itself distinguishes them.
- **A higher enchant level is never substituted for a missing one.** Most enchants only have real liquidity at their top level — nobody trades Critical 1–5 when Critical 6 is what everyone buys. Pricing those from the level above was tried and rejected: it charges a Magmarizer 6 book for an item that only carries Magmarizer 5, which inflated one Hyperion's craft cost from 485m to 793m and manufactured a 314m "deal" that did not exist. They are excluded instead.
- **Nothing unpriceable is silently dropped.** Anything that can't be priced appears as a line marked "no sell offers" (listed but with an empty order book) or "not sold on bazaar" (auction-only, e.g. runes and enrichments), and the total is labelled as excluding them.

Excluded lines only ever push the craft cost *down*, so the spread reads worse than reality. The error runs in the safe direction — it can hide a good deal, but never invent one.
- **The base item is part of the craft cost.** "Cost to build it" is the cheapest clean base (Bazaar price, or the cheapest unmodified listing) plus every modifier — otherwise a clean listing would show zero components and look like pure profit.

Pets are excluded from the craft calculator — `petInfo` pricing depends on level, xp and candy, which this tool does not model.

### Filtering and sorting

Rarity and star chips are built from the current result set, so a chip that would match nothing never appears. Item names carry their in-game rarity colour — legendary gold, mythic pink, divine aqua — since that is how the AH itself presents rarity.

A plain click makes a key the sole sort, or flips it if it is already the only one. Shift-click combines keys, cycling each through add ascending → descending → drop.

Combined keys are **balanced, not chained**. Each row is ranked separately on every active key and ordered by the sum of those ranks, so picking price and spread together surfaces listings that do well on both — cheap *and* a good margin — rather than ordering entirely by price and consulting spread only on exact ties, which for continuous coin values essentially never happens. Ranks rather than raw values because the keys share a unit but not a scale: one 2b listing would otherwise swamp the price term and leave the spread term decorative.

Rows whose craft cost could not be computed take the worst rank on that key. In a single-key sort that puts them at the bottom in either direction, where they belong. In a combined sort they can still outrank a fully priced row that is worse on everything else — that is what weighting the keys equally means, and the alternative would let one blank value override a key you explicitly asked to sort on.

### Fees

Flip tools are worthless if they quote gross spreads — tax is routinely larger than the margin on a thin bazaar flip, so a "profit" computed before fees can be a loss. Everything this app calls profit is net of:

- **BIN listing fee** — 1% below 10m, 2% from 10m to 100m, 2.5% above.
- **Auction collection tax** — up to 1% on claims above 1m, capped so it can never drag a claim below 1m.
- **Bazaar tax** — 1.25% by default, selectable down to 1.125% (manual claim) or 1% (Bazaar Flipper maxed), because on a 0.5% margin that difference decides whether the flip works at all.

### Forge flips

Hypixel publishes no forge recipes; they come from NEU, which carries the inputs and a `duration` in seconds. Recipes with no duration are dropped — a flip ranked on time is meaningless without the time, and guessing one would distort the ranking silently.

Ranking is on **profit per hour**, adjustable for Quick Forge (`min(30, 10 + level × 0.5 + ⌊level/20⌋ × 10)` percent off).

- **Materials that aren't on the Bazaar fall back to AH lowest BIN.** Drill parts, beacons and crystals are auction-only; without that fallback every recipe consuming one is unpriceable, which hides most of the interesting half of the forge. In practice this takes the excluded count from 82 recipes down to 18.
- **One unpriceable material voids the whole recipe.** This is the opposite of the craft calculator's rule and deliberately so: there, an omitted component understates craft cost and makes a listing look *worse*; here it understates cost and **overstates profit**, inventing a flip that isn't there.
- **Bazaar output defaults to the sell offer, not instasell.** Refined Mithril currently quotes an instabuy near 596k against an instasell near 8.6k — its buy-order book is empty, not its value. Pricing by instasell posts a fictional 240k loss on it. "Instant" is available as the conservative floor, and both sides of the book always show in the breakdown so a lopsided one is visible rather than believed.
- Pet outputs are excluded, as elsewhere.

### Bazaar flips

Margin is `sellOffer − buyOrder`, net of bazaar tax — the same spread an instabuy-then-instasell round trip loses.

The failure mode this guards against is that the widest percentage spreads belong to products nobody trades, where the book is one lowball buy order under one moonshot sell offer and neither leg would ever fill. So volume is part of the ranking, not a footnote: both sides must clear a weekly-volume floor, spreads wider than 100% are discarded as broken books, and throughput is paced on the *slower* side since both legs have to complete. "Flow / hr" is the whole market's hourly turnover at that margin — an upper bound, not your throughput.

### Generated data

Hypixel publishes no crafting recipes, no forge recipes or durations, and no mapping from an item's NBT `modifier` back to its reforge stone. All are derived from the [NotEnoughUpdates repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO) into `src/data/` and checked in:

```bash
npm run sync:data
```

Re-run it when Hypixel adds items. Everything else — bazaar, items, auctions — is fetched live.

## Tests

```bash
npm test
```

Covers the NBT reader against a real auction fixture, the enchant cheapest-path solver, star/master-star costs, compaction chain walking, and coin formatting.
