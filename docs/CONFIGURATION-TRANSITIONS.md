# Configuration transition prototype

Open **Configuration transitions** from the sidebar. The prototype plans general configuration changes across a selected fleet, including drives, front bays, cages, adapters, controllers, RAM and other catalog hardware and exports proposed draft configurations, an order estimate, and rollout waves. It is a planning workflow: it does not change live configurations or PC assignments, reserve inventory, place orders, or perform migration.

## Workflow

1. **Scope the fleet.** Select one or multiple source configurations, optionally restrict to an installation hierarchy or PCs whose baseline includes an HDD, and select the exact PCs. Filters do not silently change selected IDs. **Review selected PCs** shows the selected fleet across scope filters so individual selections can be removed. Retired and parts-only PCs are excluded from matching results. Imported or previously selected inactive/deleted PCs become blockers. The limit is 500 selected PCs. **Show selected PCs hidden by filters** reviews hidden selections; **Remove unavailable PCs** clears missing, retired or parts-only selections together. **Edit survey** and **Edit selected PCs** open the normal individual or bulk editor without leaving the plan.
2. **Establish the baseline.** PCs with an explicit incomplete hardware survey use their documented assumed current configuration, even after some parts are recorded. A missing assumption or evidence blocks planning; recorded quantities exceeding the assumed model quantities block until the assumption is revised or the survey is completed. Fully recorded surveys use installed allocations exclusively and cannot fall back to an estimate. PCs without an explicit survey retain the legacy behavior: any installed allocations take precedence; otherwise the linked configuration supplies a clearly marked estimate. Missing installed storage settings block planning. Variations in hardware, routing, pinned requirements, or capacity minimums form separate cohorts, even when PCs share a source configuration.
   **Recover after a correction.** A changed baseline may form a new planning group. **Reuse available group inputs** previews and copies a destination and matching capacity inputs from a previously configured group. It preserves entered values, checks drive models/counts, roles and RAID before offering measurements, and keeps destination mappings separate when destinations differ. Confirm that the displayed source evidence covers the receiving PCs, then review the whole plan again.
3. **Set capacity assumptions.** Each cohort is split into boot, named/default data arrays, and general storage segments. With no measurement, retain the segment's recorded usable capacity. To investigate downsizing, enter the largest measured used capacity across every PC in that cohort, plus measurement source/date. A shared measurement must cover the entire cohort. Split the scope into separate plans when usage differs substantially.
4. **Choose a destination or SSD assistant.** New plans default to **Destination configuration (all hardware)**. Create or duplicate a configuration in the existing builder, engineer and save its full layout, then select it for each cohort. **Apply to all groups** sets a common destination in one action; individual groups can override it. Map each source storage segment to a destination segment of the same role. Identical segment IDs default to matching; renamed or reorganized arrays require an explicit mapping. When several source arrays map to one destination array, their required capacities are summed. Complete destination compatibility, its own requirements, captured PC requirements and installation requirements are checked independently. Non-approved destinations and changed equipment systems require handoff review. For a simple drive-only swap choose **SSD replacement assistant**.

   **Compare SSD models in the assistant.** Choose a catalog SSD for each segment, or use **Suggest SSDs**. Suggestions prefer retaining a usable existing SSD model, then the smallest individually eligible capacity; free stock breaks capacity ties. Compare interface, form factor, per-drive and usable capacity, available units, and compatibility findings. Review the complete combination after making choices.
5. **Review procurement.** Review per-PC targets and blockers, then review the pooled parts demand. The review initially focuses on blocked PCs and expands their findings, with direct survey editing and removal actions. Both fleet order totals appear above a compact comparison table. **Filter purchases using** switches between confirmed stock and assumptions confirmed; clear **Only parts to order** to inspect all components. Expand **Stock breakdown** for per-model arithmetic. The CSV always includes the full calculation. An order CSV requires a current review and no blocked PCs. A file containing a partial plan can still be saved, but blocked PCs are excluded from its estimate and have no proposed target configuration.
6. **Plan the rollout.** Choose representative pilot PCs, migration approach (including **Hardware change only** for changes without data migration), wave size, maintenance owner/window, and rollback/removed-parts disposition notes. Included PCs are grouped into a pilot and successive waves. Waves do not consume stock or execute work; procurement remains pooled across the entire included fleet.
7. **Save and hand off.** Save the versioned JSON plan beside the portable workspace and export the order CSV. Reopen the plan and review against current stock before purchasing or reserving parts. Plan files are external portable artifacts; workspace database backups do not automatically include them.

## Capacity model

All capacities are decimal GB, matching existing catalog and compatibility calculations. RAID usable capacity is computed from the smallest member for mirror/parity arrays: mirror uses one member, RAID 5 uses `n − 1`, RAID 6 uses `n − 2`, and RAID 10 uses `n / 2`. Independent drives sum their capacities. Named arrays remain separate from ungrouped storage even when a named array uses the ID `default`. Invalid layouts and missing/nonpositive capacity remain unknown, rather than becoming zero.

Measured capacity uses:

```text
required usable GB = ceil(measured used GB × (1 + growth % / 100)
                          / (1 − free-space reserve % / 100))
```

Pinned boot and data minimums from both the PC/build configuration and its physical installation still apply. Both sets of engineering requirements are checked independently. Measurements above known current usable capacity are blocked until the baseline is verified. A measurement without evidence/date is blocked.

A usage-based size estimate does not establish whether a filesystem, partition layout, bootloader, RAID implementation, application workload, or image can actually shrink or migrate. Review those constraints, SSD endurance/performance and manufacturer support, and verify backups before accepting the pilot.

## Compatibility and catalog classification

`specs.storageMedium` is an optional `HDD`/`SSD` field available in the Drive catalog form, JSON and CSV. Existing records remain valid without it. Unknown media is deliberately not inferred from product names or SATA/NVMe; unclassified drives are excluded from the HDD filter and SSD candidates. The transition screen offers links to classify them. New illustrative seed drives carry explicit media classifications; existing workspaces are not rewritten.

The SSD assistant preserves drive quantities, redundancy layouts, placement identities, mount assignments, controllers, named targets and SATA wiring. Replacements run through the existing compatibility engine, including bays, M.2 slots/lengths, controller/boot routing, lanes, power and pinned requirements. An individually eligible option can still conflict with another array's choice; the full target is checked again. Unverified specifications and compatibility uncertainties are reported as review notes, not a guarantee of fit.

Destination mode supports new adapters, controllers, bay cages, drive quantities and storage layouts through an existing saved destination configuration. The planner does not guess missing mounting hardware or generate wiring. Review the engineered placements and manufacturer specifications before execution. Per-PC exported proposals are drafts, and are not automatically approved or applied.

## Stock model

For each target component model across all included PCs (only disks in SSD assistant mode):

```text
new units = target units − usable retained installed units − usable held reservations
spares = ceil((target units − retained installed units) × spare % / 100)
order units = max(0, new units + spares − free serviceable stock)
```

- Destination mode retains serviceable installed parts by component model within each PC, consuming each installed quantity once even when destination placement IDs differ. Reusing a part can require relocation and rewiring; the plan explicitly requires placement, bay, adapter, controller and connection review. The SSD assistant requires the same installed position. A template alone never establishes ownership.
- Matching serviceable reservations held for the selected PC are consumed once by component model. The SSD assistant also requires matching role and storage group. Unused reservations are flagged for release/reassignment review and remain excluded from free stock. Physical placement still needs verification during installation.
- Free stock is shared once across all cohorts and excludes every current reservation/installation, including those belonging to unselected PCs.
- Quarantined, repair and retired stock are unavailable. Installed non-serviceable parts block the affected PC.
- Parts removed during migration are not counted as immediately available stock.
- Blocked PCs contribute no demand. The screen explicitly labels this partial estimate; CSV export remains disabled until every selected PC is resolved.
- Configuration-only estimates contribute provisional demand; their stock ownership and actual hardware must be verified before purchase. Explicit, documented survey assumptions additionally show **Possible assumed reuse** and **Order if assumptions confirmed**. Assumed model quantities minus actually recorded installed quantities bound that reuse, and each unit is counted once. Confirmed-stock orders remain conservative; the conditional estimate recalculates spares after possible reuse. Neither estimate credits removed parts as available stock. Reservations and shared free stock are applied once within each alternative estimate.

No inventory is reserved by the plan. Two plans can independently estimate the same free pool. Reopen and review the chosen plan against current records, then use the existing inventory operations to reserve its stock.

## Workspace plans and draft recovery

Save a named plan directly in the workspace, or let valid edits autosave as a draft after a short pause. The Saved workspace plans picker opens the latest draft when available; Open saved inputs returns to the last explicitly saved version. Resume latest draft recovers unfinished work after a reload. Save plan in workspace accepts the current inputs and clears that plan’s draft. New plan starts a separate record; Delete workspace plan removes both its saved inputs and draft after confirmation.

Plans live in the workspace SQLite database, and JSON backups include an optional `transitionPlans` collection. Copying a closed workspace directory or restoring its JSON backup preserves them. Legacy backups remain supported and restore with no plans; a safety backup retains the current plans before replacement. Rolling record backups include plans too. User appearance settings stay outside workspace backups.

Plan saves use their own revisions, so autosaving does not invalidate a hardware review. Conflicting saves in another window are rejected. Export the current plan file before reopening a newer shared plan if you want to retain your local changes. Invalid inputs pause autosave and remain protected by navigation/close guards; the last valid draft stays available. Plan writes are limited to 2 MiB per plan and 500 plans per workspace.

## Portable files and revision review

A JSON plan contains `version: 1`, the validated scenario, workspace revision, generation time, whether it was reviewed, and a report containing per-PC draft proposals, procurement and rollout waves. Scenario inputs contain explicit IDs, cohort/segment assumptions, growth/free-space/spare percentages and rollout notes. Older version-1 SSD plans without a mode field open in SSD mode; new plans explicitly record their mode, destination mappings and storage mappings. Files are limited to 20 MiB on import; unknown scenario fields and unsupported versions are rejected.

Imported reports are not trusted as current results: the app recomputes from live workspace data and requires a new review. Changing the scenario or workspace invalidates the reviewed fingerprint. A changed workspace revision is visibly flagged. Missing IDs and changed hardware are re-evaluated; cohort policies no longer matching the baseline require new destination or SSD choices. Drafts have navigation and browser-close guards. Exported plan files belong with app data, not the user's appearance settings.

The order CSV is spreadsheet-safe and includes component, category, interface, form factor, capacity, target/retained/possible assumed reuse/reserved/spare/free/order units and the conditional order if assumptions are confirmed. The spare column belongs to the conservative confirmed-stock estimate.

## Execution stages after prototype review

Approve a destination configuration, identify required adapters, validate backup and rollback, reserve/order stock, and schedule a pilot. Replace hardware through the existing inventory operations so stock balances and movement history remain auditable. Record actual placement/identities and the intended configuration assignment. Validate software, hardware, capacity and data, then recommission before return to service. Accept the pilot before continuing through later waves and disposing of removed parts.

A later version can compare alternative destinations, assign immutable stock reservations to waves, and track pilot acceptance and per-PC execution progress. These need lifecycle and inventory command integration rather than a blanket configuration-ID overwrite.
