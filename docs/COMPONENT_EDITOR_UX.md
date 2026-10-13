# Component data editor: UX proposal and implementation

The component editor is a catalog workspace inside a dialog. Users should find the relevant capability, select one physical record, and edit it without scrolling through every other port, slot and bay. A single Save commits the complete model; Cancel discards the draft.

The previous form mixed identity, aggregate capacities, physical endpoint catalogs, firmware and topology into one long document. Motherboard slots appeared twice: geometry first, capabilities later. Every new port added another full form. Bifurcation controls appeared even when the motherboard declared no support, and generic IDs did not help distinguish interfaces.

## Information architecture

| Section | Contents | When shown |
| --- | --- | --- |
| Basics | Model identity, category, manufacturer/source, category role, socket/memory/capacity and basic power specifications | Every component |
| Ports | Aggregate USB/Ethernet budgets, physical ports, connector/protocol/rating and optional electrical details | Port providers or categories with aggregate port fields |
| Expansion | Card requirements, motherboard slots, explicit bifurcation support, lane-sharing rules | Motherboards and expansion cards |
| Storage | One selected catalog: named M.2 slots and per-slot lengths/lanes, SATA data/power connectors, or SFF inputs/outputs | Storage providers and consumers |
| Physical | Size/clearance, mounting bays, drive positions and backplane tray routing | Chassis, backplanes and other components with applicable dimensions/bays; motherboard slots live in Storage |
| Review | Firmware/OS requirements, controller boot/hot-plug support, notes, source verification and raw JSON | Every component |

Sections adapt to category and adapter role; this is a reference editor rather than a step-by-step wizard. Users can move directly between sections. Section addresses use the editor URL (for example `#/catalog/components?edit=component&record=board-atx&section=ports`); browser Back/Forward preserves the active draft and restores the prior section and selected record. Changing category retains existing specifications. Retained fields are identified in Review and remain accessible through JSON.

## Repeated records

Ports, slots, lane rules, SATA/SFF connectors, mounting bays and drive positions use a compact searchable list and one selected record. The list shows the ID and a short capability summary, eight records per page. Desktop presents list and detail side by side. Mobile stacks a bounded list above the selected record. Only the selected record renders its fields.

New ports can be added in batches after choosing their interface type. New slots select PCI/PCIe before creation. IDs use type prefixes such as `USB_A_1`, `SERIAL_1`, `PCIE_1`, `SATA_DATA_1` and `SATA_POWER_IN_1`, with collision checks. Changing a newly generated record's type refreshes its automatic ID until the user edits the ID manually. Existing records are never automatically renamed or renumbered.

IDs used by current plans, installed hardware or same-component topology are read-only, and referenced records cannot be removed in the editor. Review JSON is also checked for removal of referenced identifiers before saving. Users first update the referencing bindings. Historical snapshots retain their own catalog; they do not prevent editing the live model.

Port electrical/pinout fields and motherboard lane rules are optional detail panels. Core connector/protocol and slot geometry stay immediately visible. SATA data and power are separate catalogs; complete named catalogs determine their aggregate counts. Switching to a count-only catalog preserves the count and is blocked while its identifiers are referenced. Existing cage/chassis examples remain available and mark the specifications unverified.

## Bifurcation

Motherboard support has three explicit states: Unknown, Supported and Not supported. Slot-specific modes are shown for PCIe slots only when motherboard support is Unknown or Supported. PCI slots show voltage and data width instead. With Not supported selected, modes are retained but hidden and ignored by compatibility checking; required lane splitting becomes a conflict. This changes the earlier behavior where a stored slot mode could override a false motherboard flag. Returning to Supported restores the mode controls and values.

## Saving and validation

The dialog header, section navigation and Save/Cancel actions remain available while its body scrolls. One shared component schema validates every section and every repeated record, including records outside the current page. Validation opens the relevant section and selected record and shows the issue paths/messages. No partial catalog save occurs when another section is invalid.

Blank values remain unknown; zero, false and empty complete named catalogs are intentional values. Raw JSON has explicit Apply and Discard actions, participates in unsaved-change guards and cannot be silently abandoned when leaving Review. Cancel, browser navigation and window-close protections continue to cover the complete draft.

## Validation scope

Regression checks cover typed ID collision handling, capability-based section selection, current-record reference discovery and explicit unsupported bifurcation. Browser verification covers editing a large port catalog, batch creation, one-record rendering, state retained between sections, errors in an unselected record, JSON discard guards, unsupported bifurcation, category variants, named SATA catalogs, cage routing and narrow-screen Save/Cancel visibility. The existing application and desktop suites and production build remain required.

The SFF and M.2 conversion model and configuration/inventory workflow are documented in [SFF storage](SFF_STORAGE.md).
