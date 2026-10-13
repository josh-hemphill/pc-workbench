import type { Database, System } from "./types";
import { installationLocationIds, locationPath } from "./installations";
export function equipmentLocation(system: System, db: Database): string {
  return system.installationLocationId
    ? locationPath(system.installationLocationId, db) || "Missing location"
    : system.location.trim() || "Unlinked location";
}
export function filterEquipmentSystems(
  db: Database,
  search = "",
  locationId = "",
  descendants = true,
): System[] {
  const locations = locationId && locationId !== "__unlinked"
    ? installationLocationIds(locationId, db, descendants)
    : null;
  const query = search.trim().toLowerCase();
  return db.systems.filter((system) =>
    (!locationId ||
      (locationId === "__unlinked"
        ? !system.installationLocationId
        : locations!.has(system.installationLocationId || ""))) &&
    `${system.name} ${
      equipmentLocation(system, db)
    } ${system.location} ${system.description}`.toLowerCase().includes(query)
  );
}
export function groupEquipmentSystems(
  systems: System[],
  db: Database,
  grouped: boolean,
) {
  if (!grouped) return [{ id: "all", label: "All equipment", systems }];
  const groups = new Map<
    string,
    { id: string; label: string; systems: System[] }
  >();
  for (const system of systems) {
    const id = system.installationLocationId || "__unlinked";
    const group = groups.get(id) ||
      {
        id,
        label: system.installationLocationId
          ? equipmentLocation(system, db)
          : "Unlinked locations",
        systems: [],
      };
    group.systems.push(system);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => a.label.localeCompare(b.label));
}
