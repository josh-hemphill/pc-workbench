# Bench — PC configuration workbench

A local, full-stack TypeScript application using Vue 3, Vuetify 3, Vite, Express and pnpm. No account, cloud database or hosted service is required. Engineering data is saved on your dev machine in CSV files.

## Run

Use Node.js 22.12+ (Node 24 recommended) and pnpm 11.19.0. If using Corepack, run `corepack enable` first.

```sh
pnpm install
pnpm dev
```

Open **http://localhost:5173**. Vite proxies `/api` to the local API on port 3001. Both services stop with Ctrl+C. For a single-server local installation:

```sh
pnpm build
pnpm start
```

Open **http://127.0.0.1:3001**. `pnpm test` runs the compatibility, CSV persistence and importer tests. No Python runtime is used.

The API binds to loopback and rejects nonlocal Host/Origin requests. This is a single-user local tool. It has no authentication. A data-directory lock prevents two running servers from sharing the same workspace, and revision checks reject stale browser edits. Keep it bound to loopback. `PORT` changes the API port (update the Vite proxy if changed in development). `BENCH_DATA_DIR=/absolute/path` changes the storage directory.

## Features

- Author, duplicate and save configurations with a bill of materials, workflow status, notes, linked equipment and live compatibility reports.
- Catalog chassis, motherboards, CPUs, memory, GPUs, specialized scientific PCI/PCIe cards, network cards, storage adapters, drives, PSUs and coolers.
- Record physical dimensions, CPU sockets, memory support, individual slots with physical connector width / electrical lanes / generation / rear position, port counts, bays and power capacity. Blank specifications are unknown; zero is a known absence.
- Check physical fit, card allocation (including adjacent bracket blockage and pinned assignments), USB-A / USB-C / Ethernet counts and storage resources.
- Plan independent data drives, two-drive mirrors, RAID 5, RAID 6 and RAID 10, plus separate mirrored boot pairs. Named data arrays calculate independently; ungrouped data drives use the default redundancy setting. Usable capacity uses the smallest drive, in decimal GB/TB, before filesystem/RAID metadata overhead.
- Model separate internal bays, front SATA hot-swap bays, onboard M.2 NVMe slots and rear M.2 NVMe PCIe sleds. Sled slots and lanes count against the same motherboard resources as scientific cards. Passive sleds can require bifurcation.
- Track serialized component units with serial/asset numbers and bulk lots with counted quantities, home locations, serviceable/quarantined/repair/retired condition and movement history.
- Reserve stock for builds, install reservations or available stock, partially release/remove bulk units, adjust counts with reasons, and edit recorded slot/mount/drive role. Prevent double allocation and negative availability.
- Manage actual PCs with independently recorded installed hardware and captured equipment/storage settings. Compare plans against installations and check build shortages and installed compatibility.
- Export/import each collection as CSV, download and validate/restore a whole-workspace JSON backup, and import saved product pages as unverified catalog entries.

## Data & CSV

On the first start, example records are written into `data/components.csv`, `data/systems.csv`, `data/configurations.csv`, and `data/pcs.csv`, with an empty `data/inventory.csv`. Existing files are read on later starts. **All example parts are illustrative and unverified; no brand-specific engineering claims are made.** Catalog entries and linked templates never invent physical stock or installation records.

Existing workspaces upgrade without replacing their records: a missing inventory file is created empty, and legacy PC CSVs without `buildSettings` load with that field set to `null`. Use **Edit PC & settings** to capture or enter settings for existing PCs.

Saving a collection validates all records and references, flushes a temporary CSV, atomically renames it, and retains up to ten automatic whole-workspace recovery snapshots in `data/backups/`. The 10,000-record limit per collection is checked before writing as well as reading. Changes in the UI are saved only when you press Save. CSV imports merge by `id`; matching IDs are updated, absent IDs are kept. Invalid rows and broken references reject the entire collection import. Deletion is blocked for records referenced by other records. Do not edit CSV files while the server is running; restart after external edits.

CSV headers:

| File | Columns |
| --- | --- |
| components.csv | id, name, category, manufacturer, specs, source, verified |
| systems.csv | id, name, location, description, connections |
| configurations.csv | id, name, description, systemId, status, updatedAt, placements, storage, notes, software, portMappings, revision, approvalSnapshot, approvalHistory |
| pcs.csv | id, name, serial, location, configurationId, notes, buildSettings, lifecycle, software, commissioning, timeline, snapshot, snapshots |
| inventory.csv | id, componentId, tracking, serial, assetTag, quantity, location, condition, notes, supplier, purchaseOrder, reorderLevel, repairReference, supplierReturnReference, allocations, history |

Nested structures, including specifications, connections, placements, storage, build settings, allocations, history and snapshots, contain JSON, with standard CSV quoting. `verified` is `true` or `false`. IDs are stable, unique within a collection, and contain letters, numbers, hyphens or underscores (up to 80 characters). Export a collection to obtain a working template. Import components and systems first, then configurations, then PCs, then inventory. Refer to `shared/types.ts` and `server/schema.ts` for the full typed format and validation constraints. **movements.csv** is an additional flat, export-only inventory ledger for spreadsheets.

The backup is a snapshot of all five collections. In **Data & imports**, choose a JSON backup, validate the replacement counts, then restore it. Every collection and reference is checked together, a safety backup is saved first, and a durable journal protects a multi-file restore interrupted by a crash. If disk durability cannot be confirmed or rollback fails, the server blocks edits with a recovery-required message until restart. Keep independent backup copies outside the application folder. Spreadsheet-safe exports prefix formula-like text with an apostrophe; disable that option for exact CSV round trips.

## Physical inventory and built PCs

1. Add a component **type** to the catalog with its engineering specifications.
2. In **Component inventory**, receive each serialized unit (quantity 1) or a bulk lot. Serial numbers are unique per component type, case-insensitively. Nonempty asset/lot tags are unique across stock records. Use separate lots for different locations or conditions.
3. Register a PC and choose its planned configuration. New PCs capture the template’s equipment and storage settings when first saved. Existing PCs change those settings only when explicitly edited or copied in their editor.
4. Open the PC’s **Build readiness** tab to see required, installed, reserved and free stock quantities, plus procurement shortages. Reservations for other PCs are unavailable. Quarantined/retired units never satisfy serviceable stock requirements.
5. Allocate physical stock to the PC, optionally choosing its planned BOM placement. **Reserve** holds units; **Install** records actual hardware. Slot, mount and drive role are copied at allocation time and can be edited independently afterward.
6. Review **Installed compatibility** and **Planned versus installed**. These inspect actual installations and recorded PC settings. Editing a template changes the comparison target but does not change installed hardware or captured settings. Reservations are never treated as installations.
7. Release unused reservations, or remove installed parts with their destination and disposition: serviceable, quarantine, repair or retired. A partial bulk removal creates a separate returned lot atomically when the condition or destination differs, leaving other allocations unchanged. Bulk allocations support partial install/release/removal. Use **Split / move lot** to transfer unallocated units to a new location or condition (for example, a repair/quarantine lot) without affecting other units. Both records save atomically and get linked movement history. A **Count adjustment** changes total lot quantity with a recorded reason; it cannot reduce stock below allocated quantities. Mark faulty units/lots quarantined; release/remove allocations before retiring stock.

Every receipt, stock metadata edit, count adjustment, reservation, installation, release, removal and placement change appends an event. Allocation balances and history are saved together in a single atomic replacement of `inventory.csv`. A stock record with history cannot be hard-deleted; retiring it preserves traceability. A PC with active allocations cannot be deleted. Historical events retain the PC name even if the PC is later deleted. Catalog types referenced by physical inventory are retained.

Inventory actions validate against the latest server state, so stale allocation attempts cannot double-book units. Ordinary CSV imports preserve an existing stock record’s component identity and tracking mode. They remain trusted transfer operations that can replace imported allocations and history; use whole-workspace restoration when recovering identities. The ledger is not tamper-proof against manual CSV edits. Partial reservation installations record their source allocation ID. Supplier, purchase order and reorder-level fields support procurement planning; this is not an accounting or purchasing integration.

Inventory history is nested in the stock record so multi-lot transfers and balances commit together. Each CSV record is limited to 64 MiB; writes reject oversize records before replacing existing files. Web API request bodies are limited to 10 MB. Restore larger exports as local CSV files with the server stopped. This storage design is intended for local workbench-scale inventory.

## Commissioning and operations

PCs progress through Planning, Building, Commissioned, In service, Maintenance and Retired. **Commission PC** records the operator, validation checklist, date and notes, then captures the installed BOM, catalog specifications, equipment requirements and physical stock identities. Recommissioning keeps previous snapshots. Record the OS image, BIOS, component drivers/firmware, equipment application and configuration revisions. Lifecycle edits are recorded in the PC timeline. Decommissioning releases reservations and removes installed units to the chosen destination/disposition in one workspace transaction.

Approved configurations retain numbered BOM/specification/equipment snapshots; later catalog edits do not rewrite those records. Split multi-quantity card or drive lines into individual lines to record distinct slots or drive targets. Bind drives to a provider, target and controller, and assign data drives to named arrays. Structured equipment requirements map to specific ports on specific component instances. Port mappings and drive bindings are carried from planned placements to actual installations.

Reservations can record an owner, work order, needed-by date and expiry. Expiry is highlighted; releasing expired holds is an explicit audited action. Fleet planning shares the available stock pool across outstanding PC demand rather than giving every PC the same stock. Picklists can be exported, stock located using serial/asset/lot scans, and multiple serialized receipts received together. Bulk-to-serialized conversion preserves quantities and linked events. Repair/RMA references and separate return lots preserve the condition of healthy stock.

## API editing and recovery

`GET /api/state` includes a workspace `revision`, also returned in `X-Workspace-Revision`. Send it in `If-Match` for edits, deletes, CSV imports, restoration and commissioning/decommissioning. Missing preconditions return 428; stale preconditions return 409. Inventory movement commands validate against the current balances. Clients should reload after a successful change and review again after a conflict.

`POST /api/restore/preview` accepts `{ "backup": <database> }` and returns validated collection counts and the current revision. `POST /api/restore` accepts the same body with `If-Match`. Restoration replaces every collection, including histories; ordinary CSV imports merge instead. The server acquires `.server-lock.json` and releases it on normal shutdown; stale process locks are recovered at startup. If the lock cannot be verified, stop other servers before attempting manual recovery. Never edit live CSV files.

## PCPartPicker import

```sh
pnpm import:pcpartpicker ./product.html --category CPU --output ./parts.csv --source https://pcpartpicker.com/product/example
```

Use a product page you saved locally from your browser. The offline importer reads standard `application/ld+json` Product blocks (including arrays and `@graph`) and extracts product name, brand, and URL. It creates deterministic IDs and unverified components; dimensions, slots, ports and other engineering fields must be entered manually. Output files are created exclusively to avoid silently overwriting existing files. Import the resulting CSV through **Data & imports**.

This does **not** scrape the live PCPartPicker database or claim access to an official public API. Actual page markup varies; pages without Product JSON-LD fail with a clear unsupported-format error. For richer data use manufacturer specifications or prepare CSV. A bulk scraper would require a confirmed accessible source and its supported access method.

## Compatibility boundaries

Reports are planning aids based on the entered specifications. Workflow approval is separate from compatibility health. The UI and API block approval when errors are present, but review warnings must be assessed by a person.

The engine checks entered PCI voltage/keying and width, slot-specific bifurcation, shared lane budgets/exclusion rules, disabled SATA/M.2 counts, OS/driver/firmware requirements, physical port protocols/speeds/power/isolation, individual drive targets, and controller hot-plug/boot capability. Omitted capabilities produce review warnings. It does not discover motherboard topology or vendor support automatically. CPU support/BIOS, power connectors, PSU fit, thermal capacity and RAID implementation still require manufacturer verification. Conventional PCI is never treated as directly compatible with PCIe.

Front hot-swap bays are separate from internal bays. The current storage model supports SATA 2.5/3.5-inch drives and M.2 NVMe; U.2/U.3, SAS, external enclosures, risers/bridges, USB hubs, shared networks, detailed external transport and vendor-specific RAID implementations require further modeling. Redundancy does not replace a backup.

## Structure

`src/` contains the Vue/Vuetify UI, including `InventoryWorkspace.vue` for physical stock and built PCs. `server/` handles the API, validation, inventory movements, CSV persistence and sample data. `shared/` contains types, engineering compatibility and stock/readiness/installed-system calculations used by both UI and server. `tools/` contains the offline importer. `tests/` exercises engineering rules, stock accounting, CSV round trips and upgrades from legacy workspaces.

Browser WebMCP is optional: where supported, the page registers read-only `list_configurations` and `check_configuration` tools. Ordinary browsers do not require this API.
