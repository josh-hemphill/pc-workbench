# Synthetic import workflow review

Reviewed 2026-10-21 using eight fictional starting datasets in isolated temporary workspaces. The reusable [fixture guide](../examples/synthetic-workflows/README.md) explains manual import and the two test runners. No existing user workspace was imported into or modified.

## What was checked

The public HTTP integration suite runs every scenario through whole-workspace restore and staged CSV imports, compares the resulting records, reuploads unchanged CSVs, persists and reopens plans, and round-trips JSON backups. Additional cases exercise registration, spreadsheet delimiters and headers, reimport after deleting all locations, invalid imports, stale revisions, survey recovery, stock pooling, capacity requirements, physical enumeration and commissioning.

The browser replay restores the datasets through Data & imports, opens their saved plans and checks findings and order-export availability. It also follows a PC link and browser Back, corrects a contradictory assumption in the normal PC editor, resolves unknown-capacity planning with a measured usage input and sufficient destination, checks selection across fleet pages and filters, reloads an autosaved draft, previews rejected/valid CSVs, and registers devices at imported locations.

## Expected results and recovery

| Dataset | Initial included / blocked | Observed recovery or invariant |
| --- | --- | --- |
| Locations only | 0 / 0 | Four selected benches can receive explicit device records; no parts are fabricated; site rows cannot receive PCs |
| Legacy linked plans | 4 / 0 | Planning remains provisional; bulk-recording documented assumptions enables conditional reuse |
| Assumed fleet | 6 / 0 | Both current hardware sources are planned; navigation returns to the selected fleet; planning leaves records unchanged |
| Partial contradiction | 2 / 1 | Correct the RAM assumption and configure its new planning group; all three become plannable. Operational receipt/install, complete survey and commissioning succeed |
| Stock pressure | 2 / 0 | Exactly 2 SSDs, 1 cage and 2 RAM modules to order. Outside reservations and unusable stock stay unavailable. Explicitly selected inactive PCs block without increasing demand |
| Unknown capacity | 1 / 2 | Measured usage plus the larger SSD destination resolves both blockers while preserving the pinned 6 TB minimum |
| Survey gaps | 0 / 4 | Explicit survey/assumption/evidence updates resolve all four; the location's target never substitutes for current hardware |
| Fleet scale | 120 / 0 | All 120 active PCs are selected across pages. Site A contains 63 active candidates; all 120 explicit selections remain, with 57 hidden. Draft recovery retains the scope |

Duplicate location IDs, missing parents, invalid survey states and inventory overallocations fail both preview and apply. No collection or workspace revision changes on rejection. A valid location export can be reimported after all old locations are removed. Reimporting unchanged files is a no-op.

## UX improvements implemented after review

- Both fleet order totals are visible above the table: one using confirmed stock, one conditional on hardware assumptions. The compact comparison has five columns, with expandable per-row stock arithmetic. Purchase filters can use either estimate; CSV exports retain the complete calculation.
- Hardware corrections can reuse available group inputs with an explicit action. The preview identifies the source group, destination, usage and evidence. Existing entries are preserved. Measurements copy only for matching drive models/counts, array roles and RAID; mappings do not cross different destinations. Requirements and compatibility are still checked, and a fresh review is required.
- Survey edits and bulk PC edits are accessible directly from the planner. Blocked PCs appear first by default, with their findings expanded, and findings can be searched. PC details remain available through the name link.
- Missing, retired and parts-only selections can be removed together. Hidden selections have a direct review action. Export requirements are stated beside the disabled export control.
- Registration reports which selected locations were skipped and why. Eligible locations can be unchecked before saving. Survey forms explain which missing inputs prevent planning while still allowing incomplete device records to be saved.
- Empty fleets link to installation locations so users can register known devices before planning.

Legacy linked plans deliberately retain conservative full-parts estimates until a documented current-hardware assumption is recorded. Reusing a measurement is an explicit proposal: its evidence still needs to cover the receiving group. No inventory is created by estimates or copied inputs.

The tested recovery paths complete. This is functional coverage of these inputs, not a performance benchmark or validation of real manufacturer specifications. The largest exercised fleet is 125 registered PCs / 120 active PCs; the application's 500-PC planning limit was not stress-tested here.

## Validation

- `pnpm fixtures:workflows --check`: generated JSON and CSV files match their source definitions.
- `pnpm test`: 461 passed, zero failed and one existing skip; the synthetic import suite contributes 15 tests, with six additional input-reuse regression tests.
- `pnpm build`: type checking, frontend and backend builds pass. The existing frontend chunk-size warning remains.
- Optional Chromium replay: scenario review/export paths, import/registration, navigation, blocker recovery and draft reload pass. Artifacts are written to the runner's temporary output folder.
