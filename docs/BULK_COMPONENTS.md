# Bulk component editing

Select components in either catalog view and choose **Edit selected**. The main catalog supports up to 500 components; Missing Data supports up to 100 and defaults scalar changes to filling blanks. Selected rows hidden by filters remain in scope.

The bulk form reuses `ComponentDataEditor`, including the normal Basics, Ports, Cooling, Expansion, Storage, Physical and Review controls. Matching categories and hardware roles have the full editor. Other selections show the intersection of applicable fields, using the same controls. Component IDs, names and categories remain individual edits. Manufacturer, source, verification and every specification schema field are supported; specifications outside a category’s visual controls remain available through the normal Review JSON editor.

## Common values and pending changes

A group draft contains common values only. Different values are shown as blank and identified as mixed; no component supplies a hidden template for the rest. Inferred storage roles, drive kinds and PCIe defaults are treated as common when their meaning is the same.

Changing a field adds it to **Pending changes**. Uncheck its Apply checkbox to omit it. Include a field explicitly to clear a mixed value, or apply a common value deliberately. Set values with the normal controls above, then choose each field’s action:

- **Replace value** sets the same value on each selected component. For a list, this is the complete replacement list.
- **Fill missing only** preserves populated values, known zero, false and explicitly empty lists. It also recognizes named inventories when considering derived counts.
- **Merge records by ID** updates properties of matching records and appends new IDs. Unmentioned records and optional properties are retained. To remove optional properties or records, use an explicit complete-list replacement.
- **Clear value** removes an optional specification. It clears manufacturer/source text or resets verification to false for metadata. Clearing a named list retains any count-only capacity; clear the corresponding count separately to declare it unknown. Replacing with an empty list declares a known empty inventory.

Scalar actions default to fill in Missing Data and replace in the main catalog. Named lists default to merge. Changing the scalar default affects fields without an individually chosen action. Specification changes reset verification, even when the same batch also requests verification.

The Review JSON editor edits the group draft. Omitted common properties become explicit clears; omitted mixed properties remain untouched. Preview validates the complete resulting component for every selected record, including cross-field references.

## Named records and counts

SATA data ports, power plugs and consumed inputs use their usual Storage controls. Physical ports retain Ethernet/USB presets; SFF ports keep protocols/channels/lanes; slots retain their normal bus/bifurcation controls. Cooling devices, headers and budgets, mounting bays, drive positions, and lane rules use their normal record editors.

IDs are local to each component and stay stable. Merge matches IDs exactly: review mixed inventories before using the generated IDs, or give the new record a distinct ID to append it everywhere. Replacing or clearing records used by configurations, installed hardware or internal routing is blocked with the affected record’s name. Historical snapshots are preserved.

Named-list changes update derived SATA, power, M.2 and USB/Ethernet counts. A partial merge cannot silently reduce an existing count-only capacity: provide a complete named inventory, or choose Replace explicitly when correcting capacity. Aggregate counts cannot overwrite a live named inventory; edit its records instead.

## Preview and apply

Preview shows each selected component’s field values before and after. Unchanged fields are marked, and list details can be expanded. Derived count and verification changes are included. Editing anything after preview invalidates it.

Server validation checks the field allowlist, shared applicability, value types, complete component schema, internal references and external use of record IDs. One invalid component blocks the batch. Apply requires the current workspace revision and the exact previewed request, and persists the collection atomically. Closing a draft or navigating away asks before discarding changes, including unapplied JSON.

Bulk component edits change catalog definitions, not physical stock, configuration placements or wiring assignments.
