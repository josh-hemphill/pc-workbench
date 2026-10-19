import { z } from "zod";
import { coolingSpecsSchema } from "./cooling-schema.ts";
import { categories, portKinds } from "./types.ts";
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  str = z.string().max(10000),
  count = z.number().int().min(0).max(10000);
const mount = z.enum(["auto", "internal", "front-hot-swap", "rear-sled"]),
  pciVoltage = z.enum(["3.3V", "5V", "universal"]);
const slot = z.object({
  laneSource: z.enum(["CPU", "Chipset"]).optional(),
  id,
  bus: z.enum(["PCI", "PCIe"]),
  physical: z.number().int().min(1).max(16),
  lanes: z.number().int().min(1).max(16),
  generation: z.number().int().min(1).max(7),
  position: z.number().int().min(1).max(32),
  bifurcationModes: z.array(str).max(20).optional(),
  pciVoltage: pciVoltage.optional(),
  pciBits: z.union([z.literal(32), z.literal(64)]).optional(),
}).strict();
const baySize = z.enum(["2.5", "3.5", "5.25"]);
const sataInputs = z.array(z.object({ id }).strict()).max(1000).refine(
  (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
  "SATA input IDs must be unique",
);
const sffEndpoints = z.array(
  z.object({
    id,
    connector: z.string().trim().min(1).max(200),
    protocols: z.array(z.enum(["SATA", "SAS", "NVMe"])).max(3).refine(
      (values) => new Set(values).size === values.length,
      "Protocols must be unique",
    ).optional(),
    channels: z.number().int().min(1).max(32).optional(),
    pcieLanes: z.number().int().min(1).max(32).optional(),
    disabled: z.boolean().optional(),
  }).strict(),
).max(1000).refine(
  (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
  "SFF connector IDs must be unique",
);
const specs = z.object({
  ...coolingSpecsSchema,
  sffPorts: sffEndpoints.optional(),
  sffInputs: sffEndpoints.optional(),
  consumableKind: str.optional(),
  stockUnit: str.optional(),
  thicknessMm: z.number().positive().max(1000).optional(),
  cableProtocol: z.enum(["SATA", "SAS", "SATA/SAS", "NVMe", "Power", "Other"])
    .optional(),
  connectorA: str.optional(),
  connectorB: str.optional(),
  cableChannels: z.number().int().min(1).max(32).optional(),
  cableDirection: z.enum([
    "bidirectional",
    "forward-breakout",
    "reverse-breakout",
  ]).optional(),
  storageMedium: z.enum(["HDD", "SSD"]).optional(),
  storageAdapterKind: z.enum([
    "controller",
    "pcie-sled",
    "bay-cage",
    "mount-adapter",
    "m2-converter",
  ]).optional(),
  driveKind: z.enum(["disk", "optical"]).optional(),
  sataDataPorts: z.array(
    z.object({ id, disabled: z.boolean().optional() }).strict(),
  ).max(1000).refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "SATA data port IDs must be unique",
  ).optional(),
  sataPowerConnectors: z.array(
    z.object({ id, harness: str.optional() }).strict(),
  ).max(1000).refine(
    (rows) => new Set(rows.map((row) => row.id)).size === rows.length,
    "SATA power connector IDs must be unique",
  ).optional(),
  sataDataInputs: sataInputs.optional(),
  sataPowerInputs: sataInputs.optional(),
  bayTargets: z.array(
    z.object({
      id,
      size: baySize,
      group: str.optional(),
      position: z.number().int().min(1).max(10000).optional(),
      maxDepthMm: count.optional(),
    }).strict(),
  ).max(1000).refine(
    (t) => new Set(t.map((x) => x.id)).size === t.length,
    "Bay target IDs must be unique",
  ).optional(),
  baySize: baySize.optional(),
  bayUnits: z.number().int().min(1).max(32).optional(),
  sataPowerPlugs: count.optional(),
  ports: z.array(
    z.object({
      id,
      kind: z.enum(portKinds),
      connector: str.optional(),
      pinout: str.optional(),
      customType: str.optional(),
      protocol: str.optional(),
      speedMbps: z.number().nonnegative().optional(),
      powerW: z.number().nonnegative().optional(),
      isolated: z.boolean().optional(),
    }).strict().superRefine((port, ctx) => {
      if (port.kind === "Custom" && !port.customType?.trim()) {
        ctx.addIssue({
          code: "custom",
          message: "Custom ports require a nonblank custom type",
          path: ["customType"],
        });
      }
    }),
  ).max(1000).refine(
    (p) => new Set(p.map((x) => x.id)).size === p.length,
    "Port IDs must be unique",
  ).optional(),
  driveTargets: z.array(
    z.object({
      id,
      mount,
      pcieLanes: z.number().int().min(1).max(16).optional(),
      disabled: z.boolean().optional(),
      sffInputId: str.optional(),
      driveSizes: z.array(str).optional(),
      interfaces: z.array(str).optional(),
      m2Lengths: z.array(count).optional(),
      hotSwap: z.boolean().optional(),
      bootable: z.boolean().optional(),
      bayId: str.optional(),
      sataDataInputId: str.optional(),
      sataPowerInputId: str.optional(),
    }).strict(),
  ).max(1000).refine(
    (t) => new Set(t.map((x) => x.id)).size === t.length,
    "Drive target IDs must be unique",
  ).optional(),
  laneRules: z.array(
    z.object({
      id,
      slots: z.array(id).max(32),
      maxLanes: count.optional(),
      exclusive: z.boolean().optional(),
      disableM2Slots: count.optional(),
      disableSataPorts: count.optional(),
      disableSataPortIds: z.array(id).max(1000).optional(),
    }).strict(),
  ).max(100).optional(),
  pciVoltage: pciVoltage.optional(),
  pciBits: z.union([z.literal(32), z.literal(64)]).optional(),
  bifurcationMode: str.optional(),
  supportedOS: z.array(str).max(100).optional(),
  requiredDriver: str.optional(),
  requiredFirmware: str.optional(),
  bootable: z.boolean().optional(),
  hotPlug: z.boolean().optional(),
  socket: str.optional(),
  coreCount: count.min(1).optional(),
  threadCount: count.min(1).optional(),
  formFactor: str.optional(),
  supportedForms: z.array(str).max(20).optional(),
  memoryType: str.optional(),
  dimmSlots: count.optional(),
  maxMemoryGb: count.optional(),
  capacityGb: z.number().min(0).max(10000000).optional(),
  slots: z.array(slot).max(32).refine(
    (s) => new Set(s.map((x) => x.id)).size === s.length,
    "Slot IDs must be unique",
  ).refine(
    (s) => new Set(s.map((x) => x.position)).size === s.length,
    "Slot positions must be unique",
  ).optional(),
  slotBus: z.enum(["PCI", "PCIe"]).optional(),
  slotWidth: z.number().int().min(1).max(16).optional(),
  requiredLanes: z.number().int().min(1).max(16).optional(),
  minGeneration: z.number().int().min(1).max(7).optional(),
  bracketWidth: z.number().int().min(1).max(8).optional(),
  lengthMm: count.optional(),
  heightMm: count.optional(),
  widthMm: count.optional(),
  maxCardLengthMm: count.optional(),
  maxCardHeightMm: count.optional(),
  maxCoolerHeightMm: count.optional(),
  rearSlots: count.optional(),
  bays25: count.optional(),
  bays35: count.optional(),
  bays525: count.optional(),
  hotSwapBays: count.optional(),
  sataPorts: count.optional(),
  m2Slots: count.optional(),
  m2Lengths: z.array(count).max(20).optional(),
  sataPower: count.optional(),
  usbA: count.optional(),
  usbC: count.optional(),
  ethernet: count.optional(),
  powerW: count.optional(),
  capacityW: count.optional(),
  driveInterface: z.enum(["SATA", "SAS", "NVMe"]).optional(),
  driveSize: z.enum(["2.5", "3.5", "5.25", "M.2"]).optional(),
  m2Length: count.optional(),
  sledDrives: count.optional(),
  requiresBifurcation: z.boolean().optional(),
  bifurcation: z.boolean().optional(),
  sledHotSwap: z.boolean().optional(),
  supportsSockets: z.array(str).max(20).optional(),
  notes: str.optional(),
}).strict().superRefine((spec, ctx) => {
  for (const [targetIndex, target] of (spec.driveTargets || []).entries()) {
    for (
      const [field, rows] of [
        ["bayId", spec.bayTargets],
        [
          "sataDataInputId",
          spec.sataDataInputs,
        ],
        ["sataPowerInputId", spec.sataPowerInputs],
        ["sffInputId", spec.sffInputs],
      ] as const
    ) {
      if (target[field] && !rows?.some((row) => row.id === target[field])) {
        ctx.addIssue({
          code: "custom",
          path: ["driveTargets", targetIndex, field],
          message: `Drive target ${target.id}: ${field} ${
            target[field]
          } does not exist`,
        });
      }
    }
  }
  for (const [ruleIndex, rule] of (spec.laneRules || []).entries()) {
    for (const portId of rule.disableSataPortIds || []) {
      if (
        !spec.sataDataPorts?.some((port) => port.id === portId)
      ) {
        ctx.addIssue({
          code: "custom",
          message: `Lane rule ${rule.id}: SATA port ${portId} does not exist`,
          path: ["laneRules", ruleIndex, "disableSataPortIds"],
        });
      }
    }
  }
  const positions = new Set<string>();
  for (const [bayIndex, bay] of (spec.bayTargets || []).entries()) {
    if (bay.position !== undefined) {
      const key = JSON.stringify([bay.group || "", bay.position]);
      if (positions.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: "Bay positions must be unique within each bay group",
          path: ["bayTargets", bayIndex, "position"],
        });
      }
      positions.add(key);
    }
  }
  for (const [ruleIndex, rule] of (spec.laneRules || []).entries()) {
    for (const slotId of rule.slots) {
      if (!spec.slots?.some((slot) => slot.id === slotId)) {
        ctx.addIssue({
          code: "custom",
          message: `Lane rule ${rule.id}: slot ${slotId} does not exist`,
          path: ["laneRules", ruleIndex, "slots"],
        });
      }
    }
  }
  if (
    spec.laneRules &&
    new Set(spec.laneRules.map((r) => r.id)).size !== spec.laneRules.length
  ) {
    ctx.addIssue({
      code: "custom",
      message: "Lane rule IDs must be unique",
      path: ["laneRules"],
    });
  }
});
export const componentSpecsSchema = specs;
export const componentSchema = z.object({
  model: z.string().trim().max(200).optional(),
  family: z.string().trim().max(200).optional(),
  id,
  name: z.string().min(1).max(200).refine(
    (value) => !!value.trim(),
    "A name is required.",
  ),
  category: z.enum(categories),
  manufacturer: str,
  specs,
  source: str,
  verified: z.boolean(),
}).strict();
