import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { decodeCSV, encodeCSV, Store } from "../server/store";
import { applyStockOperation, saveStockRecord } from "../server/inventory";
import {
  equipmentLocation,
  filterEquipmentSystems,
  groupEquipmentSystems,
} from "../shared/equipment-locations";
import {
  installedConfiguration,
  planDifferences,
  reorderSuggestions,
  stockCounts,
} from "../shared/inventory";
import {
  mapStorageBindings,
  storageBindingsMatch,
} from "../shared/storage-bindings";
import { schemas } from "../server/schema";
import type { Component, InstallationLocation } from "../shared/types";
const cable: Component = {
  id: "fanout-cable",
  name: "SFF-8643 to SATA fan-out",
  category: "Cable",
  manufacturer: "Example",
  source: "",
  verified: false,
  specs: {
    cableProtocol: "SATA/SAS",
    connectorA: "SFF-8643",
    connectorB: "4 × SATA 7-pin",
    cableChannels: 4,
    cableDirection: "forward-breakout",
    lengthMm: 500,
    stockUnit: "cable assembly",
  },
};
const pad: Component = {
  id: "thermal-pad",
  name: "Thermal pad 1.5 mm",
  category: "Consumable",
  manufacturer: "Example",
  source: "",
  verified: false,
  specs: {
    consumableKind: "Thermal pad",
    stockUnit: "sheet",
    thicknessMm: 1.5,
    lengthMm: 100,
    widthMm: 100,
  },
};
const loc = (
  id: string,
  name: string,
  parentId = "",
): InstallationLocation => ({
  id,
  name,
  parentId,
  kind: parentId ? "Bench" : "Site",
  requirementSetId: "",
  requirementRevision: 0,
  targetConfigurationId: "",
  notes: "",
});
function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-consumables-"));
  const store = new Store(dir);
  store.replace("components", [...store.db.components, cable, pad]);
  const receive = (componentId = pad.id) => {
    const stock = saveStockRecord({
      id: "consumable-lot",
      componentId,
      tracking: "bulk",
      serial: "",
      assetTag: "PAD-LOT",
      quantity: 100,
      location: "Parts cabinet",
      condition: "Serviceable",
      notes: "Initial receipt",
      reorderLevel: 80,
      allocations: [],
      history: [],
    }, store.db);
    store.replace("inventory", [...store.db.inventory, stock]);
    return stock;
  };
  return {
    store,
    receive,
    cleanup: () => {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("equipment locations search hierarchy labels and filter descendants without treating legacy labels as links", () => {
  const { store, cleanup } = setup();
  try {
    store.replace("installationLocations", [
      loc("site-a", "Building A"),
      loc("bench-a", "Bench 2", "site-a"),
      loc("site-b", "Building B"),
    ]);
    const base = store.db.systems[0];
    store.replace("systems", [
      ...store.db.systems,
      {
        ...base,
        id: "equipment-a",
        name: "Analyzer A",
        installationLocationId: "bench-a",
      },
      {
        ...base,
        id: "equipment-b",
        name: "Analyzer B",
        installationLocationId: "site-b",
      },
      { ...base, id: "legacy", name: "Legacy", location: "Building A" },
    ]);
    const db = {
      ...store.db,
      systems: store.db.systems.filter((system) =>
        ["equipment-a", "equipment-b", "legacy"].includes(system.id)
      ),
    };
    assert.equal(
      equipmentLocation(db.systems[0], db),
      "Building A / Bench 2",
    );
    assert.deepEqual(
      filterEquipmentSystems(db, "", "site-a").map((s) => s.id),
      ["equipment-a"],
    );
    assert.equal(
      filterEquipmentSystems(db, "", "site-a", false).length,
      0,
    );
    assert.deepEqual(
      filterEquipmentSystems(db, "", "__unlinked").map((s) => s.id),
      ["legacy"],
    );
    assert.equal(filterEquipmentSystems(db, "building a").length, 2);
    assert.equal(
      groupEquipmentSystems(db.systems, db, true).length,
      3,
    );
    assert.equal(
      groupEquipmentSystems(db.systems, db, false)[0].systems
        .length,
      3,
    );
  } finally {
    cleanup();
  }
});
test("equipment location links survive CSV and restart, and prevent deleting linked locations", () => {
  const { store, cleanup } = setup();
  try {
    store.replace("installationLocations", [
      loc("equipment-site", "Equipment site"),
    ]);
    const system = {
      ...store.db.systems[0],
      installationLocationId: "equipment-site",
    };
    store.replace(
      "systems",
      store.db.systems.map((s) => s.id === system.id ? system : s),
    );
    assert.equal(
      (decodeCSV("systems", encodeCSV("systems", [system]))[0] as typeof system)
        .installationLocationId,
      "equipment-site",
    );
    const legacy = encodeCSV("systems", [system]).split("\n").map((line) =>
      line.replace(/,installationLocationId\r?$/, "").replace(
        /,equipment-site\r?$/,
        "",
      )
    ).join("\n");
    assert.equal(
      (decodeCSV("systems", legacy)[0] as typeof system).installationLocationId,
      undefined,
    );
    assert.throws(
      () => store.replace("installationLocations", []),
      /installation location not found/,
    );
    assert.throws(
      () =>
        store.replace("systems", [{
          ...system,
          installationLocationId: "missing",
        }]),
      /installation location not found/,
    );
    store.close();
    const reopened = new Store(store.dir);
    try {
      assert.equal(
        reopened.db.systems.find((s) => s.id === system.id)
          ?.installationLocationId,
        "equipment-site",
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup();
  }
});
test("cable and consumable specifications round trip and enforce physical counts", () => {
  assert.deepEqual(
    decodeCSV("components", encodeCSV("components", [cable, pad])),
    [cable, pad],
  );
  assert.equal(
    schemas.components.safeParse({
      ...cable,
      specs: { ...cable.specs, cableChannels: 0 },
    }).success,
    false,
  );
  assert.equal(
    schemas.components.safeParse({
      ...pad,
      specs: { ...pad.specs, thicknessMm: -1 },
    }).success,
    false,
  );
});
test("usage deducts only free bulk consumables, preserves allocations and persists PC audit and reorder needs", () => {
  const { store, receive, cleanup } = setup();
  try {
    let stock = receive();
    stock = applyStockOperation(stock, {
      action: "reserve",
      pcId: store.db.pcs[0].id,
      quantity: 5,
    }, store.db).stock;
    store.replace(
      "inventory",
      store.db.inventory.map((s) => s.id === stock.id ? stock : s),
    );
    const next = applyStockOperation(stock, {
      action: "consume",
      quantity: 25,
      pcId: store.db.pcs[0].id,
      actor: "Engineer",
      workOrder: "WO-42",
      notes: "Thermal pads for rebuild",
    }, store.db).stock;
    assert.equal(stock.quantity, 100);
    assert.equal(next.quantity, 75);
    assert.equal(stockCounts(next).reserved, 5);
    assert.equal(stockCounts(next).available, 70);
    assert.equal(next.history.at(-1)?.action, "consume");
    assert.equal(next.history.at(-1)?.quantity, -25);
    assert.equal(next.history.at(-1)?.actor, "Engineer");
    assert.equal(next.history.at(-1)?.pcName, store.db.pcs[0].name);
    assert.match(next.history.at(-1)!.notes, /WO-42/);
    store.replace(
      "inventory",
      store.db.inventory.map((s) => s.id === next.id ? next : s),
    );
    assert.ok(
      reorderSuggestions(store.db).some((row) => row.componentId === pad.id),
    );
    assert.equal(
      (decodeCSV("inventory", encodeCSV("inventory", [next]))[0] as typeof next)
        .history.at(-1)?.action,
      "consume",
    );
    store.close();
    const reopened = new Store(store.dir);
    try {
      assert.equal(
        reopened.db.inventory.find((s) => s.id === next.id)?.quantity,
        75,
      );
    } finally {
      reopened.close();
    }
  } finally {
    cleanup();
  }
});
test("usage rejects insufficient, reserved, nonserviceable, serialized and nonconsumable stock without mutation", () => {
  const { store, receive, cleanup } = setup();
  try {
    const stock = receive(), original = JSON.stringify(stock);
    const usage = { action: "consume", quantity: 101, notes: "Usage" };
    assert.throws(
      () => applyStockOperation(stock, usage, store.db),
      /available stock/,
    );
    assert.throws(
      () =>
        applyStockOperation({ ...stock, condition: "Quarantined" }, {
          ...usage,
          quantity: 1,
        }, store.db),
      /serviceable bulk/,
    );
    assert.throws(
      () =>
        applyStockOperation(
          { ...stock, tracking: "serialized", quantity: 1, serial: "SERIAL" },
          { ...usage, quantity: 1 },
          store.db,
        ),
      /serviceable bulk/,
    );
    assert.throws(
      () =>
        applyStockOperation({ ...stock, componentId: "ram" }, {
          ...usage,
          quantity: 1,
        }, store.db),
      /cables and consumables/,
    );
    assert.throws(
      () =>
        applyStockOperation(
          stock,
          { ...usage, quantity: 1, pcId: "missing" },
          store.db,
        ),
      /PC not found/,
    );
    assert.throws(
      () =>
        applyStockOperation(
          stock,
          { ...usage, quantity: 1, notes: "  " },
          store.db,
        ),
      /reason/,
    );
    const reserved = applyStockOperation(stock, {
      action: "reserve",
      pcId: store.db.pcs[0].id,
      quantity: 32,
    }, store.db).stock;
    assert.throws(
      () => applyStockOperation(reserved, { ...usage, quantity: 69 }, store.db),
      /available stock/,
    );
    assert.equal(JSON.stringify(stock), original);
  } finally {
    cleanup();
  }
});
test("installed cable references resolve planned identities and participate in build drift comparison", () => {
  const { store, receive, cleanup } = setup();
  try {
    const pc = store.db.pcs[0],
      cfg = store.db.configurations.find((c) => c.id === pc.configurationId)!;
    const placement = {
      id: "cable-line",
      componentId: cable.id,
      quantity: 1,
      slotId: "",
      role: "general" as const,
      mount: "auto" as const,
      group: "",
    };
    const drive = cfg.placements.find((p) =>
      store.db.components.find((c) => c.id === p.componentId)?.category ===
        "Drive"
    )!;
    drive.sataDataConnections = [{
      controllerPlacementId: "",
      cablePlacementId: placement.id,
      cableChannel: 2,
    }];
    cfg.placements.push(placement);
    let cableStock = receive(cable.id);
    cableStock = applyStockOperation(cableStock, {
      action: "install",
      pcId: pc.id,
      quantity: 1,
      plannedPlacementId: placement.id,
    }, store.db).stock;
    const driveStock = saveStockRecord({
      id: "drive-stock",
      componentId: drive.componentId,
      tracking: "bulk",
      serial: "",
      assetTag: "DRIVE-LOT",
      quantity: drive.quantity,
      location: "",
      condition: "Serviceable",
      notes: "",
      allocations: [],
      history: [],
    }, store.db);
    const installedDrive = applyStockOperation(driveStock, {
      action: "install",
      pcId: pc.id,
      quantity: drive.quantity,
      plannedPlacementId: drive.id,
    }, store.db).stock;
    store.db.inventory = [cableStock, installedDrive];
    const actual = installedConfiguration(pc, store.db);
    assert.equal(
      actual.placements.find((p) => p.componentId === drive.componentId)
        ?.sataDataConnections?.[0].cablePlacementId,
      cableStock.allocations[0].id,
    );
    assert.equal(
      planDifferences(pc, store.db).some((row) =>
        row.includes(
          store.db.components.find((component) =>
            component.id === drive.componentId
          )!.name,
        )
      ),
      false,
    );
    installedDrive.allocations[0].sataDataConnections![0].cableChannel = 3;
    assert.ok(
      planDifferences(pc, store.db).some((row) =>
        row.includes(
          store.db.components.find((component) =>
            component.id === drive.componentId
          )!.name,
        )
      ),
    );
  } finally {
    cleanup();
  }
});
test("storage binding helpers preserve and compare physical cable channels", () => {
  const bindings = {
    sataDataConnections: [{
      controllerPlacementId: "board",
      cablePlacementId: "cable",
      cableChannel: 2,
    }],
  };
  const mapped = mapStorageBindings(bindings, (id) => "actual-" + id);
  assert.equal(mapped.sataDataConnections![0].cablePlacementId, "actual-cable");
  assert.equal(
    storageBindingsMatch(bindings, mapped, (id) => id.replace(/^actual-/, "")),
    true,
  );
  mapped.sataDataConnections![0].cableChannel = 3;
  assert.equal(
    storageBindingsMatch(bindings, mapped, (id) => id.replace(/^actual-/, "")),
    false,
  );
});

test("consumable API writes are revision guarded and failed usage never changes the ledger", async () => {
  const { createApp } = await import("../server/app");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-consumable-api-")),
    server = createApp(dir).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${
    (server.address() as { port: number }).port
  }`;
  const state = async () => await (await fetch(base + "/api/state")).json();
  const write = (
    route: string,
    body: unknown,
    revision: string,
    method = "POST",
  ) =>
    fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json", "If-Match": revision },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (await write(
        `/api/components/${pad.id}`,
        pad,
        (await state()).revision,
        "PUT",
      )).status,
      200,
    );
    const record = {
      id: "pad-api",
      componentId: pad.id,
      tracking: "bulk",
      serial: "",
      assetTag: "PAD-API",
      quantity: 20,
      location: "",
      condition: "Serviceable",
      notes: "",
      allocations: [],
      history: [],
    };
    assert.equal(
      (await write(
        "/api/inventory/pad-api",
        record,
        (await state()).revision,
        "PUT",
      )).status,
      200,
    );
    const revision = (await state()).revision,
      usage = { action: "consume", quantity: 7, notes: "Rebuild pads" };
    assert.equal(
      (await write("/api/inventory/pad-api/action", usage, revision)).status,
      200,
    );
    assert.equal(
      (await write("/api/inventory/pad-api/action", usage, revision)).status,
      409,
    );
    const before = await state();
    assert.equal(
      (await write(
        "/api/inventory/pad-api/action",
        { ...usage, quantity: 14 },
        before.revision,
      )).status,
      400,
    );
    assert.deepEqual(await state(), before);
    const stock = before.inventory.find((stock: { id: string }) =>
      stock.id === "pad-api"
    );
    assert.equal(stock.quantity, 13);
    assert.equal(stock.history.at(-1).quantity, -7);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
