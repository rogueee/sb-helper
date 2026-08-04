# SB Helper

Two Hypixel SkyBlock market tools:

- **Craft vs buy** — search an item, see every active BIN listing, and for each one the cost to build that exact configuration yourself from Bazaar instabuy prices. Covers enchant books, essence stars, master stars, recombobulator, gemstone slot unlocks and gems, potato books, reforges, ability scrolls, drill parts and more.
- **Compaction** — whether an item is worth more sold raw or crafted into its compacted form (80 Ink Sac → 1 Enchanted Ink Sac), with the coin difference and pinnable watchlist.

## Running

```bash
npm install
npm run dev
```

`npm run build` produces a fully static `dist/`.

## Architecture

**There is no backend.** Hypixel's public endpoints send `access-control-allow-origin: *`, so the browser calls the API directly. This is what makes the app deployable to Cloudflare Pages' free tier — unlimited static requests, nothing to pay for, and no difference between the local build and the deployed one.

A server-side auction indexer would *not* fit the free tier: Workers allows 10 ms CPU per invocation (a full NBT sweep needs ~20–30 s), caps isolate memory at 128 MB, and permits 1000 KV writes/day against the 1440 a 60-second refresh would need.

### The auction index

Hypixel offers no server-side search, so finding every listing of one item means holding all ~48k active auctions (50 pages, ~120 MB). That sweep sits behind an explicit button rather than running on page load, and is cached in IndexedDB for five minutes.

The expensive part — gunzip + NBT parse of every listing's `item_bytes` — is avoided. `item_name` and `extra` are plaintext in the page JSON, so a search narrows 48k listings to a few hundred candidates by string match first and decodes only those, in a worker. The decoded `ExtraAttributes.id` is then the authority, so reforge prefixes and star symbols can't cause a false match.

### Pricing

Every component is priced at Bazaar instabuy (`quick_status.buyPrice`). Two details matter:

- **Enchant books are solved for the cheapest path.** Two books of level N combine into one of N+1, so `cost(L) = min(price(L), 2 × cost(L-1))`. Buying two level-5s often beats one level-6 outright.
- **Enchants with no market at the exact level fall back to the next level up.** Most enchants only have real liquidity at their top level — nobody trades Critical 1–5 when Critical 6 is what everyone buys, and a higher book can't be split back down. Those lines are priced from the level above and labelled `lvl 6 — no lvl 5 market`, making them an explicit upper bound. Without this a typical Hyperion showed ~19 unpriced lines and a component total roughly 8× too low.
- **Nothing unpriceable is silently dropped.** Anything that still can't be priced appears as a line marked "no sell offers" (listed but with an empty order book) or "not sold on bazaar" (auction-only, e.g. runes and enrichments), and the total is labelled as excluding them. A quietly understated craft cost would make a bad listing look like a bargain, which is the exact mistake this tool exists to prevent.
- **The base item is part of the craft cost.** "Cost to build it" is the cheapest clean base (Bazaar price, or the cheapest unmodified listing) plus every modifier — otherwise a clean listing would show zero components and look like pure profit.

Pets are excluded from the craft calculator — `petInfo` pricing depends on level, xp and candy, which this tool does not model.

### Generated data

Hypixel publishes no crafting recipes and no mapping from an item's NBT `modifier` back to its reforge stone. Both are derived from the [NotEnoughUpdates repo](https://github.com/NotEnoughUpdates/NotEnoughUpdates-REPO) into `src/data/` and checked in:

```bash
npm run sync:data
```

Re-run it when Hypixel adds items. Everything else — bazaar, items, auctions — is fetched live.

## Tests

```bash
npm test
```

Covers the NBT reader against a real auction fixture, the enchant cheapest-path solver, star/master-star costs, compaction chain walking, and coin formatting.
