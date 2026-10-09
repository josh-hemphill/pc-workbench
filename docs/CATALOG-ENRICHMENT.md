# Location operations and catalog enrichment

## Planning repairs and distribution

Open **Installations → Location operations**. Filter by a structured installation location, optionally including descendants, lifecycle status, attention, or installed Repair/Quarantined parts. **Unassigned PCs** includes PCs with a legacy free-text location but no structured assignment; that text is displayed separately.

Search matches PC names/serials, location paths, recorded equipment systems, pinned requirements-set/revision names, and equipment connection names. Equipment is taken from actual build settings and pinned installation requirements; mutable configuration templates are displayed as plans, not physical truth.

Installed and reserved totals count allocation quantities independently. Repair details show currently installed affected components, serial/lot identity and repair/return references. Removed repair stock stays at its stock location and does not appear installed in its former PC. Retired PCs remain visible when requested but are excluded from the attention workload. Parts-only PCs remain in the salvage workload.

The distribution table lists Station/Bench/System locations without an active directly assigned PC. Retired and Parts only units do not satisfy occupancy; Planning, Building and Maintenance units do, and remain visible with their statuses. This is a vacancy check, not a capacity model: a location can accept multiple PCs and has no desired-unit count. Use **Assign / move** to record physical placement; it does not commission a PC, alter its plan, or assert that it meets destination requirements. Installed parts follow the PC assignment, and compatibility findings highlight destination mismatches.

## Finding and filling gaps

Open **Catalog data → Missing data**. Filters cover category, usage in inventory/configurations, search, and missing/unverified records. Checks cover category-specific core identity and scalar/array engineering fields. Explicit `0`, `false`, and authoritative named SATA inventories count as known values. An empty string or array is missing.

This is not a certification of complete engineering data. Individually mapped slots, bays, custom ports, disabled-channel rules, firmware, OS support and wiring still require component editing and manufacturer review. An otherwise complete record may still be unverified.

Select up to 100 components. Hidden selected rows remain selected and are included in the displayed selection count. Bulk fill offers fields shared by all selected categories and missing on at least one selected component. Preview counts distinguish missing from populated values. Arrays use multi-select combo boxes and existing catalog vocabulary; text values reuse canonical catalog spelling. The server validates and commits the entire request atomically, preserves every populated value, and marks changed components unverified. A stale workspace revision is rejected.

## Queueing PCPartPicker details

For each selected component, enter its exact `https://pcpartpicker.com/product/…` URL. The catalog source URL is suggested when applicable. A queue URL override does not replace existing manufacturer documentation. Selected components without a supported URL are skipped with a count. The queue does not search the site or choose a product identity automatically.

Queue entries are persisted in SQLite workspace metadata, independently of record revisions. Up to 100 items can be submitted at once; history is limited to 500 entries. Duplicate active jobs for a component are skipped. Fetching requires **Start fetch queue**, runs sequentially with a 1.5-second delay and a 15-second timeout, and is paused after restart. Interrupted fetching jobs return to queued. Retry failed jobs or cancel queued/review/in-flight jobs explicitly. Clear completed/failed/cancelled history when needed.

Fetches permit HTTPS product pages on `pcpartpicker.com` only, validate each redirect, and limit pages to 2 MiB. Production/desktop Deno permissions allow that host alongside loopback. A site block, challenge, unsupported markup or unavailable details is reported per item; the queue does not bypass protections. Save a product page in a browser and use **Read saved HTML** for the same proposal workflow. HTML is parsed as data and is not executed.

Supported formats are Product JSON-LD `additionalProperty`, two-cell specification table rows, and PCPartPicker specification title/content groups. Conservative mappings include manufacturer, socket/form factor, RAM type/capacity/slots, SATA/M.2 aggregate counts, power ratings, supported forms/sockets, drive capacity/size/interface, dimensions and chassis bay counts when clearly expressed. Units convert explicitly (TB to decimal GB, dimensions in mm, power in W). Ambiguous values are omitted. PCIe alone does not prove NVMe protocol. Multiple distinct Product identities are rejected to avoid mixing specifications. Missing explicit lane/topology, scientific-card, serial/parallel/custom wiring details require manual entry.

Review the source product identity and evidence, select fields and click **Confirm product and apply selected fields**. Application checks both the current workspace revision and the proposal token, then fills only fields still missing. A changed component identity/category blocks an old proposal. Applied values remain unverified. Source URL, timestamp, field names and extracted evidence are appended to component specification notes for provenance, retained in CSV and JSON exports. Queue history itself is operational metadata and is not included in business-data CSV or JSON backups; stop the app before copying its SQLite database if that history must be retained.

## Agent/API workflow

Read `GET /api/state` for the current `revision`; every PUT below requires it in `If-Match`. Refresh state after modifying component records. Queue-only operations do not change the business-data revision.

| Route | Payload / purpose |
| --- | --- |
| `PUT /api/catalog/bulk-fill` | `{ "componentIds": ["part-id"], "patch": { "socket": "AM5" } }`; atomic missing-only fill. |
| `GET /api/enrichment` | Returns `{ jobs, running }`, including evidence and proposal tokens. |
| `PUT /api/enrichment/enqueue` | `{ "items": [{ "componentId": "part-id", "url": "https://pcpartpicker.com/product/abc/part" }] }`. |
| `PUT /api/enrichment/control` | `{ "action": "start" }`, `pause`, or `clear`. |
| `PUT /api/enrichment/:id/action` | `{ "action": "upload", "html": "<html>…</html>" }`, `{ "action": "retry" }`, or `{ "action": "cancel" }`. |
| `PUT /api/enrichment/:id/action` | `{ "action": "apply", "keys": ["socket"], "proposalId": "token-from-reviewed-job" }`. |

After migrating bespoke Excel data, first reconcile IDs and physical allocation quantities using [the migration specification](MIGRATION.md). Then use missing-data filters and enrichment to address exceptions. Enrichment must not substitute for source reconciliation or engineering verification.

For production-floor terminology and multi-record location/PC actions, see [bulk records](BULK-RECORDS.md). Missing-data selection now uses native paginated Vuetify data tables; the page checkbox preserves previous selections and **Add shown parts** adds up to 100 total selected parts.
