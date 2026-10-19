# Catalog research handoff

In **Component catalog → Missing data**, use **Export selected research pack** or **Export filtered research pack**. Selected export includes selected rows hidden by filters. Filtered export includes every matching row across pages. If more than 1,000 components match, narrow the filters before exporting.

Give the downloaded JSON file to an agent along with this request:

> Follow the instructions in this research pack. Research the exact component models using manufacturer documentation. Fill only the proposal values you can establish, and provide a source URL and concise evidence for each. Keep IDs, names, categories and field paths unchanged. Leave unresolved values null. Return the updated JSON file; do not edit existing component data or claim verification.

The file contains:

- Existing component data as read-only context, including notes and named connector inventories.
- Category-specific missing core fields plus optional named port, slot, lane-rule and bifurcation proposals, with labels and value schemas. Known zero, false and named inventories are respected.
- Editable proposal slots with `path`, `value`, `sourceUrl` and `evidence`.
- Instructions embedded in the file, its format/version, export time and workspace revision.

Numbers and booleans must be JSON numbers and booleans, not strings. Arrays are JSON arrays. `null`, empty strings and empty arrays mean no proposal and are ignored. No core gaps does not certify complete engineering data: an unverified component may still require a human review of ports, slots, firmware and physical wiring.

The agent can return the full updated pack or a compact file:

```json
{
  "format": "pc-workbench-component-research",
  "version": 1,
  "components": [
    {
      "id": "cpu-example",
      "name": "Exact CPU model",
      "category": "CPU",
      "proposals": [
        {
          "path": "specs.threadCount",
          "value": 16,
          "sourceUrl": "https://manufacturer.example/specifications.pdf",
          "evidence": "Page 2, processor specifications: 16 logical threads."
        }
      ]
    }
  ]
}
```

`manufacturer`, `model`, `family` and `source` are top-level paths. Missing model/family metadata is offered as optional research and does not count as a mandatory core gap. Keep the exported top-level `model` identity unchanged when present; a proposed missing model belongs in `proposals`. Known model changes cause an identity conflict. Engineering values use `specs.<field>`. Use the paths and value schemas exported for each model rather than adding arbitrary fields.

## Review and import

Choose **Import research updates**, upload the returned JSON file (up to 8 MiB), and click **Read and preview file**. The preview is read-only and classifies each nonblank proposal:

- **Fill**: the same component identity exists, its scalar field is still missing or a named collection can add records/fill unknown properties, its proposed value is valid, and source evidence is present. These rows are initially selected.
- **Unchanged**: the value is already recorded. No change or new evidence is written.
- **Conflict**: an existing value differs, or the component was renamed or recategorized. Current data is preserved; identity changes require a fresh export.
- **Invalid**: the component was deleted, the field is unsupported, its value has the wrong type, or source/evidence is missing. It cannot be selected.

Select the Fill rows you accept. Header selection covers the current page; **Select all fillable proposals** covers the complete file. Changing the selection requires **Update preview** before applying. Other rows remain visible for review and are excluded from changes. A changed workspace revision or altered file/selection invalidates an old apply. Refresh the preview to review current data again.

Applying writes only selected, still-missing fields. It preserves IDs, names, categories, known values, existing notes and unselected records. Context and missing-field metadata in the file never write to component records. Each changed component receives source URLs, evidence and the research date in specification notes and remains unverified. Verification, replacement of known properties, deletion and clearing values are not supported through research imports; use the component editor for them. Source URLs are recorded without fetching pages.

The selected batch is validated as complete component records and committed atomically. Invalid resulting records or oversized specification notes block the apply. Shorten evidence or reduce the selection if notes would exceed their size limit. Keep the returned file as the original research artifact; imported provenance also travels with ordinary component CSV and JSON backups.

## API

- `POST /api/catalog/research/export` with `{ "componentIds": ["cpu-example"] }` returns the downloadable pack. It is read-only.
- `POST /api/catalog/research/preview` with `{ "file": <research-file>, "selected": ["cpu-example:specs.threadCount"] }` returns rows, the actual selected Fill keys, workspace revision and review token. Omit `selected` to initially select all Fill rows. It is read-only.
- `PUT /api/catalog/research/apply` requires `If-Match: <preview revision>` and `{ "file": <same-file>, "selected": <preview-selected>, "token": "<preview-token>" }`.

Exports and previews do not require a write revision. Apply requires the exact reviewed file and selection and the current workspace revision. Research packs may outlive their export revision: conflicts are assessed against current values at preview time, so research does not overwrite work done in the meantime.

## Named connectors and PCIe topology

On supported components the pack also includes `specs.ports`; motherboards include `specs.slots`, `specs.laneRules` and missing `specs.bifurcation`. These are optional research opportunities, not claims that a known inventory is incomplete. Existing version 1 files still work.

Submit a nonempty JSON array for each named collection. Reuse an existing ID for the same physical port, slot or rule. For an existing record, submit `id` and only the unknown properties you can establish. New records need all required properties in the exported schema. For example:

```json
[
  {
    "path": "specs.ports",
    "value": [{"id": "USB_A_1", "protocol": "USB 3.2 Gen 1", "speedMbps": 5000}],
    "sourceUrl": "https://manufacturer.example/manual.pdf",
    "evidence": "Rear I/O diagram identifies the existing USB_A_1 connector as 5 Gbit/s."
  },
  {
    "path": "specs.slots",
    "value": [{"id": "PCIE_1", "laneSource": "CPU", "bifurcationModes": ["x8/x8"]}],
    "sourceUrl": "https://manufacturer.example/manual.pdf",
    "evidence": "Expansion slot table: PCIE_1 is CPU-connected and supports x8/x8."
  },
  {
    "path": "specs.laneRules",
    "value": [{"id": "CPU_LANES", "slots": ["PCIE_1", "PCIE_2"], "maxLanes": 16}],
    "sourceUrl": "https://manufacturer.example/manual.pdf",
    "evidence": "Lane table: PCIE_1 and PCIE_2 share 16 lanes."
  }
]
```

These example IDs must already exist, or be supplied as complete new records in the same selected batch. Slot records can describe physical width, wired lanes, generation, CPU/chipset source and supported bifurcation modes. Lane rules cover shared lane budgets, mutually exclusive slots and disabled M.2/SATA endpoints. Unknown source must not be inferred from connector width.

Collections merge by stable ID. Omitted records and properties are retained. Known properties—including zero, false and empty arrays—cannot be changed. Explicitly empty named inventories cannot be expanded through research. Any conflicting property withholds the whole collection proposal; other safe proposals can still be selected. Preview shows the full current inventory and only the proposed new records/properties. Each collection counts as one selectable proposal.

`ports` is the component's complete named physical inventory, not a separate rear-panel-only list. Retain existing internal/front-panel connectors. When converting numeric-only USB/Ethernet counts to named ports, the list must exactly match every recorded count; conflicting counts require correction in the normal editor. New named ports derive the corresponding totals. Deselect a scalar count proposal if it disagrees with a simultaneously selected named inventory.

Selected slots and lane rules are validated together. Deselecting a slot proposal required by a selected rule blocks the batch until the selection is corrected. Unknown slot/SATA references, incomplete new records, duplicate IDs/positions and malformed values are rejected. Existing wiring IDs remain intact. Applied changes remain unverified; notes retain only actual additions/filled properties with source evidence rather than copying unchanged inventories.
