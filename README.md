# Packaging Genie (by RAMA)

Packaging Genie is a browser-based pallet and container loading optimiser. You choose a pallet or container, the products and the mix you want, and the application finds the closest combination of **whole cartons** that physically fits, checks weight and height, and shows **exactly where every carton goes**.

- **One self-contained file:** `index.html`. There's nothing to install and no server, database or API keys. It works offline in Chrome and Edge.
- **Load units:**
  - Pallets: Europe, Industrial, US GMA, Asia, Australia and India standards, and any you add.
  - Containers: 20′ GP, 40′ GP, 40′ HC and 45′ HC, with loose cartons or loaded pallets.
- **Calculation modes:**
  - Single SKU
  - Target Mix (percentage by cartons, saleable units or weight)
  - Exact Quantity
  - Multi-Pallet allocation
  - Pallets → Container
- **3D view of every load:** rotate, zoom, preset views, build it up layer by layer, play the loading sequence, and hover over a carton for its details. Arrows on the carton sides show which way up each carton is.
- **Traffic-light status on every plan:**
  - GREEN = ready to load.
  - AMBER = load with care, or safe but room to improve.
  - RED = not safe as planned, or safe but space is wasted.

  Stability, space used, target mix, weight and height are each checked, with plain-language advice. You can change the thresholds in the Self-Test & Method tab.
- **What else fits?** Suggests extra cartons of your mix SKUs, then other active products, plus a combined best fill, to bring the load closer to 100%. Every suggestion is re-planned and physically validated. “Add to plan” creates an Adjusted plan with its own layout and status.
- **Forecast fill (overlay):** every loading plan has a “Show forecast fill” switch. It keeps the planned cartons exactly where they are and draws, hatched in orange, the extra cartons that would fill the remaining floor space and carton tops (mix SKUs first, then other active products), with the utilisation it would reach. The combined load passes the same physical check. “Add forecast to plan” turns it into a real plan.
- **Product Master brands:** Phoenix Gravity, RAMA or C Line. SKU dropdowns are grouped by brand, and “Add all active SKUs of <brand>” fills the mix table with one brand.
- **Light and dark mode:** the app follows your system setting by default, and the header button switches it. Drawings keep a light background so prints look the same in both modes.
- **Every result is physically validated.** The app checks footprint, overlap, height, weight, orientation rules, 100% base support and carton counts, then draws the layout from the real carton coordinates.

## Use it

**Option A – GitHub Pages (recommended for the team)**

1. Create a **public** repository on GitHub, e.g. `packaging-genie`.
2. Push this folder to the repository's `main` branch:
   ```bash
   git init -b main
   git add .
   git commit -m "Packaging Genie v1.1"
   git remote add origin https://github.com/<your-account>/packaging-genie.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**.
4. The workflow `.github/workflows/pages.yml` runs the automated tests and then publishes the app at `https://<your-account>.github.io/packaging-genie/`.

Only `index.html` is published. If a test fails, the site isn't updated.

**Option B – local file.** Download `index.html` and double-click it.

## Sharing data across the team

Product, pallet and container masters and saved plans are stored in each person's browser (`localStorage`). To share them, click **Export data (JSON)**, send the file to your colleagues, and have them click **Import data**.

## How the optimiser works (short)

1. **2-D patterns.** A recursive guillotine search over "normal" positions finds the best layer for each carton. It tries both footprint rotations, mixed-orientation rows and leftover strips, and never relies on `FLOOR(L/l) × FLOOR(W/w)` alone.
2. **Physical packing engine.** This answers "can these exact cartons be placed?" It has two methods, and every placed carton has real X/Y/Z coordinates:
   - **Full layers.** A layer is as tall as its tallest carton. Nothing is ever placed in the air gap above a shorter carton, and upper layers may only stand on carton tops at exactly the layer height.
   - **Column blocks.** The footprint is cut into strips and each strip into blocks. A block holds one SKU, or a nested chain of up to three SKUs where each upper carton fits inside the footprint of the carton below (e.g. P17 on P24, Carbon Filters on POSTreat). A dynamic programme over SKU subsets finds the arrangement. Containers are loaded strip by strip from the closed end.
3. **Mix optimiser.** This answers "which whole-carton combination best meets the target?" It combines four searches: target-following growth, a utilisation fill-up, proportional scaling with largest-remainder rounding, and a local search that adds, removes and swaps cartons. The physical packing engine checks every candidate. Weight, volume and dominance pruning keep the browser responsive, and the search runs in a Web Worker with progress and a Cancel button.
4. **Scenario ranking.** Each objective uses:

   `score = capacity utilisation % − λ × weighted deviation − μ × weighted deviation beyond tolerance + 0.01 × cartons`

   Weighted deviation = Σ priority weight × |achieved % − target %|. The priority weights are High 3, Normal 1 and Low 0.5.

   | Scenario | λ | μ |
   |---|---|---|
   | Closest Target Match | 4 | 20 |
   | Balanced | 1 | 5 |
   | Maximum Utilisation | 0.15 | 0.5 |

   All weights are configurable in `CONFIG` at the top of the engine script.

## Performance, memory and hosting (audited for v1.2)

**Calculation time** (Node.js on a typical office PC; browsers are similar):

| Load | Time |
|---|---|
| Single SKU, pallet | about 0.1 s |
| Target mix, 4–6 SKUs, pallet | 0.06–0.3 s |
| Target mix, 6–10 SKUs, 40′ HC container | 0.4–1.0 s |
| 17,700 tiny cartons in a 40′ HC | 0.3 s |
| 40,000 tiny cartons, 4-SKU mix, 40′ HC | 1.2 s |
| Multi-container plan, 6,000 cartons | 1.0 s |
| Extreme shipment: 60 SKUs × 60 cartons (55 pallets) | about 6 s, with progress and Cancel |

Calculations run in a background Web Worker, so the page never freezes, and a Cancel button stops long runs.

**Browser behaviour:**
- **3D view:** hidden inner faces are skipped. Rotating a 17,700-carton container takes 22–33 ms per frame.
- **Side elevation:** draws only the visible cartons.
- **Memory:** the page uses about 5–35 MB, and stays flat across repeated calculations.

**Browser storage** (localStorage, about 5 MB per browser):

| Record | Size | Rough capacity |
|---|---|---|
| Product | about 0.3 KB | about 1,000 products = 0.3 MB |
| Saved pallet plan (3 scenarios with layouts) | about 30 KB | about 160 plans |
| Saved container plan | about 180 KB | about 28 plans |

Saved Plans shows how much storage is used. A layout larger than 1 MB is saved as inputs only and recalculated when loaded.

**GitHub hosting:**
- **Repository:** about 0.35 MB.
- **Site:** `index.html` is 323 KB, or 96 KB compressed, which is what each page load transfers.
- **GitHub Pages limits:** 1 GB per site and about 100 GB of bandwidth per month.
- **Example:** a team of 50 opening the app 20 times a day uses about 2 GB per month, or 2% of the limit.
- **Other costs:** no server, database or paid storage is needed, and a CI run takes about 1 minute of free Actions time.

## Security and data safety

- **Imported data files are untrusted.** Every product, pallet and container is rebuilt from known fields with the right data types and validated. Saved plans from a file keep only their inputs, and the layout is recalculated from your own data when you load them.
- **Text is escaped.** Everything you type (SKUs, names, plan names) is escaped before it is shown.
- **CSV export is safe.** Cells that start with `=`, `+`, `-` or `@` are neutralised, so they can’t run as spreadsheet formulas.
- **Storage problems are reported.** If browser storage is full, the app shows an error and never shows a false “Saved.”.

## Assumptions (v1)

- **Dimensions** are outer carton dimensions. Values entered in cm are converted to mm.
- **Height:** maximum height includes the pallet base, so usable height = maximum − base height.
- **Clearance** applies between cartons. An upper carton never bridges the clearance gap between two lower cartons: it must rest fully on real carton tops. Defaults: 0 mm on pallets, 5 mm for loose cartons in containers, 25 mm between pallets in a container (published container capacities assume such gaps).
- **Maximum stack layers** is a crush-strength limit: a carton of that SKU never has more than (maximum − 1) tiers of any product resting on it. Fragile cartons carry nothing.
- **Overhang** is off by default. When allowed, it applies up to the chosen number of mm per side. Upper cartons still need full support.
- **Fragile** cartons never carry other cartons.
- **Maximum stack weight** is stored for a future version.
- **Container figures** are typical ISO internal sizes and payloads. Confirm them with your carrier, because road weight limits may be lower.
- **Target % of locked SKUs:** when a SKU's quantity is locked, the target % of the other SKUs applies to the optimised (unlocked) part of the load.

## Tests

```bash
node tests/run-tests.mjs
```

This runs the built-in self-tests: every default SKU on the Europe and Industrial pallets, mixed tests A–E, exact quantity, multi-pallet, containers, validation messages and locked quantities. The same tests can be run from the **Self-Test & Method** tab in the app.

```bash
node tests/fuzz-tests.mjs 150
```

This runs randomised stress cases, including “Add to plan” re-plans. A separate geometry checker, which doesn't use the engine's own validator, re-checks bounds, overlap, support (by point sampling), weight, counts and the recalculated percentages.

## Project layout

```
index.html                    the complete application (engine + UI)
tests/run-tests.mjs           runs the built-in self-tests in Node
tests/fuzz-tests.mjs          randomised independent validation
.github/workflows/pages.yml   CI tests + GitHub Pages deployment
```
