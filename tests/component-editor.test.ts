import { test } from "node:test";
import assert from "node:assert/strict";
import { seed } from "../server/seed";
import { schemas } from "../server/schema";
import { componentSchema } from "../shared/component-schema";
import {
  componentReferences,
  issueSection,
  nextComponentId,
  portIdPrefix,
  supportsSlotBifurcation,
  typedIdPrefix,
} from "../shared/component-editor";
import {
  componentFields,
  componentSections,
  fieldSection,
} from "../shared/component-fields";
import { categories, type Component } from "../shared/types";
const part = (
  category: Component["category"],
  specs: Component["specs"] = {},
): Component => ({
  id: "test-component",
  name: "Test",
  category,
  manufacturer: "",
  source: "",
  verified: false,
  specs,
});
test("typed endpoint IDs are valid and unique across large mixed catalogs without renaming existing IDs", () => {
  assert.equal(portIdPrefix("USB-A"), "USB-A");
  assert.equal(typedIdPrefix("USB-C"), "USB_C");
  assert.equal(
    nextComponentId("USB-A", [{ id: "USB_A_1" }, { id: "PORT_1" }]),
    "USB_A_2",
  );
  const rows = Array.from(
    { length: 100 },
    (_, i) => ({ id: `SERIAL_${i + 1}` }),
  );
  assert.equal(nextComponentId("Serial", rows), "SERIAL_101");
  assert.equal(rows[0].id, "SERIAL_1");
  for (
    const name of [
      "PCIe",
      "SATA_POWER_IN",
      portIdPrefix("Custom", "RS-485 / isolated"),
      "".padEnd(500, "X"),
    ]
  ) assert.match(nextComponentId(name, []), /^[A-Z0-9_-]{1,80}$/);
});
test("all component categories expose only applicable sections and assign every scalar field to an accessible section", () => {
  for (const category of categories) {
    const component = part(category);
    const sections = componentSections(component);
    assert.equal(sections[0], "basics");
    assert.equal(sections.at(-1), "review");
    for (const field of componentFields(component)) {
      assert.ok(
        sections.includes(fieldSection(field.key, component)),
        `${category} ${field.key}`,
      );
    }
  }
  assert.deepEqual(componentSections(part("Cable")), ["basics", "review"]);
  assert.deepEqual(componentSections(part("Consumable")), ["basics", "review"]);
  assert.ok(
    !componentSections(
      part("Storage adapter", { storageAdapterKind: "bay-cage" }),
    ).includes("expansion"),
  );
  assert.ok(componentSections(part("Motherboard")).includes("expansion"));
});
test("component schema is shared without changing backend validation or legacy data", () => {
  for (const component of seed.components) {
    assert.deepEqual(
      componentSchema.parse(component),
      schemas.components.parse(component),
    );
  }
  assert.equal(
    componentSchema.safeParse(
      part("Motherboard", {
        ports: [{ id: "ETHERNET_1", kind: "Ethernet" }, {
          id: "ETHERNET_1",
          kind: "Ethernet",
        }],
      }),
    ).success,
    false,
  );
  assert.equal(
    componentSchema.safeParse(
      part("Motherboard", { ports: [{ id: "CUSTOM_1", kind: "Custom" }] }),
    ).success,
    false,
  );
});
test("explicit unsupported bifurcation hides slot modes while unknown and supported keep them available", () => {
  const board = part("Motherboard", {
    bifurcation: false,
    slots: [{
      id: "PCIE_1",
      bus: "PCIe",
      physical: 16,
      lanes: 16,
      generation: 4,
      position: 1,
      bifurcationModes: ["x8/x8"],
    }],
  });
  assert.equal(supportsSlotBifurcation(board), false);
  board.specs.bifurcation = true;
  assert.equal(supportsSlotBifurcation(board), true);
  delete board.specs.bifurcation;
  assert.equal(supportsSlotBifurcation(board), true);
  assert.deepEqual(board.specs.slots![0].bifurcationModes, ["x8/x8"]);
});
test("validation issue paths route to the relevant selected-record section", () => {
  const board = part("Motherboard");
  for (
    const [key, section] of [
      ["ports", "ports"],
      ["slots", "expansion"],
      ["laneRules", "expansion"],
      ["sataDataInputs", "storage"],
      ["driveTargets", "physical"],
      ["bayTargets", "physical"],
    ] as const
  ) assert.equal(issueSection(["specs", key, 17, "id"], board), section);
  assert.equal(issueSection(["name"], board), "basics");
  assert.equal(
    issueSection(["specs", "thicknessMm"], part("Consumable")),
    "basics",
  );
});
test("reference discovery covers own topology and explicit or automatic current-plan SATA providers", () => {
  const db = structuredClone(seed),
    board = db.components.find((c) => c.category === "Motherboard")!,
    config = db.configurations[0],
    placement = config.placements.find((p) => p.componentId === board.id)!;
  board.specs.ports = [{ id: "LAN_1", kind: "Ethernet" }];
  config.portMappings = [{
    connectionId: "device",
    requirementId: "req",
    placementId: placement.id,
    instance: 0,
    portId: "LAN_1",
  }];
  assert.ok(
    componentReferences(board, "ports", "LAN_1", db).includes(
      `Configuration ${config.name}`,
    ),
  );
  board.specs.sataDataPorts = [{ id: "SATA_DATA_1" }];
  const drive = config.placements.find((p) =>
    db.components.find((c) => c.id === p.componentId)?.category === "Drive"
  )!;
  drive.sataDataConnections = [{
    controllerPlacementId: "",
    portId: "SATA_DATA_1",
  }];
  assert.ok(
    componentReferences(board, "sataDataPorts", "SATA_DATA_1", db).includes(
      `Configuration ${config.name}`,
    ),
  );
  board.specs.laneRules = [{ id: "RULE_1", slots: [board.specs.slots![0].id] }];
  assert.ok(
    componentReferences(board, "slots", board.specs.slots![0].id, db).includes(
      "Lane rule RULE_1",
    ),
  );
  const cage = part("Storage adapter", {
    storageAdapterKind: "bay-cage",
    sataDataInputs: [{ id: "IN1" }],
    driveTargets: [{
      id: "TRAY_1",
      mount: "front-hot-swap",
      sataDataInputId: "IN1",
    }],
  });
  assert.deepEqual(componentReferences(cage, "sataDataInputs", "IN1", db), [
    "Drive target TRAY_1",
  ]);
});

test("editor section URLs round trip and normalize unknown section names", async () => {
  const { parseWorkspaceRoute, encodeWorkspaceRoute } = await import(
    "../shared/workspace-route"
  );
  const hash =
    "#/catalog/components?edit=component&record=board-atx&section=ports";
  assert.equal(parseWorkspaceRoute(hash).editorView, "ports");
  assert.equal(encodeWorkspaceRoute(parseWorkspaceRoute(hash)), hash);
  assert.equal(
    parseWorkspaceRoute(hash.replace("section=ports", "section=unknown"))
      .editorView,
    "basics",
  );
});
test("installed reference discovery protects legacy planned-provider IDs without guessing ambiguous allocations", () => {
  const db = structuredClone(seed),
    board = db.components.find((component) =>
      component.category === "Motherboard"
    )!,
    pc = db.pcs[0],
    configuration = db.configurations.find((config) =>
      config.id === pc.configurationId
    )!,
    boardLine = configuration.placements.find((row) =>
      row.componentId === board.id
    )!;
  const allocation = (
    id: string,
    plannedPlacementId: string,
    extra: object = {},
  ) => ({
    id,
    plannedPlacementId,
    pcId: pc.id,
    quantity: 1,
    state: "installed" as const,
    role: "general" as const,
    mount: "auto" as const,
    slotId: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...extra,
  });
  const stock = (
    id: string,
    componentId: string,
    allocations: ReturnType<typeof allocation>[],
  ) => ({
    id,
    componentId,
    allocations,
    tracking: "bulk" as const,
    serial: "",
    assetTag: "",
    quantity: allocations.length,
    location: "",
    condition: "Serviceable" as const,
    notes: "",
    history: [],
  });
  db.inventory = [
    stock("boards", board.id, [
      allocation("board-a", boardLine.id),
      allocation("board-b", boardLine.id),
    ]),
    stock("drive", "hdd", [
      allocation("drive-a", "drive-line", {
        sataDataConnections: [{
          controllerPlacementId: boardLine.id,
          portId: "LEGACY_DATA",
        }],
      }),
    ]),
  ];
  assert.ok(
    componentReferences(board, "sataDataPorts", "LEGACY_DATA", db).includes(
      `PC ${pc.name}`,
    ),
  );
});

test("topology validation identifies the exact record and field for cross-section repairs", () => {
  const component = part("Storage adapter", {
    storageAdapterKind: "bay-cage",
    driveTargets: [{
      id: "TRAY_1",
      mount: "front-hot-swap",
      sataDataInputId: "missing",
    }],
  });
  const parsed = componentSchema.safeParse(component);
  assert.equal(parsed.success, false);
  if (!parsed.success) {
    assert.deepEqual(parsed.error.issues[0].path, [
      "specs",
      "driveTargets",
      0,
      "sataDataInputId",
    ]);
  }
  const board = part("Motherboard", {
    laneRules: [{ id: "RULE", slots: ["missing"] }],
  });
  const rule = componentSchema.safeParse(board);
  assert.equal(rule.success, false);
  if (!rule.success) {
    assert.deepEqual(rule.error.issues[0].path, [
      "specs",
      "laneRules",
      0,
      "slots",
    ]);
  }
  assert.equal(
    componentSchema.safeParse({ ...component, name: "  ", specs: {} }).success,
    false,
  );
});
