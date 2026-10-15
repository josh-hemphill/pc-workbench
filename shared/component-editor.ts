import type { Component, Database, PortKind, Specs } from "./types.ts";
import type { ComponentSection } from "./component-fields.ts";
export type ComponentCollection =
  | "sffPorts"
  | "sffInputs"
  | "ports"
  | "slots"
  | "bayTargets"
  | "driveTargets"
  | "laneRules"
  | "sataDataPorts"
  | "sataPowerConnectors"
  | "sataDataInputs"
  | "sataPowerInputs";
export function typedIdPrefix(type: string) {
  return type.trim().toUpperCase().replace(/[^A-Z0-9_-]+/g, "_").replace(
    /-/g,
    "_",
  ).replace(/_+/g, "_").replace(/^_|_$/g, "").slice(0, 65) || "PORT";
}
export function nextComponentId(type: string, rows: { id: string }[]) {
  const prefix = typedIdPrefix(type);
  let index = 1;
  const ids = new Set(rows.map((row) => row.id));
  while (ids.has(`${prefix}_${index}`)) index++;
  return `${prefix}_${index}`;
}
export function portIdPrefix(kind: PortKind, customType?: string) {
  return kind === "Custom" ? `CUSTOM_${customType || "PORT"}` : kind;
}
export function supportsSlotBifurcation(component: Component) {
  return component.category === "Motherboard" &&
    component.specs.bifurcation !== false;
}
export function issueSection(
  path: PropertyKey[],
  component: Component,
): ComponentSection {
  const key = String(path[1] || "");
  if (path[0] !== "specs") return "basics";
  if (key === "ports" || ["usbA", "usbC", "ethernet"].includes(key)) {
    return "ports";
  }
  if (
    [
      "slots",
      "laneRules",
      "slotBus",
      "slotWidth",
      "requiredLanes",
      "minGeneration",
      "bracketWidth",
      "pciVoltage",
      "pciBits",
      "bifurcation",
      "bifurcationMode",
      "sledDrives",
      "requiresBifurcation",
      "sledHotSwap",
    ].includes(key)
  ) return "expansion";
  if (
    key.startsWith("sff") ||
    key === "driveTargets" && component.category === "Motherboard" ||
    key.startsWith("sata") || ["m2Slots", "m2Lengths"].includes(key)
  ) {
    return "storage";
  }
  if (
    [
      "bayTargets",
      "driveTargets",
      "baySize",
      "bayUnits",
      "supportedForms",
      "rearSlots",
      "maxCardLengthMm",
      "maxCardHeightMm",
      "maxCoolerHeightMm",
      "bays25",
      "bays35",
      "bays525",
      "hotSwapBays",
      "supportsSockets",
      "lengthMm",
      "heightMm",
      "widthMm",
    ].includes(key) && !["Cable", "Consumable"].includes(component.category)
  ) return component.category === "Motherboard" ? "review" : "physical";
  return key === "notes" ? "review" : "basics";
}
/** IDs referenced by current plans/installed hardware must stay stable. Historical snapshots retain their own catalog. */
export function componentReferences(
  component: Component,
  collection: ComponentCollection,
  id: string,
  db: Database,
): string[] {
  const refs = new Set<string>(), spec = component.specs;
  for (const target of spec.driveTargets || []) {
    if (
      collection === "sffInputs" && target.sffInputId === id ||
      collection === "bayTargets" && target.bayId === id ||
      collection === "sataDataInputs" && target.sataDataInputId === id ||
      collection === "sataPowerInputs" && target.sataPowerInputId === id
    ) refs.add(`Drive target ${target.id}`);
  }
  for (const rule of spec.laneRules || []) {
    if (
      collection === "slots" && rule.slots.includes(id) ||
      collection === "sataDataPorts" && rule.disableSataPortIds?.includes(id)
    ) refs.add(`Lane rule ${rule.id}`);
  }
  const inspect = (
    name: string,
    placements: {
      id: string;
      componentId: string;
      plannedPlacementId?: string;
      slotId: string;
      targetId?: string;
      adapterPlacementId?: string;
      bayTargetIds?: string[];
      sffConnections?: {
        providerPlacementId: string;
        portId: string;
        inputId?: string;
      }[];
      sataDataConnections?: {
        controllerPlacementId: string;
        portId?: string;
        inputId?: string;
      }[];
      sataPowerConnections?: {
        powerProviderPlacementId: string;
        connectorId?: string;
        inputId?: string;
      }[];
    }[],
    mappings: { placementId: string; portId: string }[] = [],
  ) => {
    const owns = (providerId: string, category: string) =>
      placements.some((row) =>
        row.componentId === component.id &&
        (providerId
          ? row.id === providerId || row.plannedPlacementId === providerId
          : db.components.find((c) => c.id === row.componentId)?.category ===
            category)
      );
    for (const row of placements) {
      if (
        collection === "ports" && row.componentId === component.id &&
        mappings.some((mapping) =>
          (mapping.placementId === row.id ||
            mapping.placementId === row.plannedPlacementId) &&
          mapping.portId === id
        )
      ) refs.add(name);
      if (
        collection === "slots" && row.slotId === id &&
        placements.some((p) => p.componentId === component.id)
      ) refs.add(name);
      if (
        collection === "driveTargets" && row.targetId === id &&
        owns(
          row.adapterPlacementId || "",
          component.category === "Motherboard" ? "Motherboard" : "Chassis",
        )
      ) refs.add(name);
      if (
        collection === "bayTargets" &&
        (row.bayTargetIds?.includes(id) || row.targetId === id) &&
        owns(row.adapterPlacementId || "", "Chassis")
      ) refs.add(name);
      for (const connection of row.sffConnections || []) {
        if (
          collection === "sffPorts" && connection.portId === id &&
            owns(connection.providerPlacementId, "Motherboard") ||
          collection === "sffInputs" && row.componentId === component.id &&
            connection.inputId === id
        ) refs.add(name);
      }
      for (const connection of row.sataDataConnections || []) {
        if (
          collection === "sataDataPorts" && connection.portId === id &&
            owns(connection.controllerPlacementId, "Motherboard") ||
          collection === "sataDataInputs" && row.componentId === component.id &&
            connection.inputId === id
        ) refs.add(name);
      }
      for (const connection of row.sataPowerConnections || []) {
        if (
          collection === "sataPowerConnectors" &&
            connection.connectorId === id &&
            owns(connection.powerProviderPlacementId, "PSU") ||
          collection === "sataPowerInputs" &&
            row.componentId === component.id && connection.inputId === id
        ) refs.add(name);
      }
    }
  };
  for (const config of db.configurations) {
    inspect(
      `Configuration ${config.name}`,
      config.placements,
      config.portMappings,
    );
  }
  for (const pc of db.pcs) {
    const rows = db.inventory.flatMap((stock) =>
      stock.allocations.filter((allocation) =>
        allocation.pcId === pc.id && allocation.state === "installed"
      ).map((allocation) => ({
        ...allocation,
        id: allocation.id,
        componentId: stock.componentId,
      }))
    );
    inspect(`PC ${pc.name}`, rows, pc.buildSettings?.portMappings);
  }
  return [...refs];
}
