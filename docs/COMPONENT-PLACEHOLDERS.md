# Proposed handling of imported catchall components

Examples such as **Unknown RAM** and **Unknown Intel CPU** represent unresolved identities. A shared catchall may cover several real models. This is different from a known part that is missing specifications, or an intentional manufacturer product family.

The catalog currently has model/family metadata and verification status, but no explicit placeholder classification or selective stock-identification action. The approach below is a proposal; the catalog tab-count change does not automatically classify or resolve imported names.

## Recommended workflow

1. **Mark the identity as a placeholder.** Add an explicit identity state rather than deriving it from the display name or an empty model field. Names containing “Unknown” can be suggested for review during import; a user confirms the classification. Existing records remain valid, and names are preserved.
2. **Record only facts that apply to every represented part.** “Intel” may be known for every use of Unknown Intel CPU. Socket, core/thread count and power remain unknown until evidenced. A PC's total RAM does not establish the capacity, count or technology of its individual modules. Record machine-specific observations in its survey/assumption context, rather than changing a shared catchall for every PC.
3. **Request identification before model-specific enrichment.** Keep placeholders visible in Missing data, with an “Identity needed” reason and a distinct filter. The next action should request evidence such as an asset/part label, CPU identification, memory SPD or an inventory report tied to a PC. Ordinary product-page enrichment must wait for identification; a research agent should never pick a plausible model from a generic name. Offline research handoffs should describe the identity gap and request observations instead of proposing guessed specifications.
4. **Resolve selected uses.** An Identify/resolve action should select the affected PC placements, allocations or stock quantity, then choose an existing exact model or create one. Different discovered models are resolved separately; remaining unknown uses retain the placeholder. Duplicate a shared configuration when only some PCs differ, rather than changing their shared template globally.
5. **Retire the catchall when its last live use is resolved.** Empty inventory can be archived with its history, then the unused placeholder can be deleted. Historical approvals and commissioning snapshots retain the original data.

## Inventory and planning rules

Selective identification needs an audited inventory operation. Current stock editing deliberately prevents changing a stock record's component type, and the existing catalog merge rewrites references globally. Neither should be used to silently reclassify a heterogeneous unknown lot.

The identification operation should conserve total quantities, handle selected installed/reserved allocations explicitly, preserve serials and movement history, and validate the resulting bindings. A mixed bulk lot may need to split into several identified lots plus an unresolved remainder. Changed hardware identities should trigger the existing configuration/commissioning review rules; accepted historical snapshots stay intact.

Planning should continue to support incomplete surveys and documented assumptions. Known constraints can inform estimates, but unresolved identities must stay visible as uncertainty. A placeholder must not become a model-specific purchase recommendation or verified compatibility claim merely because it has been used in several configurations.

Use the existing global merge only when **every affected use is confirmed to represent the same exact model/variant**. For example, a misspelled model imported under two names can be merged after review. “Unknown RAM” covering several real module models requires selective identification.

## Suggested implementation scope

- Optional, portable identity classification on component records, editable individually and in bulk; include it in CSV, backups and research metadata.
- Identity-first Missing data entries and research/export/enrichment safeguards for explicitly marked placeholders.
- A previewed, audited Identify/resolve operation with selected-reference/quantity scope and a clear unresolved remainder.
- Tests for several models sharing one catchall, partial lot resolution, installed/reserved parts, quantity conservation, historical snapshots and stale revisions.
