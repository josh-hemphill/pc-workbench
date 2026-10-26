# Synthetic import workflow review

Reviewed 2026-10-21 using eight fictional starting datasets in isolated temporary workspaces. The reusable [fixture guide](../examples/synthetic-workflows/README.md) explains manual import and the two test runners. No existing user workspace was imported into or modified.

## What was checked

The public HTTP integration suite runs every scenario through whole-workspace restore and staged CSV imports, compares the resulting records, reuploads unchanged CSVs, persists and reopens plans, and round-trips JSON backups. Additional cases exercise registration, spreadsheet delimiters and headers, reimport after deleting all locations, invalid imports, stale revisions, survey recovery, stock pooling, capacity requirements, physical enumeration and commissioning.

The browser replay restores the datasets through Data & imports, opens their saved plans and checks findings and order-export availability. It also follows a PC link and browser Back, corrects a contradictory assumption in the normal PC editor, resolves unknown-capacity planning with a measured usage input and sufficient destination, checks selection across fleet pages and filters, reloads an autosaved draft, previews rejected/valid CSVs, and registers devices at imported locations.

## Expected results and recovery

| Dataset | Initial included / blocked | Observed recovery or invariant |
| --- | --- | --- |
| Locations only | 0 / 0 | Four selected benches can receive explicit device records; no parts are fabricated; site rows cannot receive PCs |
| Legacy linked plans | 4 / 0 | Planning remains provisional; bulk-recording documented assumptions enables conditional reuse |
| Assumed fleet | 6 / 0 | Both current hardware sources are planned; navigation returns to the selected fleet; planning leaves records unchanged |
| Partial contradiction | 2 / 1 | Correct the RAM assumption and configure its new planning group; all three become plannable. Operational receipt/install, complete survey and commissioning succeed |
| Stock pressure | 2 / 0 | Exactly 2 SSDs, 1 cage and 2 RAM modules to order. Outside reservations and unusable stock stay unavailable. Explicitly selected inactive PCs block without increasing demand |
| Unknown capacity | 1 / 2 | Measured usage plus the larger SSD destination resolves both blockers while preserving the pinned 6 TB minimum |
| Survey gaps | 0 / 4 | Explicit survey/assumption/evidence updates resolve all four; the location's target never substitutes for current hardware |
| Fleet scale | 120 / 0 | All 120 active PCs are selected across pages. Site A contains 63 active candidates; all 120 explicit selections remain, with 57 hidden. Draft recovery retains the scope |

Duplicate location IDs, missing parents, invalid survey states and inventory overallocations fail both preview and apply. No collection or workspace revision changes on rejection. A valid location export can be reimported after all old locations are removed. Reimporting unchanged files is a no-op.

## UX improvements implemented after review

- Both fleet order totals are visible above the table: one using confirmed stock, one conditional on hardware assumptions. The compact comparison has five columns, with expandable per-row stock arithmetic. Purchase filters can use either estimate; CSV exports retain the complete calculation.
- Hardware corrections can reuse available group inputs with an explicit action. The preview identifies the source group, destination, usage and evidence. Existing entries are preserved. Measurements copy only for matching drive models/counts, array roles and RAID; mappings do not cross different destinations. Requirements and compatibility are still checked, and a fresh review is required.
- Survey edits and bulk PC edits are accessible directly from the planner. Blocked PCs appear first by default, with their findings expanded, and findings can be searched. PC details remain available through the name link.
- Missing, retired and parts-only selections can be removed together. Hidden selections have a direct review action. Export requirements are stated beside the disabled export control.
- Registration reports which selected locations were skipped and why. Eligible locations can be unchecked before saving. Survey forms explain which missing inputs prevent planning while still allowing incomplete device records to be saved.
- Empty fleets link to installation locations so users can register known devices before planning.

Legacy linked plans deliberately retain conservative full-parts estimates until a documented current-hardware assumption is recorded. Reusing a measurement is an explicit proposal: its evidence still needs to cover the receiving group. No inventory is created by estimates or copied inputs.

The tested recovery paths complete. This is functional coverage of these inputs, not a performance benchmark or validation of real manufacturer specifications. The largest exercised fleet is 125 registered PCs / 120 active PCs; the application's 500-PC planning limit was not stress-tested here.

## Validation

- `pnpm fixtures:workflows --check`: generated JSON and CSV files match their source definitions.
- `pnpm test`: 461 passed, zero failed and one existing skip; the synthetic import suite contributes 15 tests, with six additional input-reuse regression tests.
- `pnpm build`: type checking, frontend and backend builds pass. The existing frontend chunk-size warning remains.
- Optional Chromium replay: scenario review/export paths, import/registration, navigation, blocker recovery and draft reload pass. Artifacts are written to the runner's temporary output folder.

## Installation editor follow-up

Location operations now exposes PC operations and Distribution review as separate counted views above the tables, sharing the location scope. Distribution review uses `#/installations/distribution`; existing `#/installations/operations` links continue to open PC operations. Browser history retains operation filters, selection and table context.

Requirements sets and equipment systems share an instrument editor. Add instrument is available even when no equipment exists, and each instrument has its own Add interface requirement action. Names, interface quantities, Custom interface names and stable reference IDs are validated. Optional connector, protocol, speed, power and isolation constraints sit behind an expandable section; existing recorded constraints are expanded. Publishing the next requirements revision preserves the previous revision and existing interface IDs.

After `pnpm build`, run `python tools/synthetic-workflows/installation-editors-browser.py` with Node 26 on PATH, Python Playwright and Chromium installed. The replay creates a temporary 100-PC workspace, checks section discovery and URL/history behavior, creates structured Serial and Custom requirements, checks required inputs, publishes a second revision and exercises the shared equipment editor. It never changes the active workspace.

## UX process review — 2026-10-26

Design guidance: [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md), read from the official repository. The audience is inventory and hardware staff moving between records, evidence, previews and physical work. The review prioritizes finding the next action, retaining context and recovering from errors.

Design plan before implementation: retain the user's theme system. Default reference tokens are background `#f6f7f4`, surface `#ffffff`, text `#26322b`, action `#284d37`, focus `#175d88`, error `#922f28`. Keep DM Sans for operational text and Manrope for headings. Keep controls left aligned and table columns comparable. Use existing spacing tokens and restrained error/focus emphasis. Optional detail stays expandable, but validation must reveal it. Long action labels must wrap on narrow screens. Do not add animation or decorative panels.

Layout intent: `context → inputs → preview/review → fixed actions`; error recovery returns focus to the failing input or visible error. Table navigation restores the user's search, sort, page size, page and selection. Critique against the brief: a visual redesign would add relearning without improving these processes, so this pass changes interaction and recovery rather than introducing a new palette or page chrome.

Confirmed findings and fixes:

| Finding | Evidence / impact | Fix |
| --- | --- | --- |
| Hidden validation failure | Invalid requirement ID inside closed Reference ID details stayed hidden after Save, with focus left on the action | Shared validation recovery opens ancestor details, scrolls to the field and focuses it; used by root, installation and bulk forms |
| Lost table working context | Shared table history stored search/page/selection but omitted sort and page size | Store controlled sort and rows-per-page alongside existing context; browser verified a descending catalog sort, 10 rows per page and second-page position through navigation away and Back |
| Long-form server failure out of view | Requirements form could be submitted while scrolled past the alert at its top | Reveal and focus matching visible error feedback after rendering; shared by requirements, bulk, research, identification, merge and settings flows |
| No-result table recovery | Empty shared table results gave no direct action near the result | Show the actual search text and a Clear search action; preserve selection |
| Inconsistent error wording | Installation handlers rendered JavaScript's `Error:` prefix while other forms rendered the message | Display the error message consistently |

The suspected mobile action overflow was **not** reproduced: at 390 px the 100-PC bulk selection label already wraps and its action stays within the viewport. Existing mobile action styling was retained. Screenshot critique confirmed that error recovery keeps the fixed header/actions visible and brings the failure into the scrollable body without adding page chrome.

Validation: `ux-review-browser.py` reproduces the collapsed-field case, verifies table history and empty-search recovery, injects a stale-workspace response into a long requirements form, and checks narrow-screen action access in an isolated 100-PC workspace. The existing eight-scenario fleet replay covers fresh imports, registration, missing surveys/capacities, stock pressure, blocked transitions, measured-usage recovery, exports, selection and draft persistence. Identification and installation-editor browser replays cover stock splitting, shared configuration copies, instrument creation and immutable revision publication. These are synthetic workspaces, not an observation of live operator sessions.

## Progressive inspection and donor-PC review — 2026-10-26

The findings below describe the preimplementation state; the implemented follow-up is recorded after the proposal.

Scope: PCs reported at locations without a hardware enumeration; PCs rediscovered after moving; partial onsite visits; unpowered donor/scrap PCs opened one at a time; parts identified, removed, tested or already disposed of at different times. This section is a review and implementation proposal, not a change to inventory rules.

### Confirmed gaps

1. **High: existing-part discovery has no dedicated operation.** `InventoryWorkspace.openAllocation` and `applyStockOperation` block Parts only PCs. An operator must return a donor to Building to enumerate contents through the installation path. This misstates the work being done and can require subsequent lifecycle cleanup. Preserve the installation restriction; add an audited observation/discovery operation that can enumerate parts already physically present on a Parts only donor without allowing new installation, reservation or commissioning.
2. **High: presence requires a claim of serviceability.** The installation operation requires Serviceable stock. Parts seen in an unpowered machine may be untested or faulty. Discovery should record physical custody while keeping untested/quarantined units unavailable for purchase/reuse credit. Identifying a model must not mark a unit healthy. Separate stock records when conditions differ.
3. **High: former-location work queues are missing.** Location filters use current `installationLocationId`. Moves retain readable old/new location paths in timeline summaries, but there is no structured former-location filter or assignment interval. Add current / previously at / either filters backed by structured location IDs and dates, with actor and evidence. Preserve names at observation time. Legacy free text may be a search hint; do not infer authoritative historical assignments from it.
4. **Medium: the inspection context is fragmented.** PC details offer Allocate from stock, while new stock requires an existing catalog component. A new model found while opening a donor requires catalog creation, stock receipt, then allocation in separate contexts. Add PC-centered Search catalog / Create model / Record unidentified part, returning to the same PC, category and inspection session. Reuse the normal component editor and selective identification tools. Do not force full specifications or verification before saving a readable label/model.
5. **Medium: survey completion is not a coverage checklist.** `savePCRecord` accepts complete with no installed records or evidence. An empty shell is legitimate, but today it is indistinguishable from a machine whose categories were never checked. Record category outcomes: not checked, present/identified, present/unidentified, confirmed absent, or inaccessible. Complete should mean the agreed inspection scope was accounted for, including explicit absence; it must not imply serviceability or complete catalog specifications.
6. **Medium: evidence is mostly a single editable text field.** Survey source/date is free text, while updates enter a general PC timeline. Add append-only inspection sessions with observed-at, recorded-at, observer, current physical location, reported former location, evidence references and category observations. Support pause/resume and follow-up reasons. Photographs/label transcriptions should remain usable even before a catalog match exists.

Checks executed against cloned seed data: Parts only discovery through install rejected; Quarantined discovery through install rejected; complete accepted with zero inventory/evidence; PC moved between two synthetic benches omitted from old-location query while move text remained in history. No live data was changed.

### Proposed operator workflow

1. Find the PC by asset/serial, current or former location, or donor queue. Reuse a matching PC; prompt about possible duplicates before registering another reported device. Keep current location separate from where it was last reported.
2. Start or resume an inspection session. Record whether access is an OS report, exterior label, opened case or test bench. Record physical observations without changing lifecycle or copying a template into inventory.
3. Work through categories, starting with chassis identity and motherboard, then CPU, memory, drives, cards, cooling and bay hardware/cabling. Support a quick label/model/count entry; expand detailed ports, lane rules or wiring only when inspected. A total RAM figure is not proof of module count or capacity.
4. Match existing inventory/serials first. For genuinely new discoveries, create a physical unit/lot and attach it to that PC atomically, with discovery provenance. Default new discoveries to untested/quarantined. Ensure they never appear temporarily as free warehouse stock. Repeated saves or a resumed session must not duplicate units.
5. Save identified models to the catalog or retain explicit placeholders. Machine-specific clues belong to that unit/session. Do not enrich a shared Unknown RAM catchall with a model found in only one PC; resolve selected uses to the identified model.
6. Mark categories checked, absent or deferred and save progress. Flag contradictions with the earlier assumed configuration; retain the original evidence and propose revising the assumption rather than rejecting a true observation or rewriting every PC sharing that template. Planning remains provisional while relevant uncertainties remain.
7. For salvage, distinguish observed inside donor, physically removed to a destination, tested, and discarded. Reuse existing removal/transfer audit paths after discovery. An observed part still inside a donor is not available stock. Catalog knowledge may remain after the physical unit is disposed of.

Historical notes such as “this PC used to contain this drive” must remain evidence unless current physical possession is confirmed; they must not recreate stock or installed allocations. A retired PC can receive a historical inspection note without reopening lifecycle; live discoveries on a supposedly empty retired record need an explicit reconciliation process. Decommissioning must not imply that unenumerated contents were all removed.

### Suggested implementation order

First add PC-centered inspection sessions and a dedicated atomic discovery operation, including Parts only and untested custody rules. Next add category coverage and the inline catalog/placeholder flow. Then add structured location history and location-based inspection queues. Keep existing commissioning, approval snapshots, stock conservation and stale-revision checks throughout.

Acceptance scenarios: reported device with no assumed configuration; partial visit; observed hardware contradicts a shared assumption; unpowered Parts only donor with no known inventory; a serial already recorded elsewhere; several RAM models under one catchall; empty shell with explicit absence; part removed between sessions; interrupted/retried save; formerly located device; evidence of an already-scrapped part; and a supposedly retired device found to contain physical parts.


### Inspection implementation and UX review

The PC detail now has a URL-addressable Inspection tab (`#/pcs/<id>/inspection`), also linked from Location operations. Its compact header keeps commissioning/allocation actions on the ordinary PC views. The workbench separates Observations & parts, Coverage and Saved evidence so the fifteen-category checklist cannot hide part entry. New catalog models/placeholders use the shared component editor; detailed specifications remain optional. Observation dates use a local date/time control, stored as UTC. A distinct review lists units and catalog identities before saving. Navigation away requires discarding unsaved observations explicitly.

Each save appends immutable evidence with an inspection/session ID, observed/recorded times, observer, access method, current location snapshot, reported provenance, coverage, and discovered-stock links. Saved progress resumes coverage and the unfinished session. Different saves never edit accepted earlier entries. Evidence supports label transcriptions and report/photo references; this does not add binary photo uploads.

The dedicated discovery operation atomically adds or matches physical stock, records installed custody and audits the observation. It works on Parts only donors without changing lifecycle. New stock is quarantined and never temporarily free. Existing unallocated stock keeps its condition and total quantity. Existing allocations, serials and asset tags cannot silently duplicate or move. Replayed save IDs with identical input are no-ops; changed payloads, stale previews and transaction failures cannot partially write. Wiring is not guessed; use existing placement tools after recording presence. Removal/testing/disposal continue through inventory actions.

Coverage distinguishes unchecked, present/identified, present/identity-needed, confirmed absent and inaccessible. Completion requires every category accounted for and rejects absence conflicting with installed records. A finished enumeration can contain untested/unknown parts; compatibility and commissioning still enforce their own constraints. After using inspection sessions, ordinary PC editing cannot clear inspection status or bypass the coverage completion step. Legacy survey records remain compatible. Partial observations preserve earlier assumptions and planning detects contradictions instead of blocking observation capture.

Retired PCs accept historical evidence only. Physical discoveries require explicit lifecycle/custody reconciliation first. Historical-only reports never create inventory or finish surveys. Decommissioning explains that only enumerated allocations are removed; uninspected contents are not proven absent.

Moves recorded from this version onward retain structured old/new IDs, paths and timestamps. Location operations filters currently at / previously at / either; PC and operation searches include saved provenance and known historical paths. Older timeline prose remains searchable as a lead, and is not inferred into authoritative assignment history. Move actor remains unknown where the existing assignment editor supplies no actor.

Validation covers donor custody, quarantined/repair stock, duplicates/retries, inline placeholders, empty shells, contradictory coverage, immutable evidence, CSV/backup round trips, former-location matching, future dates, stale tokens, HTTP revision guards and transaction rollback. `inspection-browser.py` exercises the real donor workflow, inline catalog creation, discard protection, progress/resume, coverage completion, former-location queue and retired evidence, plus a narrow viewport. Existing fleet, identification and installation-editor replays check regressions around those paths.
