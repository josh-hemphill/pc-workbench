# Catalog research handoff

In **Component catalog → Missing data**, use **Export selected research pack** or **Export filtered research pack**. Selected export includes selected rows hidden by filters. Filtered export includes every matching row across pages. If more than 1,000 components match, narrow the filters before exporting.

Give the downloaded JSON file to an agent along with this request:

> Follow the instructions in this research pack. Research the exact component models using manufacturer documentation. Fill only the proposal values you can establish, and provide a source URL and concise evidence for each. Keep IDs, names, categories and field paths unchanged. Leave unresolved values null. Return the updated JSON file; do not edit existing component data or claim verification.

The file starts with `guide`, `componentIndex` and shared JSON Schema definitions in `$defs`, before the raw component context. Per-component field descriptors reference these definitions rather than repeating schemas.

The file contains:

- Existing component data as read-only context, including notes and named connector inventories.
- Category-specific missing core fields plus optional named port, slot, lane-rule, fan/pump, cooling-header, shared-budget and bifurcation proposals, with labels and value schemas. Known zero, false and named inventories are respected.
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

## Schema guide and scripted navigation

Read `guide` first. It describes writable fields, merge behavior, evidence requirements, unresolved values, limits, validation and examples. `componentIndex` contains ID, name, manufacturer, model, family, category, available proposal paths, mandatory core gaps and optional research paths. Each index entry points to its component, proposals and existing data; `notesRef` points directly to notes when present.

`existingRecordIds` lets a script identify existing motor/header/port/slot/rule IDs. An absent collection path means its inventory is unknown; an empty array means an explicitly recorded empty inventory, which research cannot expand. The index and schemas are read-only context and never update records.

For a quick view without displaying the raw component context:

```sh
jq '.guide' component-research.json
jq '.componentIndex[] | select(.category == "Fan") | {id, model, availablePaths, notesRef}' component-research.json
jq '."$defs".new_specs_coolingDevices' component-research.json
```

Each component's `missingFields` descriptors include:

- `path`, `label`, `mode` and `optional`.
- `valueSchemaRef`, a JSON Pointer to the proposal value schema.
- For named collections, `newRecordSchemaRef` and `updateRecordSchemaRef`. New records require their full required fields; existing IDs can supply only the properties to fill.

All schema references resolve within the pack. Schemas are generated from the same field/record definitions used by the importer and appear once per type, shared across components. Existing component data remains available under `components[*].existing`.

For example, an agent can read notes for a selected model without printing the rest of the pack:

```python
import json

pack = json.load(open("component-research.json"))
def resolve(ref):
    value = pack
    for key in ref.removeprefix("#/").split("/"):
        key = key.replace("~1", "/").replace("~0", "~")
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value

entry = next(row for row in pack["componentIndex"] if row["id"] == "your-component-id")
notes = resolve(entry["notesRef"]) if "notesRef" in entry else ""
proposals = resolve(entry["proposalsRef"])
```

## Standalone JSON Schema

Choose **Download JSON Schema** in Research handoff, or request `GET /api/catalog/research/schema`. Save `component-research.schema.json` alongside the research file. The schema is self-contained JSON Schema Draft 2020-12; it does not need access to the workbench or external schema definitions.

It checks the envelope, supported proposal paths, typed scalar/record values, collection limits and source/evidence for nonblank proposals. With Python's `jsonschema` package installed:

```python
import json
from jsonschema import Draft202012Validator

schema = json.load(open("component-research.schema.json"))
returned = json.load(open("researched-components.json"))
Draft202012Validator(schema).validate(returned)
```

A named collection permits partial updates to existing IDs. For a **new** ID, also validate the record against its `newRecordSchemaRef`; use the original index to distinguish new and existing IDs. For example:

```python
new_motor_schema = {"$defs": schema["$defs"], "$ref": "#/$defs/new_specs_coolingDevices"}
Draft202012Validator(new_motor_schema).validate({"id": "NEW_FAN", "kind": "fan"})
```

Offline schema validation is an authoring check. Workbench preview still checks live identity/applicability, known values, ID/position uniqueness, complete merged-record constraints, references, total proposal count, note capacity and selected-batch dependencies. Validation does not establish that researched facts are correct or mark components verified.

Full reference metadata can be returned unchanged or omitted in a compact response. Keep `format`, `version`, component IDs/names/categories, exported model identities when present, and proposals. Older version 1 packs containing inline `valueSchema` metadata remain importable.

## API

- `GET /api/catalog/research/schema` returns the standalone schema as a downloadable file. It is read-only.
- `POST /api/catalog/research/export` with `{ "componentIds": ["cpu-example"] }` returns the downloadable pack. It is read-only.
- `POST /api/catalog/research/preview` with `{ "file": <research-file>, "selected": ["cpu-example:specs.threadCount"] }` returns rows, the actual selected Fill keys, workspace revision and review token. Omit `selected` to initially select all Fill rows. It is read-only.
- `PUT /api/catalog/research/apply` requires `If-Match: <preview revision>` and `{ "file": <same-file>, "selected": <preview-selected>, "token": "<preview-token>" }`.

Exports and previews do not require a write revision. Apply requires the exact reviewed file and selection and the current workspace revision. Research packs may outlive their export revision: conflicts are assessed against current values at preview time, so research does not overwrite work done in the meantime.

## Named connectors and PCIe topology

On supported components the pack also includes `specs.ports`; motherboards include `specs.slots`, `specs.laneRules` and missing `specs.bifurcation`. These are optional research opportunities, not claims that a known inventory is incomplete. Existing version 1 files still work.

Submit a nonempty JSON array for each named collection. Reuse an existing ID for the same physical port, slot or rule. For an existing record, submit `id` and only the unknown properties you can establish. New records need all required properties in `newRecordSchemaRef`; existing partial records use `updateRecordSchemaRef`. For example:

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

## Fans, pumps and cooling headers

Fan and Cooler records include optional `specs.coolingDevices` proposals. Motherboards and Bay accessories include `specs.coolingHeaders` and `specs.coolingHeaderGroups`. Existing cooling inventories on other component categories can also be researched. These optional collections do not add mandatory core gaps.

Motor records support `kind` (fan/pump), motor count, power connector, voltage, maximum/startup current **per motor**, speed control (PWM, DC voltage or fixed speed), a separate control/RPM connector and RPM-feedback availability. They do not currently model numeric RPM ranges. A 4-pin connector alone does not establish supported control modes, current ratings, splitter capacity or voltage; leave undocumented properties absent. Do not substitute typical running current for a documented maximum/startup requirement.

For example, to enrich an existing motor, use a proposal such as:

```json
{
  "path": "specs.coolingDevices",
  "value": [{"id": "FAN_1", "powerConnector": "Fan 4-pin", "voltageV": 12, "currentA": 0.25, "control": "PWM"}],
  "sourceUrl": "https://manufacturer.example/fan-manual.pdf",
  "evidence": "Electrical table: 12 V, maximum/startup current 0.25 A per fan, 4-pin PWM."
}
```

Use a complete new record with a stable `id` and `kind` when adding a motor; reuse the existing ID when filling properties. Pumps may use a separate power connection, such as SATA power, and a different control/RPM connector. Assembly power wiring remains in the component/build editors; research does not assign cables or cooling connections.

Headers describe connector type, supported control modes, supply voltage, per-header current limit, documented motor limit, RPM feedback and optional `limitGroup`. A shared budget records its stable ID and combined `maxCurrentA`. For example, submit these proposals together on the provider component:

```json
[
  {
    "path": "specs.coolingHeaders",
    "value": [{"id": "CPU_FAN", "connector": "Fan 4-pin", "controlModes": ["PWM"], "maxCurrentA": 1, "limitGroup": "FAN_BUDGET"}],
    "sourceUrl": "https://manufacturer.example/board-manual.pdf",
    "evidence": "CPU_FAN supports PWM and 1 A; its shared group is limited to 2 A."
  },
  {
    "path": "specs.coolingHeaderGroups",
    "value": [{"id": "FAN_BUDGET", "maxCurrentA": 2}],
    "sourceUrl": "https://manufacturer.example/board-manual.pdf",
    "evidence": "Header current-budget table: FAN_BUDGET has a 2 A combined limit."
  }
]
```

Shared-budget references must exist on the same component or be included in the selected batch. Deselecting a required budget blocks the apply; unresolved references are not saved. The existing merge rules apply: retain omitted records, fill unknown properties only, preserve zero/false/empty declarations, and withhold a whole collection if a known property conflicts. Standard 3-pin headers cannot declare 4-pin PWM support. Collection limits remain 32 motor records, 64 headers and 32 shared budgets per component.

Preview shows only actual additions and filled properties. Source evidence is retained, changed components remain unverified, and existing configuration/inventory wiring IDs are preserved. New motors and headers receive no automatic wiring assignments; review affected builds in **Connections → Fan and pump wiring**.
