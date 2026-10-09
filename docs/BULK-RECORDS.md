# Production locations, native tables and bulk actions

## Location vocabulary

Location kinds are `Site`, `Area`, `Line`, `Station`, `Bench`, `System`, and legacy/optional `Room`. The editor labels Site as “Site / building.” Typical production hierarchies include:

- Plant 1 → Area B → Line 2 → Station 4 → Camera controller (System).
- Plant 1 → Line A → Inspection system.
- Building C → Laboratory area → Test bench.

The name supplies the identifier people use on the floor; room numbers are unnecessary. Levels can be omitted or repeated. Parent-kind sequences are not rigidly enforced, but cycles are rejected. `Station`, `Bench`, and `System` can hold PC assignments. `Site`, `Area`, `Line`, and `Room` group descendants. As before, pinned requirements belong to each explicit assignment location; they are not inherited from a parent.

Room records remain valid for CSV/JSON import and retain their IDs, parents, PC references and captured historical context. To change terminology, filter by Room and bulk-edit the kind to Area. Do not delete/recreate location IDs merely to rename their kind.

## Native data tables and selection

Installation locations, Location operations, PC inventory, and catalog missing-data lists use Vuetify `VDataTable`. They support sorting, pagination, page selection, individually named checkbox labels, and keyboard-accessible horizontal scrolling. Small detail/ledger tables continue to use `VTable`.

The header checkbox selects or deselects the current page. Previously selected rows on other pages and outside current filters remain selected. **Add all matching … to selection** adds the full search/filter result to those existing selections, independent of pagination. The toolbar reports total selected and how many are hidden by filters. **Clear selection** removes all selections. Locations and PCs allow 500 selected records per bulk action; catalog missing-only fills keep their 100-part limit. Deleted IDs are removed from local selection when workspace data reloads.

## Preview and apply

Enable only the fields to change. Disabled fields retain their original values; an enabled field with a Clear/Unassigned choice clears that value deliberately.

Location common edits cover kind, parent, target configuration, a published requirements set/revision, and notes. Parent choices exclude selected nodes and their descendants. The server also validates cycles, assignments and references. Changing a parent may change descendant display paths; previews report these additional paths and the PCs in the affected hierarchy. IDs and installed allocations remain unchanged.

PC common edits cover installation assignment, notes, and Planning/Building/Maintenance/Parts only/Retired lifecycle states. Every edit uses the same lifecycle function as individual PC editing and records changes in each PC’s timeline. Changing assignment moves installed-part whereabouts with the PC while reserved stock stays at its home location; build plans and commissioning snapshots remain preserved. Commissioning and return to In service require their individual validated workflows. Parts-only units must return to Building before other active states. Retirement requires removing all installed parts and reservations.

Notes can be appended independently to each record or replaced; an empty Replace value clears notes.

Click **Preview selected changes** to review each before/after record. Preview writes no business data. Editing the pending request invalidates the preview. Apply requires the reviewed workspace revision and request token; any intervening data change or altered request requires a fresh preview. The entire candidate is validated and committed in one SQLite transaction, without partial success.

## Deletion

Deletion applies only to explicitly selected IDs. It does not select descendants, unassign PCs, or salvage hardware automatically.

- Location deletion is blocked by unselected children or any currently assigned PC, including retired PCs. Select the intended empty subtree explicitly, and move/unassign dependent PCs first. Diagnostics list counts and examples of blockers. Historical commissioning snapshots keep their captured location names/context.
- PC deletion is blocked by current reservations or installed allocations. Removing a PC record also removes its timeline and commissioning snapshots, which the preview describes and counts. Existing stock movement history remains intact. Keep a JSON backup if deleted PC history must be retained.

## API for agents

`POST /api/bulk/preview` accepts one of the requests below. It returns `{ valid, error?, revision, token, rows, affectedPCs, pathChanges, historicalPCs }`. Invalid candidate dependencies return `valid: false`; malformed requests return HTTP 400. No data is written.

```json
{
  "collection": "installationLocations",
  "action": "edit",
  "ids": ["area-a", "area-b"],
  "patch": {
    "kind": "Area",
    "parentId": "plant-1",
    "requirements": { "setId": "line-control", "revision": 2 },
    "targetConfigurationId": "line-controller",
    "notes": { "mode": "append", "value": "Production-floor access required" }
  }
}
```

```json
{
  "collection": "pcs",
  "action": "edit",
  "ids": ["pc-1", "pc-2"],
  "patch": {
    "installationLocationId": "station-4",
    "lifecycle": "Maintenance",
    "notes": { "mode": "append", "value": "Inspect before restart" }
  }
}
```

```json
{ "collection": "installationLocations", "action": "delete", "ids": ["empty-line", "empty-station"] }
```

Delete requests also accept collection `pcs`. Edit patches require at least one supported field, and omitted fields remain untouched. Empty `parentId`, `targetConfigurationId`, or `installationLocationId` clears that binding. To clear requirements, use `{ "setId": "", "revision": 0 }`. Canonical requirement snapshots are captured by the server, not accepted from the caller. IDs must be unique and already exist.

After reviewing a valid preview, call `PUT /api/bulk/apply` with `If-Match: <preview.revision>` and:

```json
{ "request": { "collection": "pcs", "action": "delete", "ids": ["unused-pc"] }, "token": "<token from preview of this exact request>" }
```

Send the same request used in preview. Successful apply returns `{ updated: <selected count> }`; re-read state afterward. HTTP 409 means the revision or reviewed request changed; do not retry using a stale preview. The token is a consistency precondition, not authentication. The app remains a local single-user service.

## Scope on other pages

The selection pattern is shared across the complex record lists. Inventory receipts, movements, salvage, stock counts and commissioning continue to use operational commands with their audit and balance rules. Published requirements revisions remain immutable. Bulk deletion or generic field overwrites do not bypass those rules.
