# Imported catchall components and selective identification

Examples such as **Unknown RAM** and **Unknown Intel CPU** represent unresolved identities. A shared catchall may cover several real models. This is different from a known part that is missing specifications, or an intentional manufacturer product family.

The catalog supports an explicit, optional `identityKind` (`model` or `placeholder`). Missing classification preserves existing behavior. Names and blank model fields never automatically classify a record; the editor suggests reviewing names containing “Unknown”. The classification is portable in backups and component CSVs, including preservation when importing an older CSV without that column.

## Recommended workflow

1. **Mark the identity as a placeholder.** Add an explicit identity state rather than deriving it from the display name or an empty model field. The editor suggests reviewing names containing “Unknown”; a user confirms the classification. Existing records remain valid, and names are preserved.
2. **Record only facts that apply to every represented part.** “Intel” may be known for every use of Unknown Intel CPU. Socket, core/thread count and power remain unknown until evidenced. A PC's total RAM does not establish the capacity, count or technology of its individual modules. Record machine-specific observations in its survey/assumption context, rather than changing a shared catchall for every PC.
3. **Request identification before model-specific enrichment.** Keep placeholders visible in Missing data, with an “Identity needed” reason and a distinct filter. The next action should request evidence such as an asset/part label, CPU identification, memory SPD or an inventory report tied to a PC. Ordinary product-page enrichment must wait for identification; a research agent should never pick a plausible model from a generic name. Offline research handoffs should describe the identity gap and request observations instead of proposing guessed specifications.
4. **Resolve selected uses.** An Identify/resolve action should select the affected PC placements, allocations or stock quantity, then choose an existing exact model or create one. Different discovered models are resolved separately; remaining unknown uses retain the placeholder. Duplicate a shared configuration when only some PCs differ, rather than changing their shared template globally.
5. **Retire the catchall when its last live use is resolved.** Empty inventory can be archived with its history, then the unused placeholder can be deleted. Historical approvals and commissioning snapshots retain the original data.

## Inventory and planning rules

Selective identification needs an audited inventory operation. Current stock editing deliberately prevents changing a stock record's component type, and the existing catalog merge rewrites references globally. Neither should be used to silently reclassify a heterogeneous unknown lot.

The identification operation should conserve total quantities, handle selected installed/reserved allocations explicitly, preserve serials and movement history, and validate the resulting bindings. A mixed bulk lot may need to split into several identified lots plus an unresolved remainder. Changed hardware identities should trigger the existing configuration/commissioning review rules; accepted historical snapshots stay intact.

Planning should continue to support incomplete surveys and documented assumptions. Known constraints can inform estimates, but unresolved identities must stay visible as uncertainty. A placeholder must not become a model-specific purchase recommendation or verified compatibility claim merely because it has been used in several configurations.

Use the existing global merge only when **every affected use is confirmed to represent the same exact model/variant**. For example, a misspelled model imported under two names can be merged after review. “Unknown RAM” covering several real module models requires selective identification.

## Implemented behavior

- Optional, portable identity classification on component records, editable individually and in bulk; include it in CSV, backups and research metadata.
- Identity-first Missing data entries and research/export/enrichment safeguards for explicitly marked placeholders.
- **Identify uses** is available on placeholder rows in Components and Missing data. Choose a same-category existing component with an exact model / part number, or create one using the normal component editor. Enter identification evidence, then select configuration placements, PCs and physical stock. Search uses by PC, configuration, stock tag or location; filtering preserves selections. Preview shows affected PCs, quantities and unresolved stock; any edit invalidates the preview. Apply requires the reviewed workspace revision and preview token.
- Whole reserved/installed allocations retain their IDs, state, wiring and history. Partial bulk stock creates linked transfer-out/in movements with signed quantities; the source retains its original movement history. Serialized units keep their stock ID, serial and asset tag. Unallocated quantities are available for identification even on quarantined stock; this operation does not change condition.
- Configuration changes are either explicit shared-template edits or copies for selected PCs. Copies start as drafts without inherited approvals; the original retains its history. A matching survey assumption follows a selected-PC copy and records the new evidence. Accepted PC snapshots are unchanged, and affected PCs receive timeline entries. Saved transition plans remain unchanged and need review against the new workspace revision.
- Referenced connector IDs must exist on the target. Placeholder-keyed software versions must be reconciled first, since their applicability cannot be inferred. An identified allocation linked to a planned placement must also identify that placement, or have its link removed beforehand.
- Placeholders cannot be marked verified, enriched through product pages, approved or commissioned. Research packs provide an identification request and no specification proposals; crafted proposals are also blocked on import. Missing data prioritizes identity gaps and offers an identity filter. Destination placeholders block procurement; source uncertainty keeps estimates provisional.

## Deliberate scope limits

Identification moves whole configuration placements and whole allocations. If one multi-unit placement/allocation contains several models, split it first using the configuration or inventory tools. This avoids inventing which physical unit owns a wiring binding. Identify different discovered models in separate operations.

Empty source lots are not deleted by identification. Use the existing archive/delete workflow once no live references remain. A global merge into an identified model requires acknowledgment that **every** affected placeholder use is that exact model; it is unsuitable for heterogeneous catchalls.

## Validation

`tests/component-identification.test.ts` covers mixed lots, staged resolution, installed and reserved allocation preservation, shared-template copies, serialized identity, historical snapshots, CSV compatibility, research safeguards, stale revisions and transaction rollback. Transition tests cover provisional baselines and blocked placeholder procurement.

After `pnpm build`, run `python tools/synthetic-workflows/identification-browser.py` with Node 26 on PATH and Python Playwright / Chromium installed. It restores an isolated fixture, checks the identity filter and verification guard, resolves a selected PC plus stock to an existing model, verifies preview invalidation, then identifies a second model through the inline editor. It never accesses the active workspace.
