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

The API binds to loopback and rejects nonlocal Host/Origin requests. This is a single-user local tool. It has no authentication or concurrent-user conflict resolution. Keep it bound to loopback. `PORT` changes the API port (update the Vite proxy if changed in development). `BENCH_DATA_DIR=/absolute/path` changes the storage directory.

## Features

- Author, duplicate and save configurations with a bill of materials, workflow status, notes, linked equipment and live compatibility reports.
- Catalog chassis, motherboards, CPUs, memory, GPUs, specialized scientific PCI/PCIe cards, network cards, storage adapters, drives, PSUs and coolers.
- Record physical dimensions, CPU sockets, memory support, individual slots with physical connector width / electrical lanes / generation / rear position, port counts, bays and power capacity. Blank specifications are unknown; zero is a known absence.
- Check physical fit, card allocation (including adjacent bracket blockage and pinned assignments), USB-A / USB-C / Ethernet counts and storage resources.
- Plan independent data drives, two-drive mirrors, RAID 5, RAID 6 and RAID 10, plus separate mirrored boot pairs. All data drives in a configuration are one redundancy group. Usable capacity uses the smallest drive, in decimal GB/TB, before filesystem/RAID metadata overhead.
- Model separate internal bays, front SATA hot-swap bays, onboard M.2 NVMe slots and rear M.2 NVMe PCIe sleds. Sled slots and lanes count against the same motherboard resources as scientific cards. Passive sleds can require bifurcation.
- Track serialized component units with serial/asset numbers and bulk lots with counted quantities, home locations, serviceable/quarantined/retired condition and movement history.
- Reserve stock for builds, install reservations or available stock, partially release/remove bulk units, adjust counts with reasons, and edit recorded slot/mount/drive role. Prevent double allocation and negative availability.
- Manage actual PCs with independently recorded installed hardware and captured equipment/storage settings. Compare plans against installations and check build shortages and installed compatibility.
- Export/import each collection as CSV, download a whole-workspace JSON backup, and import saved product pages as unverified catalog entries.

## Data & CSV

On the first start, example records are written into `data/components.csv`, `data/systems.csv`, `data/configurations.csv`, and `data/pcs.csv`, with an empty `data/inventory.csv`. Existing files are read on later starts. **All example parts are illustrative and unverified; no brand-specific engineering claims are made.** Catalog entries and linked templates never invent physical stock or installation records.

Existing workspaces upgrade without replacing their records: a missing inventory file is created empty, and legacy PC CSVs without `buildSettings` load with that field set to `null`. Use **Edit PC & settings** to capture or enter settings for existing PCs.

Saving a collection validates all records and references, writes a temporary CSV, then atomically renames it. Changes in the UI are saved only when you press Save. CSV imports merge by `id`; matching IDs are updated, absent IDs are kept. Invalid rows and broken references reject the entire collection import. Deletion is blocked for records referenced by other records. Do not edit CSV files while the server is running; restart after external edits.

CSV headers:

| File | Columns |
| --- | --- |
| components.csv | id, name, category, manufacturer, specs, source, verified |
| systems.csv | id, name, location, description, connections |
| configurations.csv | id, name, description, systemId, status, updatedAt, placements, storage, notes |
| pcs.csv | id, name, serial, location, configurationId, notes, buildSettings |
| inventory.csv | id, componentId, tracking, serial, assetTag, quantity, location, condition, notes, allocations, history |

Nested columns (`specs`, `connections`, `placements`, `storage`, `buildSettings`, `allocations`, `history`) contain JSON, with standard CSV quoting. `verified` is `true` or `false`. IDs are stable, unique within a collection, and contain letters, numbers, hyphens or underscores (up to 80 characters). Export a collection to obtain a working template. Import components and systems first, then configurations, then PCs, then inventory. Refer to `shared/types.ts` and `server/schema.ts` for the full typed format and validation constraints. **movements.csv** is an additional flat, export-only inventory ledger for spreadsheets.

The backup is a snapshot of all five collections. To restore it, stop the server and convert each collection to CSV with `encodeCSV` from `server/store.ts`, or restore previously exported CSVs into the data directory. Keep backups outside the application folder.

## Physical inventory and built PCs

1. Add a component **type** to the catalog with its engineering specifications.
2. In **Component inventory**, receive each serialized unit (quantity 1) or a bulk lot. Serial numbers are unique per component type, case-insensitively. Nonempty asset/lot tags are unique across stock records. Use separate lots for different locations or conditions.
3. Register a PC and choose its planned configuration. New PCs capture the template’s equipment and storage settings when first saved. Existing PCs change those settings only when explicitly edited or copied in their editor.
4. Open the PC’s **Build readiness** tab to see required, installed, reserved and free stock quantities, plus procurement shortages. Reservations for other PCs are unavailable. Quarantined/retired units never satisfy serviceable stock requirements.
5. Allocate physical stock to the PC, optionally choosing its planned BOM placement. **Reserve** holds units; **Install** records actual hardware. Slot, mount and drive role are copied at allocation time and can be edited independently afterward.
6. Review **Installed compatibility** and **Planned versus installed**. These inspect actual installations and recorded PC settings. Editing a template changes the comparison target but does not change installed hardware or captured settings. Reservations are never treated as installations.
7. Release unused reservations or remove installed parts to return them to that stock record’s home location. Bulk allocations support partial install/release/removal. Use **Split / move lot** to transfer unallocated units to a new location or condition (for example, a repair/quarantine lot) without affecting other units. Both records save atomically and get linked movement history. A **Count adjustment** changes total lot quantity with a recorded reason; it cannot reduce stock below allocated quantities. Mark faulty units/lots quarantined; release/remove allocations before retiring stock.

Every receipt, stock metadata edit, count adjustment, reservation, installation, release, removal and placement change appends an event. Allocation balances and history are saved together in a single atomic replacement of `inventory.csv`. A stock record with history cannot be hard-deleted; retiring it preserves traceability. A PC with active allocations cannot be deleted. Historical events retain the PC name even if the PC is later deleted. Catalog types referenced by physical inventory are retained.

Inventory actions validate against the latest server state, so stale allocation attempts cannot double-book units. CSV imports are explicitly trusted data transfer operations: they can replace a matching record’s imported allocations and history, subject to identity, quantity and reference checks. The ledger is not tamper-proof against manual CSV edits. Removal from a bulk allocation initially returns units to that lot; split the returned units into another lot if their location or condition differs. The app is a local single-user tool, without procurement orders, costing or a concurrent multi-user workflow.

Inventory history is nested in the stock record so multi-lot transfers and balances commit together. Each CSV record is limited to 64 MiB; writes reject oversize records before replacing existing files. Web API request bodies are limited to 10 MB. Restore larger exports as local CSV files with the server stopped. This storage design is intended for local workbench-scale inventory.

## PCPartPicker import

```sh
pnpm import:pcpartpicker ./product.html --category CPU --output ./parts.csv --source https://pcpartpicker.com/product/example
```

Use a product page you saved locally from your browser. The offline importer reads standard `application/ld+json` Product blocks (including arrays and `@graph`) and extracts product name, brand, and URL. It creates deterministic IDs and unverified components; dimensions, slots, ports and other engineering fields must be entered manually. Output files are created exclusively to avoid silently overwriting existing files. Import the resulting CSV through **Data & imports**.

This does **not** scrape the live PCPartPicker database or claim access to an official public API. Actual page markup varies; pages without Product JSON-LD fail with a clear unsupported-format error. For richer data use manufacturer specifications or prepare CSV. A bulk scraper would require a confirmed accessible source and its supported access method.

## Compatibility boundaries

Reports are planning aids based on the entered specifications. Workflow approval is separate from compatibility health. The UI and API block approval when errors are present, but review warnings must be assessed by a person.

The following are flagged for manual verification: motherboard CPU support/BIOS version, PCIe/M.2 lane sharing and disabled SATA ports, CPU/PSU/GPU power connectors, PSU form factor, cooling and thermal capacity, scientific card drivers/OS/firmware, USB protocol/bandwidth/power, Ethernet speed/isolation, backplane drive-size compatibility, hot-plug/boot support and RAID implementation. PCIe slots are assumed to have their declared lanes simultaneously available. Conventional PCI is never treated as directly compatible with PCIe.

Front hot-swap bays are separate from internal bays. The current storage model supports SATA 2.5/3.5-inch drives and M.2 NVMe; U.2/U.3, SAS, external enclosures, risers/bridges, USB hubs, shared networks, multiple RAID groups and per-drive adapter binding require further modeling. Redundancy does not replace a backup.

## Structure

`src/` contains the Vue/Vuetify UI, including `InventoryWorkspace.vue` for physical stock and built PCs. `server/` handles the API, validation, inventory movements, CSV persistence and sample data. `shared/` contains types, engineering compatibility and stock/readiness/installed-system calculations used by both UI and server. `tools/` contains the offline importer. `tests/` exercises engineering rules, stock accounting, CSV round trips and upgrades from legacy workspaces.

Browser WebMCP is optional: where supported, the page registers read-only `list_configurations` and `check_configuration` tools. Ordinary browsers do not require this API.
