import { test } from "node:test";
import assert from "node:assert/strict";
import type {
  Component,
  Configuration,
  Database,
  Placement,
  StockRecord,
} from "../shared/types.ts";
import { checkSffConnections, onboardM2Count } from "../shared/sff-connections.ts";
import {
  newTransitionScenario,
  transitionCohorts,
} from "../shared/transitions.ts";
import { checkConfiguration } from "../shared/compatibility.ts";
import { checkStorageConnections } from "../shared/storage-connections.ts";
import { componentSchema } from "../shared/component-schema.ts";
import { componentFields, componentSections } from "../shared/component-fields.ts";
import { componentCapabilities } from "../shared/component-capabilities.ts";
import { componentReferences, issueSection } from "../shared/component-editor.ts";
import {
  mapStorageBindings,
  storageBindingsMatch,
} from "../shared/storage-bindings.ts";
import { checkInstalledPC, installedConfiguration } from "../shared/inventory.ts";
import { schemas } from "../server/schema.ts";
import { applyStockAction } from "../server/inventory.ts";
import { decodeCSV, encodeCSV } from "../server/store.ts";
import { splitConfigurationPlacement } from "../shared/configuration-editing.ts";
const component = (
  id: string,
  category: Component["category"],
  specs: Component["specs"],
): Component => ({
  id,
  name: id,
  category,
  specs,
  manufacturer: "",
  source: "",
  verified: true,
});
const place = (id: string, extra: Partial<Placement> = {}): Placement => ({
  id,
  componentId: id,
  quantity: 1,
  slotId: "",
  role: "data",
  mount: "auto",
  group: "",
  ...extra,
});
function fixture() {
  const board = component("board", "Motherboard", {
    m2Slots: 9,
    m2Lengths: [42],
    driveTargets: [{
      id: "M2_1",
      mount: "internal",
      driveSizes: ["M.2"],
      interfaces: ["NVMe"],
      m2Lengths: [80],
      pcieLanes: 4,
      bootable: true,
    }],
    sataPorts: 0,
  });
  const converter = component("converter", "Storage adapter", {
    storageAdapterKind: "m2-converter",
    m2Length: 80,
    sffPorts: [{
      id: "OUT",
      connector: "SFF-8643",
      protocols: ["NVMe"],
      channels: 1,
      pcieLanes: 4,
    }],
  });
  const cable = component("cable", "Cable", {
    cableProtocol: "NVMe",
    connectorA: "SFF-8643",
    connectorB: "SFF-8639",
    cableChannels: 1,
    cableDirection: "bidirectional",
  });
  const drive = component("drive", "Drive", {
    driveInterface: "NVMe",
    driveSize: "2.5",
    storageMedium: "SSD",
    capacityGb: 1000,
    sffInputs: [{
      id: "IN",
      connector: "SFF-8639",
      protocols: ["NVMe"],
      channels: 1,
      pcieLanes: 4,
    }],
  });
  const cp = place("converter", {
      adapterPlacementId: "board",
      targetId: "M2_1",
    }),
    dp = place("drive", {
      sffConnections: [{
        inputId: "IN",
        providerPlacementId: "converter",
        portId: "OUT",
        channels: 1,
        pcieLanes: 4,
        cablePlacementId: "cable",
      }],
    });
  const config: Configuration = {
    id: "config",
    name: "config",
    description: "",
    systemId: "",
    status: "Draft",
    updatedAt: "2026-01-01T00:00:00Z",
    notes: "",
    placements: [place("board"), cp, place("cable"), dp],
    storage: { raid: "none", bootMirror: false },
  };
  const db: Database = {
    components: [board, converter, cable, drive],
    configurations: [config],
    systems: [],
    inventory: [],
    pcs: [],
    requirementsSets: [],
    installationLocations: [],
  };
  return { board, converter, cable, drive, cp, dp, config, db };
}
const has = (report: ReturnType<typeof checkSffConnections>, title: string) =>
  report.findings.some((f) => f.title === title);
test("M.2 adapter to SFF NVMe wiring uses one device channel and four lanes, without fabricating SATA capacity", () => {
  const f = fixture(), r = checkSffConnections(f.config, f.db);
  assert.deepEqual(r.findings.filter((f) => f.severity === "error"), []);
  assert.equal(r.links[0].channels, 1);
  assert.equal(r.links[0].lanes, 4);
  assert.equal(
    checkStorageConnections(f.config, f.db, {}).summary.dataChannels,
    0,
  );
  const report = checkConfiguration(f.config, f.db);
  assert.equal(
    report.resources.find((r) => r.name === "Onboard M.2 slots")!.used,
    1,
  );
  assert.equal(
    report.resources.find((r) => r.name === "Onboard M.2 slots")!.available,
    1,
  );
  assert.equal(componentCapabilities(f.converter).slotCard, false);
  assert.equal(componentCapabilities(f.converter).m2, true);
});
test("named motherboard M.2 slots replace legacy counts and lengths, including a complete empty catalog", () => {
  const f = fixture();
  assert.equal(onboardM2Count(f.board), 1);
  assert.ok(
    !componentFields(f.board).some((field) =>
      ["m2Slots", "m2Lengths"].includes(field.key)
    ),
  );
  f.board.specs.driveTargets = [];
  assert.equal(onboardM2Count(f.board), 0);
  delete f.board.specs.driveTargets;
  assert.equal(onboardM2Count(f.board), 9);
  assert.ok(!componentSections(f.board).includes("physical"));
  assert.equal(
    issueSection(["specs", "driveTargets", 0, "m2Lengths"], f.board),
    "storage",
  );
});
test("M.2-to-SFF adapters and native drives cannot occupy the same slot", () => {
  const f = fixture();
  f.db.components.push(
    component("native", "Drive", {
      driveSize: "M.2",
      driveInterface: "NVMe",
      m2Length: 80,
    }),
  );
  f.config.placements.push(
    place("native", { adapterPlacementId: "board", targetId: "M2_1" }),
  );
  assert.ok(has(checkSffConnections(f.config, f.db), "M.2 slot double booked"));
  assert.ok(
    checkConfiguration(f.config, f.db).findings.some((f) =>
      f.title === "Onboard M.2 slots capacity exceeded"
    ),
  );
});
test("converter missing, disabled, incompatible and wrong-length upstream slots are rejected", () => {
  for (const mode of ["missing", "disabled", "protocol", "length"]) {
    const f = fixture();
    if (mode === "missing") f.cp.targetId = "gone";
    if (mode === "disabled") f.board.specs.driveTargets![0].disabled = true;
    if (mode === "protocol") {
      f.board.specs.driveTargets![0].interfaces = ["SATA"];
    }
    if (mode === "length") f.converter.specs.m2Length = 42;
    assert.ok(
      has(
        checkSffConnections(f.config, f.db),
        {
          "missing": "M.2 converter slot missing",
          "disabled": "M.2 slot disabled",
          "protocol": "M.2 converter interface mismatch",
          "length": "M.2 converter length mismatch",
        }[mode]!,
      ),
    );
  }
});
test("passive M.2 adapters cannot manufacture lanes or SATA/SAS protocols", () => {
  const f = fixture();
  f.converter.specs.sffPorts![0].pcieLanes = 8;
  assert.ok(
    has(
      checkSffConnections(f.config, f.db),
      "M.2 converter lane capacity exceeded",
    ),
  );
  f.converter.specs.sffPorts![0].protocols = ["SAS"];
  assert.ok(
    has(
      checkSffConnections(f.config, f.db),
      "Passive M.2 converter protocol invalid",
    ),
  );
});
test("SFF protocol and PCIe lane incompatibilities are rejected independently of connector shape", () => {
  const f = fixture();
  f.converter.specs.sffPorts![0].protocols = ["SATA"];
  assert.ok(has(checkSffConnections(f.config, f.db), "SFF protocol mismatch"));
  f.converter.specs.sffPorts![0].protocols = ["NVMe"];
  f.converter.specs.sffPorts![0].pcieLanes = 2;
  assert.ok(
    has(checkSffConnections(f.config, f.db), "SFF PCIe lane capacity exceeded"),
  );
});
test("two consumers cannot double-book an SFF device channel or cable channel", () => {
  const f = fixture();
  f.config.placements.push({ ...structuredClone(f.dp), id: "drive2" });
  let r = checkSffConnections(f.config, f.db);
  assert.ok(has(r, "SFF channel double booked"));
  assert.ok(has(r, "Storage cable channel double booked"));
});
test("SFF endpoint catalogs reject missing connectors, duplicate IDs and invalid capacities", () => {
  const f = fixture();
  assert.ok(componentSchema.safeParse(f.converter).success);
  for (
    const changed of [{ connector: "" }, { channels: 0 }, { pcieLanes: -1 }]
  ) {
    const c = structuredClone(f.converter);
    Object.assign(c.specs.sffPorts![0], changed);
    assert.ok(!componentSchema.safeParse(c).success);
  }
  f.converter.specs.sffPorts!.push({ ...f.converter.specs.sffPorts![0] });
  assert.ok(!componentSchema.safeParse(f.converter).success);
});
test("SFF cable protocol, ends, breakout direction and channel capacity are verified", () => {
  for (const mode of ["protocol", "ends", "direction", "capacity"]) {
    const f = fixture();
    if (mode === "protocol") f.cable.specs.cableProtocol = "SATA/SAS";
    if (mode === "ends") f.cable.specs.connectorB = "SATA";
    if (mode === "direction") f.cable.specs.cableDirection = "reverse-breakout";
    if (mode === "capacity") f.dp.sffConnections![0].cableChannel = 2;
    assert.ok(has(
      checkSffConnections(f.config, f.db),
      {
        "protocol": "SFF cable protocol mismatch",
        "ends": "SFF cable connector or direction mismatch",
        "direction": "SFF cable connector or direction mismatch",
        "capacity": "SFF cable capacity exceeded",
      }[mode]!,
    ));
  }
});
test("SFF SATA breakout routes budget native SFF channels and separate SATA power, without using motherboard SATA ports", () => {
  const f = fixture();
  f.converter.specs.storageAdapterKind = "controller";
  f.converter.specs.sffPorts = [{
    id: "OUT",
    connector: "SFF-8643",
    protocols: ["SATA", "SAS"],
    channels: 4,
  }];
  f.drive.specs = { driveInterface: "SATA", driveSize: "2.5" };
  f.dp.sffConnections = [{
    providerPlacementId: "converter",
    portId: "OUT",
    sourceChannel: 2,
    cablePlacementId: "cable",
    cableChannel: 2,
  }];
  Object.assign(f.cable.specs, {
    cableProtocol: "SATA/SAS",
    cableChannels: 4,
    connectorB: "SATA",
    cableDirection: "forward-breakout",
  });
  assert.deepEqual(
    checkSffConnections(f.config, f.db).findings.filter((f) =>
      f.severity === "error"
    ),
    [],
  );
  const sata = checkStorageConnections(f.config, f.db, {});
  assert.equal(sata.summary.dataChannels, 0);
  assert.equal(sata.summary.powerPlugs, 1);
});
test("SFF backplanes use one upstream channel budget and do not double-count their SATA drives", () => {
  const f = fixture();
  f.converter.specs.storageAdapterKind = "controller";
  f.converter.specs.sffPorts = [{
    id: "OUT",
    connector: "SFF-8643",
    protocols: ["SATA"],
    channels: 4,
  }];
  f.drive.specs = { driveInterface: "SATA", driveSize: "2.5" };
  delete f.dp.sffConnections;
  const cage = component("cage", "Storage adapter", {
    storageAdapterKind: "bay-cage",
    sffInputs: [{
      id: "IN",
      connector: "SFF-8643",
      protocols: ["SATA"],
      channels: 4,
    }],
    driveTargets: [{
      id: "TRAY",
      mount: "front-hot-swap",
      driveSizes: ["2.5"],
      interfaces: ["SATA"],
      sffInputId: "IN",
    }],
  });
  f.db.components.push(cage);
  f.config.placements.push(
    place("cage", {
      sffConnections: [{
        inputId: "IN",
        providerPlacementId: "converter",
        portId: "OUT",
        channels: 4,
        cablePlacementId: "cable",
      }],
    }),
  );
  Object.assign(f.dp, { adapterPlacementId: "cage", targetId: "TRAY" });
  Object.assign(f.cable.specs, {
    cableProtocol: "SATA",
    cableChannels: 4,
    connectorB: "SFF-8643",
  });
  const report = checkSffConnections(f.config, f.db);
  assert.deepEqual(report.findings.filter((f) => f.severity === "error"), []);
  assert.equal(report.links[0].channels, 4);
  assert.equal(
    checkStorageConnections(f.config, f.db, {}).summary.dataChannels,
    0,
  );
  f.dp.quantity = 5;
  assert.ok(
    has(
      checkSffConnections(f.config, f.db),
      "SFF backplane channel capacity exceeded",
    ),
  );
});
test("SFF declarations and routes preserve exact CSV, JSON and configuration schema round trips", () => {
  const f = fixture();
  for (const c of f.db.components) {
    assert.deepEqual(schemas.components.parse(c), c);
  }
  assert.deepEqual(schemas.configurations.parse(f.config), f.config);
  assert.deepEqual(
    decodeCSV("components", encodeCSV("components", f.db.components)),
    f.db.components,
  );
  assert.deepEqual(
    decodeCSV("configurations", encodeCSV("configurations", [f.config])),
    [f.config],
  );
});
test("SFF bindings survive allocation inheritance and resolve planned provider and cable IDs to installed units", () => {
  const f = fixture();
  const pc = {
    id: "pc",
    name: "pc",
    serial: "",
    location: "",
    configurationId: "config",
    notes: "",
    buildSettings: null,
  };
  f.db.pcs.push(pc);
  for (const p of f.config.placements) {
    const stock: StockRecord = {
      id: "stock-" + p.id,
      componentId: p.componentId,
      quantity: 1,
      tracking: "serialized",
      serial: p.id,
      assetTag: "",
      location: "",
      condition: "Serviceable",
      notes: "",
      allocations: [],
      history: [],
    };
    f.db.inventory.push(
      applyStockAction(stock, {
        action: "install",
        pcId: "pc",
        quantity: 1,
        plannedPlacementId: p.id,
      }, f.db),
    );
  }
  const actual = installedConfiguration(pc, f.db),
    route = actual.placements.find((p) => p.componentId === "drive")!
      .sffConnections![0],
    converter = actual.placements.find((p) => p.componentId === "converter")!,
    cable = actual.placements.find((p) => p.componentId === "cable")!;
  assert.equal(route.providerPlacementId, converter.id);
  assert.equal(route.cablePlacementId, cable.id);
  assert.deepEqual(
    checkSffConnections(actual, f.db).findings.filter((f) =>
      f.severity === "error"
    ),
    [],
  );
  assert.ok(
    componentReferences(f.converter, "sffPorts", "OUT", f.db).includes(
      "Configuration config",
    ),
  );
  assert.ok(
    componentReferences(f.board, "driveTargets", "M2_1", f.db).includes(
      "Configuration config",
    ),
  );
});
test("SFF wiring comparison and BOM splitting respect provider identity and physical assignments", () => {
  const f = fixture(),
    bindings = mapStorageBindings(f.dp, (id) => "actual-" + id);
  assert.equal(
    bindings.sffConnections![0].providerPlacementId,
    "actual-converter",
  );
  assert.ok(
    storageBindingsMatch(
      f.dp,
      bindings,
      (id) => id.startsWith("actual-") ? id : "actual-" + id,
    ),
  );
  bindings.sffConnections![0].portId = "different";
  assert.ok(
    !storageBindingsMatch(
      f.dp,
      bindings,
      (id) => id.startsWith("actual-") ? id : "actual-" + id,
    ),
  );
  f.dp.quantity = 2;
  assert.throws(
    () => splitConfigurationPlacement(f.config, "drive", () => "split"),
    /physical bay or cable/,
  );
  f.cp.quantity = 2;
  assert.throws(
    () => splitConfigurationPlacement(f.config, "converter", () => "split"),
    /supplies other/,
  );
});
test("unknown SFF channels/lanes remain review findings, and disabled or missing named ports remain errors", () => {
  const f = fixture();
  delete f.converter.specs.sffPorts![0].channels;
  delete f.converter.specs.sffPorts![0].pcieLanes;
  let r = checkSffConnections(f.config, f.db);
  assert.ok(has(r, "SFF channel capacity unknown"));
  assert.ok(has(r, "SFF PCIe lane capacity unknown"));
  f.converter.specs.sffPorts![0].disabled = true;
  assert.ok(has(checkSffConnections(f.config, f.db), "SFF connector disabled"));
  f.dp.sffConnections![0].portId = "gone";
  assert.ok(has(checkSffConnections(f.config, f.db), "SFF port missing"));
});

test("passive backplanes cannot act as independent SFF host controllers", () => {
  const f = fixture();
  f.converter.specs.storageAdapterKind = "bay-cage";
  assert.ok(has(checkSffConnections(f.config, f.db), "SFF provider invalid"));
});
test("active M.2 lane-sharing restrictions require route review and reserve converter capacity", () => {
  const f = fixture();
  f.board.specs.laneRules = [{
    id: "SHARED",
    slots: ["PCIE_1"],
    disableM2Slots: 1,
  }];
  assert.ok(
    has(
      checkSffConnections(f.config, f.db, { "card:0": "PCIE_1" }),
      "M.2 lane-sharing route unconfirmed",
    ),
  );
});
test("explicit external NVMe auxiliary power inputs are counted separately from SFF data", () => {
  const f = fixture();
  f.drive.specs.sataPowerInputs = [{ id: "POWER" }];
  f.dp.sataPowerConnections = [{
    inputId: "POWER",
    powerProviderPlacementId: "psu",
    connectorId: "P1",
  }];
  f.db.components.push(
    component("psu", "PSU", { sataPowerConnectors: [{ id: "P1" }] }),
  );
  f.config.placements.push(place("psu"));
  const r = checkStorageConnections(f.config, f.db, {});
  assert.equal(r.summary.powerPlugs, 1);
  assert.equal(r.summary.dataChannels, 0);
  assert.deepEqual(r.findings.filter((f) => f.severity === "error"), []);
});

test("boot and hot-plug constraints propagate through a converter to the actual motherboard slot", () => {
  const f = fixture();
  f.dp.role = "boot";
  f.board.specs.driveTargets![0].bootable = false;
  assert.ok(
    has(checkSffConnections(f.config, f.db), "SFF provider cannot boot"),
  );
  f.board.specs.hotPlug = false;
  f.dp.mount = "front-hot-swap";
  assert.ok(
    has(checkSffConnections(f.config, f.db), "SFF hot-plug unsupported"),
  );
});
test("backplane drives propagate boot, hot-plug and controller identity to the upstream SFF route", () => {
  const f = fixture();
  f.converter.specs.storageAdapterKind = "controller";
  f.converter.specs.bootable = false;
  f.converter.specs.hotPlug = false;
  const cage = component("cage", "Storage adapter", {
    storageAdapterKind: "bay-cage",
    sffInputs: [{
      id: "IN",
      connector: "SFF-8639",
      protocols: ["NVMe"],
      channels: 1,
      pcieLanes: 4,
    }],
    driveTargets: [{
      id: "TRAY",
      mount: "front-hot-swap",
      driveSizes: ["2.5"],
      interfaces: ["NVMe"],
      sffInputId: "IN",
    }],
  });
  f.db.components.push(cage);
  f.config.placements.push(
    place("cage", { sffConnections: f.dp.sffConnections }),
  );
  delete f.dp.sffConnections;
  Object.assign(f.dp, {
    adapterPlacementId: "cage",
    targetId: "TRAY",
    role: "boot",
    controllerPlacementId: "board",
  });
  const r = checkSffConnections(f.config, f.db);
  assert.ok(has(r, "SFF provider cannot boot"));
  assert.ok(has(r, "SFF hot-plug unsupported"));
  assert.ok(has(r, "SFF controller route conflicts"));
});

test("SFF unknown backplane capacity cannot hide an insufficient upstream channel route", () => {
  const f = fixture();
  f.converter.specs.storageAdapterKind = "controller";
  f.converter.specs.sffPorts![0].channels = 4;
  f.cable.specs.cableChannels = 4;
  const cage = component("cage", "Storage adapter", {
    storageAdapterKind: "bay-cage",
    sffInputs: [{
      id: "IN",
      connector: "SFF-8639",
      protocols: ["NVMe"],
      pcieLanes: 4,
    }],
    driveTargets: [{
      id: "TRAY",
      mount: "front-hot-swap",
      driveSizes: ["2.5"],
      interfaces: ["NVMe"],
      sffInputId: "IN",
    }],
  });
  f.db.components.push(cage);
  f.config.placements.push(
    place("cage", { sffConnections: f.dp.sffConnections }),
  );
  delete f.dp.sffConnections;
  Object.assign(f.dp, {
    adapterPlacementId: "cage",
    targetId: "TRAY",
    quantity: 2,
  });
  const r = checkSffConnections(f.config, f.db);
  assert.ok(has(r, "SFF input channel capacity unknown"));
  assert.ok(has(r, "SFF backplane route insufficient channels"));
});
test("identical installed SFF builds group together for transitions despite different allocation IDs", () => {
  const f = fixture();
  for (const pcId of ["pc1", "pc2"]) {
    f.db.pcs.push({
      id: pcId,
      name: pcId,
      serial: "",
      location: "",
      configurationId: f.config.id,
      notes: "",
      buildSettings: null,
    });
    for (const p of f.config.placements) {
      const stock: StockRecord = {
        id: `${pcId}-${p.id}`,
        componentId: p.componentId,
        quantity: 1,
        tracking: "serialized",
        serial: `${pcId}-${p.id}`,
        assetTag: "",
        location: "",
        condition: "Serviceable",
        notes: "",
        allocations: [],
        history: [],
      };
      f.db.inventory.push(
        applyStockAction(stock, {
          action: "install",
          pcId,
          quantity: 1,
          plannedPlacementId: p.id,
        }, f.db),
      );
    }
  }
  const scenario = newTransitionScenario();
  scenario.pcIds = ["pc1", "pc2"];
  assert.equal(transitionCohorts(f.db, scenario).length, 1);
});
