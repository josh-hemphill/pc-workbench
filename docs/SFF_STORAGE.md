# SFF storage and M.2 conversion

The Storage catalog selector edits one catalog at a time: motherboard M.2 slots, SATA data/power connectors, SFF output ports, or SFF input connectors. Motherboards do not expose chassis mounting bays or service-position fields. Chassis and backplane service positions remain in Physical.

Named motherboard slots use the existing `driveTargets` records to preserve configuration and inventory target IDs. Their supported module lengths, protocols, electrical PCIe lanes, boot support and disabled state are recorded per slot. A complete catalog overrides legacy `m2Slots`/`m2Lengths`; an empty catalog means zero slots. Legacy count-only workspaces remain supported. Generating slot names retains existing shared length declarations; it does not invent electrical lane counts. Old motherboard Physical bookmarks open Storage.

## Connector and route model

`sffPorts` and `sffInputs` describe physical connectors by stable ID, connector type, supported protocols, device channels, optional electrical PCIe lanes and disabled state. Connector type is selectable or free text. Generated IDs include its type. No protocol or channel capacity is inferred from an SFF connector number.

A placement's `sffConnections` binds a consumer input to a provider placement and port, a contiguous range of source device channels, optional PCIe lane demand, a cable assembly and its channel range. A direct drive uses one device channel. A backplane input can consume a multi-channel bundle; its service positions refer to that input through `sffInputId`. Mounted drives reuse the upstream bundle rather than consume another host channel. Ordinary SATA routes continue to work independently. Auxiliary power is recorded separately; a data cable does not establish power delivery.

Cable protocol, end A/end B, breakout direction and channel capacity are checked against the route. Forward breakout treats end A as the provider end; reverse breakout treats end B as the provider end. Record vendor connector names consistently. Unknown pinout or missing connector/capacity details remain review findings.

## M.2 to SFF workflow

1. Name the motherboard M.2 slots and enter each slot's supported lengths, NVMe support and electrical lane count.
2. Add a Storage adapter with role **M.2 to SFF adapter**. Enter its module length and SFF output port specifications. It occupies an M.2 slot, not a motherboard PCIe expansion slot.
3. Include the adapter, downstream drive or backplane, and cable assembly in the configuration BOM. Under Storage plan, bind the adapter to its upstream motherboard and occupied M.2 slot.
4. Add an SFF data route on the drive or backplane, select the adapter's output port, and record channel, lane and cable use.
5. Review compatibility and the SFF connection summary. Inventory Placement supports the same bindings with actual installed provider/cable identities.

A passive M.2 adapter cannot convert PCIe/NVMe into SATA/SAS, create additional lanes, or share its slot with a drive. Multiple downstream NVMe devices require review of bifurcation or active switching. Named and legacy lane-sharing restrictions both reduce the available M.2 budget; an unnamed disabled-slot rule requires verification of the chosen physical slot.

Configuration saves, CSV exports/imports, workspace backups, stock allocation inheritance and commissioned snapshots preserve SFF bindings. Provider/cable references are resolved to installed allocation IDs. Referenced connector and slot IDs cannot be deleted through the component editor; split BOM lines must first clear physical wiring.

## Prototype limits

This models point-to-point wiring and contiguous breakout groups, not SAS expander topology, multipath/failover, NVMe-oF, or PCIe switch oversubscription/performance. Passive backplanes consume upstream channels and cannot act as independent host controllers. Connector shapes do not prove pinout, firmware support, negotiated speed, hot-plug safety or power delivery; verify those against manufacturer documentation before approving a build.
