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

## Workflow observations

- Correcting a current-hardware assumption changes its planning group. The affected group needs a destination and usage inputs again. This preserves review of the changed hardware, but adds work during a survey. The fixture guide documents that step, and the browser replay exercises it.
- Legacy PCs receive a conservative full-parts estimate until someone records an explicit, documented hardware assumption. This is intentional: their linked build plan alone cannot establish ownership or possible reuse.
- The procurement table is wide. At desktop widths, the conditional order columns may require horizontal scrolling. A useful future simplification would show both fleet order totals beside the review summary, so the distinction is visible before opening the full stock calculation.
- “Only parts to order” follows the conservative order, so it can show unchanged but unrecorded hardware even when its conditional order is zero. The two columns explain the difference; a conditional-estimate filter could make review faster.

No new application defect was demonstrated by these scenarios. The expected blockers remained actionable, and the tested recovery paths completed. This is functional coverage of these inputs, not a performance benchmark or validation of real manufacturer specifications. The largest exercised fleet is 125 registered PCs / 120 active PCs; the application's 500-PC planning limit was not stress-tested here.

## Validation

- `pnpm fixtures:workflows --check`: generated JSON and CSV files match their source definitions.
- `pnpm test`: 455 passed, zero failed and one existing skip; the new synthetic suite contributes 15 tests.
- `pnpm build`: type checking, frontend and backend builds pass. The existing frontend chunk-size warning remains.
- Optional Chromium replay: scenario review/export paths, import/registration, navigation, blocker recovery and draft reload pass. Artifacts are written to the runner's temporary output folder.
