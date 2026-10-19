# Fans, pumps and cooling connections

Use the **Fan** catalog category for replaceable fans. Receive bulk lots in Component inventory; new fan receipts default to bulk tracking. Reserve/install fans against PCs and remove them to Serviceable, Repair, Quarantined or Retired stock as appropriate. Installed fans remain assigned and unavailable to other builds. Fans cannot use Record usage, which permanently deducts consumable materials. Existing generic Consumable fan records can be reviewed and recategorized explicitly; no records are automatically converted.

## Catalog data

**Fan / Cooler → Cooling** contains named motor records. A cooler can contain several fans and a pump, with a count per motor record. Each records its power connector, voltage, maximum/startup current per motor, speed-control method, optional separate control/RPM plug, and whether RPM feedback is available. A separate power connection and control plug can describe a SATA-powered pump with a four-pin PWM/RPM connection. CPU socket and clearance specifications remain under Physical.

Motor power connectors distinguish standard three-pin and four-pin fan plugs, SATA power, peripheral four-pin power and proprietary power. Speed control independently distinguishes fixed speed, DC voltage regulation and PWM. A four-pin connector alone does not prove PWM support or the correct firmware setting. Blank ratings are unknown. Maximum/startup current must come from verified documentation; typical running current alone is insufficient for header safety.

**Motherboard / Bay accessory → Cooling** contains headers and shared current budgets. Record the board's printed header name, physical connector, supported modes, supply voltage, current limit and RPM support. Headers allow one motor by default. Increase the documented device limit only for verified splitter/hub wiring. Add shared budgets for headers that share a combined current limit, then assign each affected header to that budget. Three-pin headers cannot declare standard four-pin PWM support.

IDs are generated and kept stable; referenced motors/headers cannot be removed through the component form or advanced JSON. Display names can match manufacturer labels. Manufacturer topology, adapter pinouts, splitter wiring and firmware configuration still require verification.

## Plan and record wiring

Open **Configuration → Connections → Fan and pump wiring** to assign each motor to a header. Bulk fan quantities get separate indexed motor inputs. Multiple provider assemblies must be split into individual BOM lines before selecting their headers. Cooling routes are also editable when reserving, installing or configuring stock allocations. Wiring carries through installed-PC reports, comparisons, snapshots, CSV, JSON backup and SQLite restart; planned provider IDs resolve to actual allocation IDs.

The report checks missing/duplicate motor inputs, missing or ambiguous headers, required PWM pins, documented control support, voltage, motor count limits, per-header current and shared current budgets. A shared header cannot run DC and PWM modes simultaneously. It flags incomplete ratings and assignments, shared control and the usual single RPM channel on a splitter. Missing ratings do not imply that a connection is safe. Only known current subtotals can be compared with a limit.

SATA-powered motor current is not charged to a control-only motherboard header. In the motor component's Cooling section, record the physical SATA plugs used by the whole assembly. For multiple plugs, name each input under Storage. Connect them to PSU plugs in the build's SATA power wiring. Motors can share an assembly power input; do not count each motor as a separate physical plug unless documented. Peripheral/proprietary power, rail ratings and exact pinouts require manual review. Independently powered hubs and splitter/controller topology are not inferred automatically.

Changing motor counts may leave saved routes that no longer match. The wiring editor exposes these routes and provides an explicit clear action. Splitting an already wired BOM line is blocked until its wiring is cleared or reassigned. Partial stock allocations do not silently copy a whole multi-unit line's wiring; review the remaining units' assignments.

Total component power uses an explicit `powerW` when provided. Otherwise Fan/Cooler power can be estimated from all recorded motor voltage × current × count values. These estimates use the entered ratings and do not replace thermal, airflow or electrical engineering verification.

Fan frame dimensions can be recorded under Physical. Chassis fan mount positions, airflow, radiator fit and cooling performance require manual verification; the header checks do not allocate fan mounts.

## Quick header entry

In Motherboard → Cooling, **Quick fan layout** adds a CPU fan header (only if CPU_FAN is absent) and the chosen number of system fan headers. Select 4-pin or 3-pin once for the batch. Existing records and wiring IDs are preserved; repeat use appends system headers. Board labels can be adjusted afterward. **Add pump header** and **Add other header** handle exceptions. The shortcut records connector type only: control modes, voltage and current limits remain unknown until documented. Less common header settings are under **Control modes and electrical limits**. These controls are also available in the shared bulk editor.
