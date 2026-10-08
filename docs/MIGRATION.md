# Excel and bespoke-data migration specification

This specification targets PC Workbench **0.2.x**. It describes the implemented import contract, a repeatable migration workflow for an agent, and the decisions that need human evidence. The application does not read `.xlsx` files directly: extract and normalize Excel data outside the app, then submit its seven collections as CSV or a whole-workspace JSON document.

The authoritative definitions are [`server/schema.ts`](../server/schema.ts), [`shared/types.ts`](../shared/types.ts), [`server/store.ts`](../server/store.ts), and [`server/index.ts`](../server/index.ts). Check them when migrating against a newer release. All examples are illustrative; they are not verified hardware specifications or real inventory.

## 1. Choose a migration mode

| Mode | Behavior | Use |
| --- | --- | --- |
| Whole-workspace JSON | Validates all collections/references together; replaces the entire workspace in one SQLite transaction. Writes a safety backup first. | Preferred for an initial Excel migration, or a coordinated change spanning several collections. |
| Collection CSV | Merges rows by `id`. An imported row replaces the entire existing record with that ID. IDs absent from the file remain. Each request is atomic; a sequence of imports is not. | Additive/incremental imports into an existing workspace. |
| Record/movement APIs | Apply operational rules, generating inventory history, PC timeline and approval/commissioning records where applicable. | New receipts, reservations, installations and changes after migration. |
| Legacy CSV startup migration | On first initialization only, reads collection CSV files in the data directory and validates/migrates them into SQLite. Existing files are preserved. | Upgrade an existing PC Workbench workspace, not the preferred Excel ingestion route. |

For JSON replacement, build a complete candidate from an exported backup if existing records must be retained. For CSV, include every field you intend to preserve on each replaced record: omitted optional values may disappear or become defaults. Import is not a field-level patch. Never infer that rows missing from an Excel extract should be deleted.

Configuration CSV import checks every Approved configuration in the merged collection for engineering Conflicts, including existing approved records absent from the CSV. An unrelated import may therefore fail if an existing approved plan has become conflicted. Whole-workspace JSON validation does not perform that approval check; engineering review remains a separate migration gate.

A fresh application seeds illustrative catalogs, configurations and PCs. A complete JSON replacement containing only your records removes these examples. CSV merges leave them in place. Missing legacy CSV files also leave seeded collections in place, except that the two new requirements/location collections start empty. Do not use a partial set of startup CSVs to create a clean bespoke workspace.

## 2. Required migration deliverables

Keep these outside the public repository when they contain operational or personal data:

| Artifact | Required content |
| --- | --- |
| Source manifest | Workbook filenames and SHA-256 hashes, sheet/table names, extraction timestamp, source as-of date, row counts, formula/cache policy and timezone. |
| Mapping document | Source sheet/column → target collection/field, units, enum translation, missing-value policy, join key and deduplication rule. |
| Identity crosswalk | Stable source keys → target IDs; distinguish type, PC, stock unit/lot, requirements set, location, placement and allocation identities. |
| Normalized staging data | Typed records before CSV serialization; source row/cell references retained in a separate provenance file. |
| Candidate workspace | Exactly the seven JSON arrays below, plus optionally seven generated raw CSV files. |
| Exception report | Unresolved joins, duplicate identities, unsupported fields, ambiguous counts, unverified specifications and engineering findings. Never silently discard rows. |
| Reconciliation report | Source versus target counts/totals, installed/reserved/free balances, location assignments, revision bindings and explained exclusions. |
| Execution record | Target version, pre-migration backup hash, preview result/revision, committed result, post-migration export hash and spot-check results. |

Suggested bundle layout:

```text
migration-bundle/
  source-manifest.json
  mapping.md
  identity-crosswalk.csv
  provenance.csv
  exceptions.csv
  reconciliation.md
  workspace.json
  csv/{components,systems,requirementsSets,configurations,installationLocations,pcs,inventory}.csv
```

The manifest/provenance/exception files are migration artifacts, **not importable application collections**. Do not attach extra properties to application records: schemas reject unknown fields. Use `source` on components and appropriate `notes`/`description` fields for short references, with the full source-cell crosswalk kept separately.

## 3. Excel extraction and normalization

1. Inventory all sheets, named tables, hidden rows/sheets, filters, merged ranges, repeated headers, formulas, comments and external links. Classify detail rows, headings, subtotals and totals. Do not import subtotals as inventory.
2. Read both cell values and number formats. Preserve serials, asset tags, part numbers, postal-style room codes and other identifiers as text, including leading zeros. Excel may already have rounded numeric identifiers beyond 15 significant digits; flag such values rather than reconstructing digits.
3. Capture formulas separately from their cached results. Use verified, recalculated results as data. A missing/stale formula cache, external-link result or Excel error is an exception, not zero. If opening Excel/LibreOffice to recalculate, record that transformation and retain the original file.
4. Expand merged headings or carry parent values forward only where the workbook structure proves that intent. Do not globally forward-fill blank quantities, serials, conditions or statuses. Exclude header repeats and totals explicitly.
5. Normalize whitespace for matching while preserving original identifiers in the crosswalk. Apply documented synonym maps, for example `RAM` → `Memory`, `DAQ` → `Scientific card`, and `installed` → allocation state `installed`. Match exact target enum capitalization.
6. Parse locale-specific numbers and dates explicitly. `1,024`, `1.024`, `03/04/26`, Excel serial dates and the 1900/1904 date systems require a known locale/date policy. Do not guess an ambiguous date or decimal separator.
7. Convert physical dimensions to whole millimetres (schema requires integer dimensions), power to watts, link speeds to Mbps and capacity to GB. Record any rounding. Use decimal GB for a consistent migration (`1 TB = 1000 GB`; `1 GiB = 1.073741824 GB`); the app stores a number and does not convert units automatically. Preserve nominal/spec-sheet values in notes when they differ.
8. Distinguish missing, measured zero, false, not applicable and unknown. Omit optional unknown specifications instead of writing `0`, `false`, `N/A` or `?` into numeric/boolean fields. Missing required business fields go to exceptions unless this specification provides a legitimate empty value.
9. Retain discrepancies between a planned BOM and observed installed hardware. They become different records; they are not a reason to overwrite either source.

Recommended tools are a TypeScript XLSX reader such as SheetJS/ExcelJS, or a separate Python extraction environment using openpyxl. These are migration tooling choices, not application dependencies. Never build CSV by concatenating strings or hand-escaping JSON: use a CSV serializer and JSON serialization.

## 4. Map workbook concepts to the model

| Workbook concept | Target | Mapping rule |
| --- | --- | --- |
| Part/model/specification table | `components` | One catalog type per engineering-distinct model/revision. No unit serial here. |
| Equipment/instrument connection table | `systems[].connections` or `requirementsSets[].versions[].connections` | Systems are legacy/editable equipment groupings; publish reusable requirements for a stable baseline. |
| Standard control station or installation class | `requirementsSets` | One reusable set with immutable, ordered revisions; the minimum needs of a class, not the observed hardware of one PC. |
| Standard PC BOM/template | `configurations` | Planned quantities, component placements, storage plan and pinned requirements. |
| Campus/building/lab/room/bench hierarchy | `installationLocations` | Nodes with parent IDs. Map building/lab levels to Site/Room as appropriate; preserve source terminology in names/notes. |
| Physical PC/asset register | `pcs` | One machine identity with an optional plan and physical installation assignment. |
| Unit serial inventory | `inventory`, `tracking: serialized` | One record per physical unit, quantity exactly 1. |
| Spare-stock quantity by model/shelf/condition/lot | `inventory`, `tracking: bulk` | One lot per meaningful homogeneous stock grouping; no unit serial. |
| Parts fitted to a PC | `inventory[].allocations`, state `installed` | Actual physical quantities tied to a registered PC. A configuration placement alone is not installed stock. |
| Held stock for a future build | `inventory[].allocations`, state `reserved` | Consumes the lot balance but does not appear as installed parts at the PC location. |
| Stock movements with evidence | `inventory[].history` | Import evidenced events, or an explicitly labelled migration opening balance. Do not fabricate historical movements. |
| Purchase order/supplier/RMA | Inventory metadata | Fields listed below; not a purchasing/accounting subsystem. |

There is no standalone equipment-instance collection, warehouse location hierarchy, arbitrary custom-field bag, document/attachment store, financial valuation or structured network-address register. Installation `kind: System` is a physical location node; it is distinct from the `systems` collection. Keep unsupported details in notes or an external migration sidecar and record this loss of structure.

### Identity and deduplication

- Top-level record IDs and most nested identity fields must match `[A-Za-z0-9_-]{1,80}`. IDs are case-sensitive. Use namespaces such as `cmp_`, `pc_`, `stk_`, `req_`, `loc_`, `pl_`, `alloc_`, `evt_` and a stable source key or short deterministic hash. Do not use workbook row number as the sole identity if rows can move.
- Model numbers alone are not always sufficient to merge catalog types. Distinguish revisions with different dimensions, interfaces, memory generations, slots, drivers or firmware requirements. Serial number identifies a stock unit, not a component type.
- The application rejects duplicate serialized-unit serials for the same component type after trimming and case folding. Asset/lot tags are unique across all inventory after trimming and case folding. Allocation IDs and movement IDs must be globally unique across inventory records. Repeated PC serials are not rejected by the schema; detect unintended duplicates in migration reconciliation.
- Stable reruns must reuse IDs. Do not generate fresh random identities on every run. If two workbook rows are duplicates of the same unit, consolidate using evidence; if they describe two units with an ambiguous serial, quarantine the mapping decision rather than inventing a serial.
- Preserve original source IDs as text in the crosswalk. A change of display name, room path or shelf name must not change the stable identity.

## 5. Serialization contract

### Whole-workspace JSON

```json
{
  "components": [],
  "systems": [],
  "requirementsSets": [],
  "configurations": [],
  "installationLocations": [],
  "pcs": [],
  "inventory": []
}
```

Use all seven arrays, even when empty. Legacy backups may omit the two newest arrays, but new migration tools should not. Do not include `/api/state` metadata (`revision`, `recoveryRequired`) in a backup. Unknown top-level collections are rejected. Array order is not a dependency order for JSON validation. Restore validates schema and references but **does not run configuration approval/PC commissioning workflows or guarantee engineering compatibility**. Run reports separately.

### CSV encoding and exact columns

Use UTF-8, comma-delimited CSV, a header row, standard quoting (double internal `"` characters inside quoted cells), and LF or CRLF endings. A UTF-8 BOM is accepted. Decimal integer fields must contain digits only; no spaces, separators, signs or decimals. `verified` accepts `true`, `false`, `1`, `0`; use `true`/`false`. JSON booleans inside nested cells remain true JSON booleans. IDs duplicated within one import file are rejected.

Canonical column lists, in export order:

```text
components:
id,name,category,manufacturer,specs,source,verified

systems:
id,name,location,description,connections

requirementsSets:
id,name,description,versions

configurations:
id,name,description,systemId,status,updatedAt,placements,storage,notes,software,portMappings,revision,approvalSnapshot,approvalHistory,requirementSetId,requirementRevision,requirementSnapshot

installationLocations:
id,name,kind,parentId,requirementSetId,requirementRevision,targetConfigurationId,notes,requirementSnapshot

pcs:
id,name,serial,location,configurationId,notes,buildSettings,lifecycle,software,commissioning,timeline,snapshot,snapshots,installationLocationId

inventory:
id,componentId,tracking,serial,assetTag,quantity,location,condition,notes,allocations,history,supplier,purchaseOrder,reorderLevel,repairReference,supplierReturnReference
```

Nested JSON columns: `specs`, `connections`, `versions`, `placements`, `storage`, `software`, `portMappings`, `requirementSnapshot`, `buildSettings`, `allocations`, `history`, `approvalSnapshot`, `approvalHistory`, `commissioning`, `timeline`, `snapshot`, `snapshots`.

- Serialize empty required arrays as `[]` and an unknown specification object as `{}`. Required `storage` must contain its required fields; `{}` is not valid storage.
- Blank `buildSettings` becomes `null`. Other blank JSON cells are omitted. Do not write JSON `null` where a non-null optional object/array is expected.
- Empty ordinary text cells are empty strings; omission of a required column is different. Required names cannot be empty. For unbound installation locations, explicitly write `requirementSetId` empty and `requirementRevision` `0`; the location requires both fields.
- Optional blank configuration requirement fields, lifecycle, revision, reorder level and installation assignment are omitted/defaulted according to the decoder. Blank procurement strings may be preserved as `""`. Do not rely on blanks to clear a single field without replacing the rest of the record.
- `movements.csv` is a flat **export-only** ledger. Its rows cannot be imported as a collection. Import history nested in each stock record or use movement APIs.
- Raw export is `GET /api/export/<collection>` (default). `?spreadsheet=true` prefixes formula-like strings with an apostrophe for spreadsheet viewing; it is not an exact round-trip format. Do not strip legitimate source apostrophes indiscriminately. Prefer generating fresh raw CSV from normalized records.

For exact round-trip comparisons, canonicalize optional blank `configurations.requirementSetId` and optional blank `pcs.installationLocationId` to omission before comparison. The JSON schema permits some empty reference strings that the CSV decoder removes. Location `requirementSetId` remains a required empty string when unbound. Do not treat this documented unbound-reference normalization as a lost assignment, or apply it to nonempty identifiers.

CSV parser errors identify record numbers beginning at `CSV row 2`; multiline fields mean these are not always physical file line numbers. Retain a record-ID/source-cell crosswalk to locate failures.

## 6. Record dictionaries

**R** means required. **O** means optional; omit unknown values. **D** means schema default when absent. Strings normally have a 10,000-character limit; names have 1–200 characters. Empty allowed-reference strings mean unassigned. Dates in date fields must be UTC ISO 8601 timestamps ending in **Z**, for example `2026-10-07T12:00:00Z` (not Excel date serials or local dates). Even an equivalent `+00:00` offset is rejected by the current schema; convert offset timestamps to UTC and serialize with Z. If only a date or migration observation time is known, document how a timestamp was selected rather than implying a precise historical time.

### `components`

| Field | Contract |
| --- | --- |
| `id`, `name` | R identity and catalog display name. |
| `category` | R: Chassis, Motherboard, CPU, Memory, GPU, Scientific card, Network card, Storage adapter, Bay accessory, Drive, PSU, Cooler. |
| `manufacturer`, `source` | R text; empty allowed. `source` can cite manufacturer evidence or workbook/sheet. |
| `specs` | R object; all properties below optional. Unknown keys rejected. |
| `verified` | R boolean. Use false for unverified Excel specifications. True needs documented verification evidence. |

Specification dictionary:

| Fields | Type/meaning |
| --- | --- |
| `socket`, `formFactor`, `memoryType` | Text; use consistent exact labels across matching parts. |
| `supportedForms`, `supportsSockets`, `supportedOS` | Arrays of text. Keep OS labels consistent with recorded software. |
| `dimmSlots`, `maxMemoryGb`, `rearSlots`, `bays25`, `bays35`, `hotSwapBays`, `sataPorts`, `m2Slots`, `sataPower`, `usbA`, `usbC`, `ethernet`, `powerW`, `capacityW`, `m2Length`, `sledDrives` | Integers 0–10,000. Capacity fields are per component, not whole BOM totals. PSU `capacityW` is supply rating; `powerW` is demand. |
| `capacityGb` | Number 0–10,000,000; per memory module or drive. |
| `lengthMm`, `heightMm`, `widthMm`, `maxCardLengthMm`, `maxCardHeightMm`, `maxCoolerHeightMm` | Integers 0–10,000 mm. Distinguish part dimensions from chassis clearance limits. |
| `slotBus` | PCI or PCIe; do not translate conventional PCI to PCIe. |
| `slotWidth`, `requiredLanes` | Integers 1–16; physical connector width and electrical demand are different. |
| `minGeneration` | Integer 1–7; `bracketWidth` integer 1–8. |
| `pciVoltage`, `pciBits` | 3.3V / 5V / universal; 32 or 64. Applies to conventional PCI. |
| `driveInterface`, `driveSize` | SATA / NVMe; 2.5 / 3.5 / M.2. Quotes are not part of these values. |
| `m2Lengths` | Array of integer M.2 lengths, e.g. `[80,110]`. |
| `requiresBifurcation`, `bifurcation`, `sledHotSwap`, `bootable`, `hotPlug` | Booleans. Do not infer hot-swap from physical access alone. |
| `bifurcationMode`, `requiredDriver`, `requiredFirmware`, `notes` | Text. Driver/firmware dictionaries use component IDs as keys. |
| `slots`, `ports`, `driveTargets`, `laneRules` | Structured arrays below. |

Each slot requires `{id,bus,physical,lanes,generation,position}`. Width/lanes are 1–16, generation 1–7, position 1–32; slot IDs and positions must be unique within the component. Optional `bifurcationModes` is an array of strings, and `pciVoltage`/`pciBits` use the enums above. At most 32 slots. Example: `{"id":"pcie_1","bus":"PCIe","physical":16,"lanes":8,"generation":4,"position":1}`.

Each port requires `{id,kind}` where kind is USB-A, USB-C, Ethernet, Serial, Parallel or Custom; optional `{customType,connector,pinout,protocol,speedMbps,powerW,isolated}` records interface identity and capabilities. Custom requires a nonblank `customType`, for example GPIB, CAN or vendor trigger I/O. `connector` names the PC-side physical endpoint (e.g. DB9); `pinout` identifies its wiring standard. Numeric speed/power must be nonnegative. IDs unique within the component; at most 1,000 ports. Aggregate port counts and explicit port records describe the same capacity; do not add them together as separate ports.

Each drive target requires `{id,mount}`; optional `{driveSizes,interfaces,m2Lengths,hotSwap,bootable}`. IDs unique within the component; at most 1,000 targets. Mount is auto/internal/front-hot-swap/rear-sled. Use individual targets to model bay restrictions and occupancy, with consistent interface/size labels.

Each lane rule requires `{id,slots}`; optional `{maxLanes,exclusive,disableM2Slots,disableSataPorts}`. IDs unique, referenced slots must exist on that component; at most 100 rules. Count properties are integers 0–10,000. Record actual shared-resource topology, not an inferred sum of connector sizes.

### `systems` and equipment connections

R system fields: `{id,name,location,description,connections}`. Location is free text, not an installation node reference. Each connection requires `{id,name,usbA,usbC,ethernet,notes}`; counts are integers 0–10,000. IDs unique within the connection array, maximum 200 connections.

Optional `requirements` adds structured port requirements: `{id,kind,quantity}` plus optional `{customType,connector,pinout,protocol,minSpeedMbps,minPowerW,isolated}`. Kind uses the six port kinds above; Custom requires a nonblank `customType`. Connector and pinout describe the required PC-side endpoint. Serial/Parallel/Custom demands use this structured array, not new aggregate CSV columns. Quantity is 0–10,000, minimum speed/power nonnegative, IDs unique within the connection, maximum 1,000 requirements. Interface names, specified connectors/pinouts and protocols are matched after trimming/case normalization; explicit mismatches are conflicts and unrecorded capabilities require review. Use precise, consistent standards (RS-232 versus RS-485); identical DB9 connectors do not prove electrical compatibility. Aggregate USB/Ethernet counts and structured requirements describe the same equipment need; avoid counting both twice when calculating the migration source total.

### Serial, parallel and custom migration example

A serial host port in `components[].specs.ports`:

```json
{"id":"com1","kind":"Serial","connector":"DB9","pinout":"DTE","protocol":"RS-232","speedMbps":0.1152,"isolated":true}
```

The equipment connection keeps required legacy counts at zero and expresses the actual interface in `requirements`:

```json
{
  "id":"stage","name":"Motion stage","usbA":0,"usbC":0,"ethernet":0,"notes":"Verify cable wiring and instrument settings.",
  "requirements":[{"id":"stage_serial","kind":"Serial","quantity":1,"connector":"DB9","pinout":"DTE","protocol":"RS-232","minSpeedMbps":0.1152,"isolated":true}]
}
```

Map that requirement to the component placement and port ID with a zero-based instance. A parallel connection can use `kind:"Parallel"`, `connector:"DB25"`, `protocol:"IEEE 1284"`. A named custom interface can use `kind:"Custom", customType:"GPIB"`; another GPIB port must use the same normalized custom name. Different custom names cannot satisfy each other, even if connector shapes match. Record custom capabilities on the actual provider component, including a scientific card or adapter. Structured demand and available port counts appear in compatibility reports; an unmapped port still needs explicit mapping and verification.

Represent bit rates in Mbps (`115200 bits/s = 0.1152 Mbps`); do not assume baud and bit rate are identical for every protocol. Cable genders, converters, pin-level electrical limits, serial framing (parity/data/stop bits), addresses and multi-drop bus topology are not automatically modeled: preserve them in equipment notes/provenance and verify them separately. Quantity means dedicated PC-side physical endpoints; do not count every device on a shared bus as a separate host port without documenting that topology. No automatic serial-to-USB or custom-interface conversion is inferred.

### `requirementsSets` and bindings

R set fields: `{id,name,description,versions}`. Each published version requires `{revision,at,name,description,connections}` with optional `{constraints,software,storage}`. Revision is an integer 1–1,000,000, unique and strictly increasing through the array; maximum 1,000 versions. Do not invent older published versions if only the current baseline is known. Label an initial imported revision as a migration baseline.

Constraints: optional nonnegative `minMemoryGb` (up to 10,000,000), `minBootGb`/`minDataGb` (up to 1,000,000,000), `minScientificCards` (integer 0–10,000) and `requiredComponents:[{componentId,quantity}]` (unique component IDs, quantities 0–10,000). Connections use the system connection contract above; software/storage use the contracts below.

Configurations and PC build settings can bind with `requirementSetId`, `requirementRevision`, `requirementSnapshot`. Locations require set ID and revision fields. A nonempty ID requires an existing published revision; unbound is empty ID and revision 0 (or omit optional binding fields). A provided snapshot must exactly match the schema-normalized selected version, including array order. Deep-copy that version when generating JSON. CSV/PUT imports canonicalize config/location snapshots; PC CSV import and JSON restore validate bindings but do not automatically capture missing snapshots. Include matching snapshots in a new complete migration candidate for explicit provenance.

Published versions cannot be overwritten/deleted by ordinary saves/CSV imports; append a version. A whole-workspace restore is a trusted replacement and can replace history. Do not use it to casually revise published baselines. New publication does not upgrade pinned consumers. Parent-location requirements are not inherited: bind every PC-assigned Bench/System node explicitly when a baseline applies there.

### `configurations`, placements and storage

R configuration fields: `{id,name,description,systemId,status,updatedAt,placements,storage,notes}`. `systemId` is an existing system ID or empty. Status is Draft/In review/Approved. Start imported plans as Draft or In review until engineering evidence is reviewed. O fields: requirement binding, `software`, `portMappings`, `revision`, `approvalSnapshot`, `approvalHistory`.

Each placement requires `{id,componentId,quantity,slotId,role,mount,group}`. IDs unique within a configuration, maximum 200 placements. Quantity is integer **1–32**. `slotId` empty permits allocation; a named slot is motherboard-local. Role is boot/data/general; mount is auto/internal/front-hot-swap/rear-sled. `group` empty uses the default data array. Optional `{targetId,adapterPlacementId,controllerPlacementId}` binds a drive to a provider target/controller. Provider/controller values reference placements in that configuration. Split lines into quantity-1 placements for distinct physical slots or drive targets; do not put two drives into one named target.

Storage requires `{raid,bootMirror}`. Raid enum: none/mirror/raid5/raid6/raid10. Optional `groups:[{id,name,raid,controllerPlacementId?,notes?}]`, with unique IDs and at most 100 groups. A drive's nonempty group references a group ID; boot drives use role boot, not a data-array group. Record whether a stated capacity is raw total or usable after redundancy. The app computes usable capacity using the smallest member; do not store a precomputed whole-array capacity on an individual drive. Rear NVMe sled drives need the adapter and its slot/lane/bifurcation evidence; front bays need size/interface/hot-swap evidence.

### `installationLocations`

R: `{id,name,kind,parentId,requirementSetId,requirementRevision,targetConfigurationId,notes}`. O: `requirementSnapshot`. Kind is Site/Room/Bench/System. Empty parent means top-level; otherwise reference another location. Hierarchies must be acyclic. Target configuration is a live plan reference, or empty, not an immutable copy. PC assignments are allowed only to Bench/System nodes. Site/Room nodes aggregate descendant PCs and installed parts. The schema does not enforce a particular sequence of parent kinds; the migration must preserve a sensible hierarchy.

### `pcs` and software

R: `{id,name,serial,location,configurationId,notes}`. `buildSettings` defaults to null; explicitly supply it for a known actual configuration. Serial/location are free text (empty allowed); configuration ID is existing or empty. O: `installationLocationId`, `lifecycle`, `software`, `commissioning`, `timeline`, `snapshot`, `snapshots`.

Build settings require `{systemId,storage,notes}`, plus optional requirement binding, software and port mappings. These record actual machine settings independently of the template. `buildSettings:null` does not assert that a template is the actual state; resolve the missing evidence before commissioning. Lifecycle enum: Planning/Building/Commissioned/In service/Maintenance/Retired. Prefer Building for an observed installed machine awaiting acceptance. A retired PC cannot have any current allocations. Do not manufacture commissioning/approval snapshots to satisfy a source label; preserve an unevidenced label in notes and use the actual acceptance workflow.

Software object optional text fields: `os`, `image`, `equipmentSoftware`, `equipmentConfiguration`, `bios`; optional `drivers` and `firmware` map valid component IDs to version strings. A PC's `software` overrides software in its build settings when present. Do not use an empty PC software object to represent unknown data if it would hide known build-setting software.

Port mappings are `{connectionId,requirementId,placementId,instance,portId}`; instance is **zero-based**, less than the referenced placement quantity (schema accepts integers 0–10,000; reports check the actual range). Maximum 1,000 mappings. For actual PCs the engine resolves planned placement IDs to installed allocation IDs; explicit actual allocation IDs can remove ambiguity. Provider/controller references in installed allocations similarly resolve actual IDs or unambiguous planned IDs. These nested engineering links need report validation in addition to referential/schema validation.

### `inventory`, allocations and history

R: `{id,componentId,tracking,serial,assetTag,quantity,location,condition,notes,allocations,history}`. Tracking is serialized/bulk; condition Serviceable/Quarantined/Repair/Retired. Quantity is integer 0–1,000,000. D: supplier/purchaseOrder/repairReference/supplierReturnReference empty strings; reorderLevel 0 (integer 0–10,000).

- Serialized: nonblank serial, quantity 1. Bulk: blank serial, total quantity includes free, reserved **and** installed units; it is not just shelf availability. Example: total 10 = 6 free + 2 reserved + 2 installed. If a sheet lists 6 shelf units and another 2 fitted units, prove they are disjoint before summing.
- Separate bulk lots by component, location, condition and provenance when those distinctions matter. Stock `location` is the home shelf/lot location. Installed whereabouts derive from the PC's installation assignment; moving a PC does not change stock ownership or quantities.
- Allocation quantities sum to no more than stock quantity, across all PCs and states. Retired stock has no allocations. The importer does not guarantee that a non-Retired condition is appropriate for an installed part; reconciliation must flag questionable assignments. Operational reserve/install actions require Serviceable stock.

Allocation R fields: `{id,pcId,quantity,state,plannedPlacementId,slotId,role,mount,notes,createdAt,updatedAt}`. Quantity 1–32, state reserved/installed, PC must exist and not be retired. `plannedPlacementId` empty is allowed for an unplanned part; otherwise map it to the relevant configuration line. Role/mount use placement enums. O fields: `group`, `targetId`, `adapterPlacementId`, `controllerPlacementId`. D fields: `owner`, `workOrder`, `dueAt`, `expiresAt` empty strings; due/expiry accept empty or UTC timestamp. At most 10,000 allocations per stock record. Large bulk allocations must be split into records of at most 32 units each without duplicating stock totals.

History R fields: `{id,at,action,quantity,pcId,pcName,allocationId,notes}`. D: `sourceAllocationId`, `targetStockId`, `sourceStockId`, `actor` empty strings. Action enum: receive/adjust/edit/reserve/install/release/remove/configure/transfer-in/transfer-out. Quantity integer −1,000,000 to 1,000,000; metadata/configuration changes normally use 0. At most 100,000 events per stock record. History is descriptive: importing events does not replay/reconstruct balances. Validate current quantities/allocations separately. Historical PC/link strings may describe records no longer present; retain their names/evidence rather than imposing current foreign keys on them.

If source history is absent, use `history:[]` and clearly mark the record as a migration opening state, or create a receive opening-balance event at the migration observation time with explicit notes and no claimed historical receipt date. Existing fitted parts must be represented in current allocations; a fabricated installation event is not necessary. Operational imports are trusted transfers: CSV can replace allocations/history, whereas the ordinary inventory PUT requires movement actions for those changes and protects existing stock type/tracking/quantity.

Inventory CSV also rejects changing an existing record's `componentId` or `tracking` mode. Use a new stock identity to correct an incorrect type, the serialization operation to identify free bulk units, or a deliberately reviewed full restore for identity recovery. Reusing an old ID to turn a bulk lot into a serialized unit is not a supported incremental import.

### Historical approvals and acceptance records

Normally omit generated approval/commissioning fields for a bespoke migration. Configuration `revision` is integer 0–10,000; PUT generates it and approval history. Configuration CSV/JSON can carry historical fields but does not create approval evidence. PC PUT prevents editing timeline/commissioning/snapshots and requires the commissioning action to enter Commissioned. CSV/JSON are trusted data transfers and do not enforce all those operational transitions.

If genuine historical records must be imported, implement their exact schemas from `server/schema.ts`: configuration approval history contains the captured configuration, catalog components and system; PC snapshots contain a captured configuration/components/system, optional installed-stock identities and installation context. `commissioning` is `{at,by,checks,notes}`; PC timeline entries are `{id,at,kind,summary,actor}`. Maximum 1,000 approval records or snapshots; timeline maximum 100,000 entries. Do not reconstruct immutable historical configurations from today's mutable catalog and label them as past acceptance evidence.

## 7. Dependency order and staged execution

For CSV into an existing workspace:

1. Components.
2. Systems (can be empty if all plans use published requirement connections).
3. Requirements sets (required component IDs must already exist).
4. Configurations (component/system/requirement revisions must exist).
5. Installation locations (targets/requirements must exist; parents either already present or included in the same location import).
6. PCs (plans/locations and recorded system/requirements must exist).
7. Inventory (component types and all allocated PCs must exist).

Locations in one file can reference another row in that file because validation sees the merged collection. For split files, parents must be imported first. A single request cannot add requirements and their consuming configurations in different collections. Do not create cyclic dependency workarounds by inventing temporary parts; use a complete JSON candidate instead.

For a fresh Excel migration, create the full JSON graph, validate it, run engineering/reconciliation checks in a scratch workspace, then preview/commit the same candidate in the destination. Never write directly to SQLite tables. Editing preserved legacy CSV files after database initialization does nothing; use explicit import.

## 8. Local API contract for an agent

Production default base URL: `http://127.0.0.1:3001`. During development, the API also runs on 3001; the frontend is on 5173. Host/origin checks permit local requests only. Requests containing JSON need `Content-Type: application/json`.

| Endpoint | Request/result |
| --- | --- |
| `GET /api/backup` | Exact seven-collection backup, no workspace metadata. Save before modifying data. |
| `GET /api/state` | Collections plus `revision` and `recoveryRequired`. Revision is an opaque string, also returned as `X-Workspace-Revision`. |
| `POST /api/restore/preview` | Body `{backup:<candidate>}`. Returns collection counts and current revision; validates without replacing data. No If-Match required. |
| `POST /api/restore` | Same body, `If-Match` equal to preview/current revision. Atomic full replacement; returns restored flag, safety backup path, new revision. |
| `POST /api/<collection>/import` | Body `{csv:<CSV text>}`, with If-Match. Imported count is rows processed, not net new records. |
| `GET /api/export/<collection>` | Raw CSV; `?spreadsheet=true` is for spreadsheet viewing. |
| `GET /api/report/<configurationId>` | Planned engineering findings/resources. |
| `GET /api/pcs/<pcId>/build` | Actual installed report, allocation list, plan differences and stock readiness. |
| `PUT /api/<collection>/<id>` | Full record JSON, matching body ID, with If-Match. Applies operational save rules. |
| `POST /api/inventory/batch` | `{records:[...]}` for 1–1,000 new receipts without history/allocations. Creates receive history; rejects existing IDs. |
| `POST /api/inventory/<id>/action` | Movement command, e.g. `{action:"install",pcId,quantity,plannedPlacementId,notes}`. Uses latest balances; generates history. |
| `POST /api/pcs/<id>/commission` | `{by,checks:[...],notes}` with If-Match. Requires build settings, installed stock and no engineering Conflicts. Warnings still need review. |

If-Match is required for PUT, DELETE, CSV import, restore, commissioning and decommissioning. Inventory movement/batch commands do not require it; they validate latest balances but are **not idempotent**. Re-read state after each successful mutation. On a network timeout, inspect whether the intended operation committed before retrying. CSV reruns with stable IDs avoid duplicate records, but can still overwrite newer changes. Requirements publication must retain the exact existing version prefix.

Statuses: success normally 200; 400 validation/unknown schema/invalid references, 403 rejected local host/origin, 404 unknown route collection/record where handled, 409 stale If-Match, 428 missing If-Match, 503 recovery-required. Inspect the JSON `error`, not just a status. Body-parser errors, including oversized requests, are currently handled by the generic 400 response. Stop dependent operations on failure. A 409 requires reload/review; do not blindly substitute a new revision for stale data.

JSON request bodies have a **10 MB** limit, including CSV text serialized inside the request. Each collection is limited to 10,000 records and each serialized CSV record to 64 MiB; these larger storage limits do not override the HTTP limit. Nested array limits in section 6 also apply. Split incremental CSV files below the HTTP limit; a large full restore cannot be split while retaining whole-workspace atomicity. For larger candidates, a purpose-built local offline migration using `Store.validateBackup`/`Store.restore` is needed with the server stopped and exclusive workspace access; this release does not provide an offline import CLI.

Example executable Node.js restore client (save as an external `.mjs` file):

```js
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
const base = 'http://127.0.0.1:3001';
const candidate = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
async function jsonRequest(route, options = {}) {
  const response = await fetch(base + route, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  return body;
}
// Give each preview/commit run its own backup; never overwrite an older one.
const before = await jsonRequest('/api/backup');
const backupPath = `before-migration-${Date.now()}-${randomUUID()}.json`;
await fs.writeFile(backupPath, JSON.stringify(before, null, 2), {flag:'wx'});
console.log('Pre-migration backup:', backupPath);
const body = JSON.stringify({backup:candidate});
const preview = await jsonRequest('/api/restore/preview', {
  method:'POST', headers:{'Content-Type':'application/json'}, body
});
console.log('Validated replacement counts:', preview.counts);
// Run only once the replacement scope and reconciliation have been accepted.
if (process.argv[3] === '--commit') {
  console.log(await jsonRequest('/api/restore', {
    method:'POST', headers:{'Content-Type':'application/json','If-Match':preview.revision}, body
  }));
}
```

The acceptance checkpoint concerns the actual replacement scope/data decisions for the migration. Preview is read-only. Preserve destination records in the candidate whenever replacement is not intended to remove them.

## 9. Preflight, reconciliation and acceptance

Run these before destination mutation and repeat relevant checks after import:

1. Schema-parse every record; validate the complete workspace using `/api/restore/preview` in a scratch app. Generate CSV with `encodeCSV`, decode it with `decodeCSV`, and compare schema-normalized records for round-trip equality, allowing only the documented optional-empty-reference normalization in section 5. Do not accept numeric/string coercion that changes identity.
2. Resolve every current component/system/configuration/location/PC/requirement reference. Check location cycles, published revisions and snapshot equality. Check nested slots/ports/providers/groups with engineering reports; backup preview alone does not validate their physical meaning.
3. Reconcile every source detail row to one or more target records or an explicit exclusion/exception. Compare catalog model count, physical PC count, serialized-unit count and bulk quantities **by component, lot and condition**, not just a single grand total.
4. For each stock record, prove `total = unallocated + reserved + installed` and `sum(allocations) <= total`. Serialized quantity remains 1. Retired stock/PCs have no allocations. Detect unintended duplicate serials/tags, ID collisions and two rows describing the same fitted unit.
5. Check planned versus installed differences without erasing them. Obtain `GET /api/report/:id` and `GET /api/pcs/:id/build`; record every error/warning and source evidence. Unknown dimensions/lanes/ports/drivers must remain review findings, not inferred compatibility. Schema-valid imports may have engineering Conflicts.
6. Check each assigned PC is on the correct Bench/System leaf, each leaf uses the intended revision, and Site/Room installed-part rollups contain the expected descendants. Reservations must not inflate installed-location part counts. Unassigned PCs remain visibly unassigned.
7. Spot-check leading-zero and long identifiers, Unicode, quoted/multiline notes, timestamps, drive roles, RAID usable capacity, scientific PCI versus PCIe cards and physical slots.
8. Export JSON plus raw CSV after commit. Compare against the schema-normalized/canonicalized candidate, allowing only documented defaults, snapshot canonicalization and API-generated history/revision fields. Restart the scratch app to prove SQLite persistence before cutover.
9. Record unresolved exceptions and the accepted baseline. Keep genuine unknowns explicit; do not label the migration as complete merely because the API returns 200.

For rollback, restore the saved pre-migration JSON through preview/restore with a fresh current revision. This replaces the whole workspace and would remove changes made since the backup; review the affected scope first. Restores preserve a safety copy. Do not copy an open SQLite database without its WAL files; stop the server before file-level backup/recovery. Do not commit real workbooks, serial inventories or migration exports to the public source repository.

## 10. Worked example and agent handoff

[`examples/migration/workspace.json`](../examples/migration/workspace.json) is a complete example with a reusable microscopy requirements revision, a planned controller, a site/room/bench hierarchy, one built PC, serialized acquisition-card stock and bulk fitted parts. The accompanying seven CSV files were generated using the application's encoder. Import them in the order in section 7 or preview the JSON as a full replacement in an isolated workspace. The example quantities are opening-state evidence, not fabricated historical receipts. All catalog entries are unverified.

A useful instruction for a migration agent:

> Read docs/MIGRATION.md and the target version's schemas first. Inventory every workbook sheet and preserve source hashes/row references. Produce a mapping, deterministic identity crosswalk, exception report, complete seven-collection candidate, and per-component stock reconciliation. Keep requirements classes, physical locations, planned BOMs and actual installed stock distinct. Preserve text identifiers and unknown specifications. Validate in an isolated workspace, round-trip all CSVs and review engineering reports. Present ambiguous joins/counts and the exact replacement scope before cutover. Preserve a pre-migration backup, commit the accepted candidate using the current revision, then export/reconcile the result. Do not silently discard data, invent commissioning evidence, overwrite live data while investigating, or publish operational source data.

## Bay adapters and mounting accessories

Additional optional component specifications:

| Field | Type | Meaning |
|---|---|---|
| `bays525` | integer 0–10,000 | Chassis 5.25-inch mounting capacity |
| `bayTargets` | array of `{id,size}` | Individually named mounting spaces; size is `2.5`, `3.5`, or `5.25` |
| `baySize` | `2.5`, `3.5`, or `5.25` | Mounting bay size required by an adapter/accessory |
| `bayUnits` | integer 1–32 | Mounting spaces consumed per unit; omitted means one |
| `sataPowerPlugs` | integer 0–10,000 | Actual PSU SATA power connectors used per adapter/accessory unit |

Use category `Storage adapter` for a cage providing `driveTargets`, and `Bay accessory` for devices such as bay speakers. `bayTargets` name mounting spaces, while `driveTargets` name downstream drive positions; do not describe the same physical space as independent capacities in both lists. Chassis aggregate counts and named targets describe the same capacity. An adapter with `baySize` does not consume a PCI/PCIe slot unless `slotBus` is also explicitly set.

Example chassis and cage specifications:

```json
{
  "chassis":{"bays525":1,"bayTargets":[{"id":"external_1","size":"5.25"}]},
  "cage":{"baySize":"5.25","bayUnits":1,"sataPowerPlugs":1,"driveTargets":[
    {"id":"tray_1","mount":"front-hot-swap","driveSizes":["2.5"],"interfaces":["SATA"],"hotSwap":true,"bootable":true},
    {"id":"tray_2","mount":"front-hot-swap","driveSizes":["2.5"],"interfaces":["SATA"],"hotSwap":true,"bootable":true}
  ]}
}
```

On the cage placement, set `adapterPlacementId` to the chassis placement ID and `targetId:"external_1"`. Each drive placement uses `adapterPlacementId` equal to the cage placement ID and one of its tray IDs. Use quantity one for individually bound devices and providers. For the example above two SATA drives consume two SATA data links and the cage consumes one PSU SATA power plug. Do not count the trays again as independent chassis front hot-swap capacity. Missing cage power specifications require review; do not invent a known connector count. Declaring zero means no SATA power connectors (record other power needs in notes).

A speaker uses `baySize:"5.25",bayUnits:1` with no drive targets and binds to the chassis in the same way. Cages and accessories count mounting occupancy even when empty. For devices spanning multiple bays, `bayUnits` counts the full footprint, but the single `targetId` reserves only the named anchor; preserve adjacency and additional occupied bay IDs in provenance/notes for manual verification.

Stock allocations reuse these same provider and target fields. Use exact installed allocation IDs where several units match one planned provider; ambiguous references are conflicts. Commissioned configuration snapshots preserve the full topology. Existing CSV headers remain unchanged: the new specifications are nested in `specs`, and bindings stay in existing placement/allocation JSON cells. Suggestions in the editor normalize whitespace and case against catalog values; migration agents must still reconcile synonyms and differing source terminology explicitly before import.
