# Synthetic workflow imports

These fixtures are fictional and deterministic. Use a disposable workspace: restoring a JSON workspace replaces its records. The automated runners create and remove their own temporary workspaces and settings files.

For the quickest manual review, open **Data & imports → Restore a whole workspace**, choose a scenario's `workspace.json`, validate the counts, then restore. Open **Configuration transitions** and select that scenario's saved plan. Review it against the imported workspace; the deliberately stale revision requires a fresh review before order export.

To exercise incremental imports instead, restore the same scenario's `catalog.json`, then preview and apply its CSVs in order: `installationLocations.csv`, `pcs.csv`, `inventory.csv`. Empty CSVs contain only their header. Open `transition-plan.json` through **Open plan file**. Restoring `workspace.json` and importing the staged files should produce identical records. `catalog.json` contains the component types, configurations and requirements needed by that scenario, including any deliberately unknown specifications.

| Scenario | Starting condition | Initial planning result | Recovery / next step |
| --- | --- | --- | --- |
| `01-locations-only` | Two sites and four benches; no PCs or stock | No devices are silently invented | Register known devices at selected benches and document their current hardware assumption |
| `02-legacy-plans` | Four PCs with linked configurations; no survey fields or installed stock | Four provisional PCs; no assumed reuse credit | Bulk-record a current assumption and evidence to see conditional reuse |
| `03-assumed-fleet` | Six inaccessible PCs across HDD and mixed-drive configurations | Six plannable, provisional PCs | Compare confirmed-stock and conditional orders; follow PC links and return to the plan |
| `04-partial-conflict` | Three partial surveys; the third records three RAM modules against a two-module assumption | Two included; one blocked | Set PC 003's assumption to the three-DIMM variation; choose its new group's destination and reenter usage evidence; enumerate parts and complete the survey |
| `05-stock-pressure` | Recorded hardware, selected/outside-scope reservations, quarantine/repair stock, inactive PCs | Plan selects the first two PCs; order **2 SSDs, 1 cage and 2 RAM modules** | Confirm free stock is pooled once, unusable lots stay excluded, and explicitly selected inactive PCs block |
| `06-unknown-capacity` | Unknown source capacity, missing usage measurement, a pinned 6 TB requirement | One included; two blocked | Record usage for the pending-capacity group and apply the high-capacity destination to all groups |
| `07-survey-gaps` | Missing assumption, missing evidence, empty completed survey, unlinked legacy PC | Four blocked despite each location having a destination target | Bulk-record an uninspected survey with the HDD assumption and evidence |
| `08-fleet-scale` | 125 PCs, 120 active; two sites and repeated bench labels | 120 plannable PCs | Select across pages; filter Site A to 63 candidates while retaining 120 explicit selections; save/reload the draft |

The standard conversion replaces data drives, adds a front bay cage, and increases memory. Capacity policies use fictional measurements of at most 1,000 GB per PC. Specifications and measurements here are test inputs, not real hardware evidence.

`rejected-imports/` contains duplicate location IDs, a missing parent, an invalid survey state and overallocated inventory. Each must fail preview and apply without changing any records. Do not treat them as valid recovery data.

## Reproduce and extend

Use the repository's pinned Node 26 and pnpm 12 versions.

```sh
pnpm fixtures:workflows          # regenerate the 53 JSON/CSV files
pnpm fixtures:workflows --check  # detect fixture drift without writing
pnpm test                       # includes tests/synthetic-workflows.test.ts
pnpm build
```

The generator is `tools/synthetic-workflows/scenarios.ts` plus `generate.ts`. Change those sources and regenerate, rather than editing generated CSV/JSON by hand. Expected blocker counts and procurement assertions are specified independently of the planner's results.

An optional real-browser replay requires Python's Playwright package and Chromium, in addition to the built application:

```sh
python3 tools/synthetic-workflows/browser.py --node /path/to/node --chromium /path/to/chromium
```

The runner restores every scenario through the UI, reviews blockers and exports, exercises PC navigation, repairs a partial assumption and unknown capacity, checks fleet pagination/draft recovery, and imports rejected/valid CSVs before registering known devices. It writes screenshots, order CSVs, a server log and `results.json` under the system temporary directory's `pc-workbench-synthetic-browser` folder. `--output` selects another artifact directory. It never connects to a running user workspace.

See [test findings](../../docs/SYNTHETIC-WORKFLOW-REVIEW.md) for observed results and workflow limits.
