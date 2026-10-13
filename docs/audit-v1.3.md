# Packaging Genie v1.3 – end-to-end audit

Audited: `index.html` (engine + UI), `tests/run-tests.mjs`, `tests/fuzz-tests.mjs` and `.github/workflows/pages.yml` at commit `a07446d`. No application code was changed.

## Summary

The packing geometry is solid. Across all runs below, no plan or forecast overlay ever had an overlapping, floating, over-stacked, over-height or over-weight carton. The problems are in the layers around the geometry:

- An action button that fails about half the time.
- Two places where the search's feasibility check disagrees with the final planner.
- A data-loss path in import.
- Two drawing bugs.
- Storage bloat in saved plans.
- A CI setting that can cancel a production deploy.

| # | Severity | Finding | Evidence |
|---|---|---|---|
| H1 | **High** | "Add forecast to plan" fails in about 47% of cases. | 246 of 550 attempts failed (2 seeds); reproduced in the browser on default data. |
| M1 | Medium | Target Mix and "What else fits" under-fill single-SKU pallets compared with the Single SKU tab. | 77 of 460 product/pallet cases, up to 9% fewer cartons. |
| M2 | Medium | Import accepts duplicate product IDs; deleting one product then deletes others. | Reproduced in the browser. |
| M3 | Medium | With forecast on, the side elevation hides the real cartons behind forecast cartons. | Screenshot. |
| M4 | Medium | Saved plans store forecast cartons uncompressed. | 1.6 MB record, 98% forecast. |
| M5 | Medium | The CI concurrency group lets a pull-request run cancel a `main` deploy. | `pages.yml` lines 14–16. |
| L1 | Low | The 3-D view highlights the last carton as the "current step" whenever a forecast exists. | Pixel check and screenshot. |
| L2 | Low | When browser storage is full, a phantom saved plan stays in the list. | Reproduced in the browser. |
| L3 | Low | A malformed saved plan in an imported file crashes the mix table. | `mixRows.map is not a function`. |
| L4 | Low | The first print can miss the 3-D picture. | Image not decoded when `window.print()` runs. |
| L5 | Low / question | The overhang warning says "bottom-layer" only, but every layer overhangs. | P24C2D2 on Euro: overhang in layers 1–3. |
| L6 | Low | Traffic-light thresholds are not range-checked. | Code reading. |
| L7 | Low | Docs are stale: "dominance pruning" (removed in v1.3), file sizes, performance table. | grep and measurements. |
| P1–P7 | Performance | Hot spots in validation, forecast, duplicate forecasts, the fuzz checker, and Node 20 in CI. | Profiles below. |

---

## High

### H1. "Add forecast to plan" fails about half the time

**What the user sees.**

1. Set up Target Mix with P12C2D0 50% and Carbon Filters 50% on the Industrial pallet (default data, Balanced). The plan is 19/19.
2. Switch on "Show forecast fill". It offers "+1 P12C2D0 → 73% instead of 72%".
3. Click "Add forecast to plan". It fails with *"The adjusted carton combination could not be placed physically – choose a smaller addition."*

**How often.** I ran random mixes on default products, pallets and containers, replicating exactly what `applyForecast` → `applyFill` sends. The re-plan failed in 124 of 264 forecasts on seed 31 and 122 of 286 on seed 5.

**Root cause.** The forecast is a valid layout: it is the planned cartons left in place plus the extra cartons, and it passes `validatePlacement`. "Add" throws that layout away and re-plans the whole combination from scratch with `optimiseMix({ fixedCounts })` → `unitPlanFor`. The from-scratch packers often can't rebuild a layout that the incremental top-up found. "What else fits" suggestions don't have this problem because each one is re-planned with `unitPlanFor` before it is offered (`fillSuggestions`, `verify`). Forecasts are never checked that way.

**Fix (prototyped).** When the fixed-count re-plan fails, fall back to the forecast's own layout:

- Build the plan from `plan.placements ∪ forecast.placements`, using the same route `assessLayout` already uses (`buildPlan` → `validatePlacement` → `assessPlan`).
- Re-index `itemIdx` by `productId`.

In the scratch harness this fallback produced a valid plan with the right counts in **246 of 246** failing cases. An alternative is to verify each forecast with `unitPlanFor` before showing the button, but that would hide forecasts that are perfectly loadable.

Where: `applyForecast` (`index.html:3829`), fixed path in `optimiseMix` (`index.html:2356`).

---

## Medium

### M1. The mix search under-fills single-SKU pallets

The Single SKU tab plans with `singleSkuPlan`, which can add **top-up layers in another orientation**. Exact Quantity and the final plan of every mode use the same planner (`unitPlanFor`). The search's feasibility check (`makeOracle` → `packCounts(ctx, n, false)`, `index.html:1358`) only tries the column-block packer and the first three layer strategies. Those can't reproduce a top-up plan, so the search never reaches the true capacity.

**Measured.** I tested 6 default and 40 random products × 5 pallets × {SKU-default, full rotation}. In 77 of 460 cases a 100% single-SKU Target Mix (Maximum Utilisation) loaded fewer cartons than the Single SKU tab, while Exact Quantity confirmed the larger number fits.

- P17C2D2, full rotation, Euro pallet: 57 vs 54.
- A random 307×350×207 mm carton: 66 vs 60.

The same mismatch breaks "What else fits" on the Single SKU tab for those products. `fillSuggestions` checks the current plan with the same feasibility check, gets "infeasible", and shows *"The current plan could not be re-planned with additional products."* (`index.html:1837`).

**Fix (prototyped).** In `packCounts`, when exactly one SKU has a non-zero count on a pallet and `best` is false, return ok if `singleCapacity(ctx, i) >= counts[i]`. That is the same planner `unitPlanFor` uses. With this four-line change the mismatches drop from 77 to **0**, the fill note disappears, and the self-tests still pass 61/61.

### M2. Import accepts duplicate product IDs, so deleting one deletes others

`sanitizeProduct` keeps the file's `id`, and `importData` never checks that IDs are unique. Delete in the Product Master filters by `id` (`index.html:4307`), so it removes every product sharing that ID.

**Reproduced.** I imported BOX-A and BOX-B, both with `id: "p-1"`. Deleting BOX-A left neither.

The same import also accepted "BOX-A" and "box-a" as two SKUs. The Product Master form rejects that combination (case-insensitive check), so the two entry paths apply different rules. Duplicate IDs also make `productById` and the colours ambiguous.

**Fix.** In `importData`:

- Give any repeated `id` a fresh one.
- Run `MASTERS.products.validate` (which includes the SKU uniqueness check) instead of `Engine.validateProductRecord` only.
- Do the same for pallet and container IDs.

### M3. The forecast overlay hides real cartons in the side elevation

`elevationSVG` draws planned cartons nearest-first (painter's order), then draws **all** forecast cartons on top regardless of depth (`index.html:3272`). With forecast on, a forecast carton behind a real carton covers it.

**Example.** On pallet 2 of the default Exact Quantity example, the two real cartons (stack 370 mm) disappear completely behind the hatched forecast column.

**Fix.** Put forecast boxes into the same `nearest` map and depth-sorted list as planned cartons. Draw each one hatched in its sorted position.

### M4. Saved plans store forecast cartons uncompressed

`compactPlanData` packs `plan.placements` into arrays, but `sc.forecast.placements` / `u.forecast.placements` are saved as full objects with about 17 fields each. Measured saved-plan size (JSON characters):

| Plan | Saved | Of which forecast |
|---|---|---|
| Mix, 6 SKUs, pallet | 30 KB | 1 KB |
| Mix, 3 SKUs, 40′ HC | 192 KB | 80 KB |
| Mix, 2 SKUs with max cartons, 40′ HC | **1,638 KB** | **1,609 KB** |
| Multi, 6,000 cartons, 40′ HC | 312 KB | 96 KB |

The 1.6 MB case is over the 1 MB cut-off, so it is saved as "inputs only", although its real layout is about 30 KB.

**Fix.** Compact forecast placements with the same packer. Alternatively, drop `forecast` (and `fill`) when saving and recompute them on load; both are cheap on pallets.

### M5. CI: a pull-request run can cancel a production deploy

`pages.yml` sets workflow-level `concurrency: { group: pages, cancel-in-progress: true }` for both `push: main` and `pull_request`. Every run shares the one group, so:

- Pushing to any PR cancels an in-progress `main` test-and-deploy.
- Two PRs cancel each other.

**Fix.** Move `concurrency` onto the `deploy` job (`group: pages`, `cancel-in-progress: false`, as GitHub's Pages starter does). Optionally give the test job `group: test-${{ github.ref }}`.

---

## Low

- **L1. 3-D "current step" highlight.**
  - **Problem:** `render()` checks `state.seqMax < scene.boxes.length` (`index.html:3519`), but `boxes` also contains the hidden forecast boxes. Whenever a plan has a forecast, the last loaded carton gets the thick yellow "current step" outline even when "All N cartons shown". Confirmed by pixel count (732 highlight pixels with the whole load shown) and screenshot.
  - **Fix:** compare against `scene.seq.length`.
- **L2. Phantom saved plan.**
  - **Problem:** `savePlan` adds the record to `DB.plans` before persisting (`index.html:4410`). If both save attempts fail, the toast correctly says "Could not save…", but the plan stays in the Saved Plans list until reload.
  - **Fix:** `DB.plans.shift()` on failure, as `plan-dup` already does.
- **L3. Malformed imported plan crashes the page.**
  - **Problem:** `sanitizePlan` copies `inputs` as-is. A plan whose `inputs.rows` isn't an array throws `mixRows.map is not a function` on Load (`index.html:4353`) and leaves the mix table broken until reload.
  - **Fix:** sanitise `inputs` field by field (arrays of plain rows with known keys), or wrap `setInputs` in try/catch with a message.
- **L4. First print may miss the 3-D picture.**
  - **Problem:** `printReport` inserts the snapshot `<img>` as a data URL and calls `window.print()` straight away (`index.html:4565`). On the first print of a plan, the image had `complete === false` and `naturalWidth === 0` at that moment. Repeat prints were cached.
  - **Fix:** `await img.decode()` before printing. Also clear `#print-report` on `afterprint`; it keeps about 140 KB of SVG and image markup alive.
- **L5. Overhang wording.**
  - **Problem:** The warning says *"bottom-layer cartons may extend up to N mm"* (`index.html:1627`), but both packers apply the overhang region to every layer. P24C2D2 on a Euro pallet with 50 mm: 27 of 36 cartons overhang, in layers 1–3.
  - **Fix:** either reword it ("cartons in every layer may extend…") or restrict upper layers to the deck. See question 1.
- **L6. Threshold inputs.**
  - **Problem:** The only check is `v > 0` (`index.html:3079`). Entering 58 instead of 0.58 for "top-heavy" silently disables that check, and space thresholds above 100% are accepted.
  - **Fix:** add range checks per field.
- **L7. Stale documentation.**
  - "Dominance pruning" was removed in v1.3 but is still described in the README (line 58), the mix details panel (`index.html:4045`) and the Method panel (`index.html:4623`).
  - README sizes: `index.html` is now 353 KB / 104 KB gzip (README says 323 / 96 KB).
  - The performance table measures the engine without the "what else fits" and forecast steps that the UI always runs (see the performance section).

---

## Performance and memory

Measured in Node 22, calls made exactly as the UI makes them (`fillProducts` = active products):

| Case | Time | Without fill/forecast |
|---|---|---|
| Single SKU, pallet | 0.06 s | 0.002 s |
| Mix, 6 SKUs, pallet | 0.31 s | 0.18 s |
| Mix, 4 SKUs, 40′ HC, 5 mm clearance | 0.65 s | 0.13 s |
| Multi, 6,000 cartons, 40′ HC | 0.61 s | 0.22 s |
| Single 20×15×10 cm carton, 40′ HC (24,440 cartons) | 1.5 s | 0.9 s |

- **Memory:** the page heap stayed flat across 12 repeated calculations (3.2 → 3.4 MB). Peak Node RSS for the whole benchmark was 158 MB. No leak found.
- **P1. Grid look-ups (`makeGrid().query`, `index.html:1395`).** De-duplicating with a `Map<object, stamp>` takes about 330 ms of the 0.97 s in the 24k-carton case (CPU profile), with `validatePlacement`, `buildPlan` and `stabilityInfo` making up most of the rest. Each 2-D cell holds a whole stack, about 26 cartons. A per-placement integer stamp in an `Int32Array` (indexed by id), or a 3-D cell key, would remove most of it.
- **P2. `forecastFor` (`index.html:1880`).**
  - `restsOn` filters every carton at a level for every carton above it (O(n²) per level, `index.html:1899`).
  - `freeSpaceFromSupport` (`index.html:867`) calls `support.some()` for every grid cell.
  - Both are fine on pallets but cost about 0.5 s on large containers. Reuse the `makeGrid` index.
- **P3. Duplicate scenario forecasts.** `fillSuggestions` is cached per scenario key, but `forecastFor` is recomputed for identical scenarios (`index.html:2367`). Duplicates are common; in Test A all three scenarios are the same 24/24. Cache it by `sc.key` too.
- **P4. Uncached feasibility checks.** `analyseConstraints` calls `packCounts` directly (`index.html:2427`) instead of the cached oracle: S × 3 extra packings per optimisation.
- **P5. CI time.** The fuzz test's independent checker is O(n²) (`tests/fuzz-tests.mjs:41`, `:57`). With six seeds, the 150-case run took 47–251 s, while no single engine call took over 1.2 s. A spatial hash keeps the checker independent and makes it near-linear: the extended fuzz below checks about 400 plans in about 45 s.
- **P6. Unbounded scenario list.** Every "Add to plan" appends another full scenario (plan, fill and forecast) to `S.mix.res.scenarios`, and all of them go into saved plans. Consider replacing the previous adjusted plan rather than stacking them.
- **P7. Node 20 in CI.** The workflow pins Node 20, which reached end-of-life in April 2026. Move to Node 22 or 24 and current major versions of the `actions/*` steps.

---

## Checked and found sound

- **Self-tests:** 61/61 pass.
- **Repository fuzz:** 0 failures with 6 seeds × 150 cases.
- **Extended fuzz** (my own harness with an independent, spatially indexed checker), covering combinations the repository fuzz never generates:
  - non-supporting and fragile cartons;
  - container top clearance;
  - overhang combined with clearance;
  - locked, minimum and maximum rows;
  - pallets → container, including stacking and its forecast.

  Result: 1,350 cases, 2,845 plans, 2,106 forecast overlays and 167 pallets-in-container plans checked, **0 failures**.
- **Container consistency:** Single SKU, Exact Quantity and Target Mix agree on container capacity in all 276 product/container/orientation cases.
- **Reproducibility:** the search uses wall-clock budgets (exact enumeration, pinwheel patterns). Simulating a 12× slower PC changed none of 40 random mix results.
- **Security:** every user or file string reaches the DOM through `esc()` or `textContent`. CSV cells starting with `= + - @` are neutralised. Imported records are rebuilt field by field; the exceptions are M2 and L3 above.
- **ESLint:** no real errors. Only unused `catch` variables and one unused local (`c` in `validatePlacement`).
- **Default Exact Quantity example:** 35 cartons on Industrial gives 33 + 2, with a second pallet for 2 cartons. This is the engine's maximum (no 34-carton subset fits), so it is not a bug. A dedicated "rebalance the last pallet" pass would be a feature.

## Questions for the owner

1. **Overhang:** should overhang apply to the whole stack (current behaviour), or only to the bottom layer, as the warning text says?
2. **Fixes:** should I implement them? Suggested order: H1, M1, M2, M5, M3/L1, M4, then the rest. Each would come with a regression test.
3. **"Max stack weight":** it is stored on every product but never enforced. Is it still planned, or should the field be hidden for now?
4. **README performance table:** should it show the times as the UI actually runs them (with "What else fits" and forecast), as in the table above?
