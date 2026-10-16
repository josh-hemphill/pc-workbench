import type { Category, Component, Specs } from "./types.ts";
import { componentCapabilities } from "./component-capabilities.ts";
export type ComponentSection =
  | "basics"
  | "cooling"
  | "ports"
  | "expansion"
  | "storage"
  | "physical"
  | "review";
const specFields: Record<
  Category,
  {
    key: keyof Specs;
    label: string;
    kind?: "text" | "list" | "select" | "bool";
    items?: string[];
  }[]
> = {
  "Chassis": [
    { key: "supportedForms", label: "Supported board forms", kind: "list" },
    { key: "rearSlots", label: "Rear bracket positions" },
    { key: "maxCardLengthMm", label: "Card length clearance (mm)" },
    { key: "maxCardHeightMm", label: "Card height clearance (mm)" },
    { key: "maxCoolerHeightMm", label: "Cooler height clearance (mm)" },
    { key: "bays25", label: "Internal 2.5-inch bays" },
    { key: "bays35", label: "Internal 3.5-inch bays" },
    { key: "bays525", label: "External 5.25-inch bays" },
    { key: "hotSwapBays", label: "Separate front hot-swap bays" },
    { key: "lengthMm", label: "Length (mm)" },
    { key: "heightMm", label: "Height (mm)" },
    { key: "widthMm", label: "Width (mm)" },
  ],
  "Motherboard": [
    { key: "socket", label: "CPU socket", kind: "text" },
    {
      key: "formFactor",
      label: "Form factor",
      kind: "select",
      items: ["ATX", "Micro-ATX", "Mini-ITX", "E-ATX"],
    },
    {
      key: "memoryType",
      label: "Memory type",
      kind: "select",
      items: ["DDR3", "DDR4", "DDR5"],
    },
    { key: "dimmSlots", label: "DIMM slots" },
    { key: "maxMemoryGb", label: "Maximum memory (GB)" },
    { key: "usbA", label: "Usable external USB-A ports" },
    { key: "usbC", label: "Usable external USB-C ports" },
    { key: "ethernet", label: "Ethernet ports" },
    { key: "sataPorts", label: "SATA ports" },
    { key: "m2Slots", label: "NVMe M.2 slots" },
    { key: "m2Lengths", label: "M.2 lengths (mm)", kind: "list" },
    { key: "bifurcation", label: "PCIe bifurcation supported", kind: "bool" },
    { key: "powerW", label: "Estimated power (W)" },
  ],
  "CPU": [{ key: "socket", label: "CPU socket", kind: "text" }, {
    key: "powerW",
    label: "Maximum power estimate (W)",
  }],
  "Memory": [
    {
      key: "memoryType",
      label: "Memory type",
      kind: "select",
      items: ["DDR3", "DDR4", "DDR5"],
    },
    { key: "capacityGb", label: "Capacity per module (GB)" },
    { key: "powerW", label: "Power per module (W)" },
  ],
  "GPU": [],
  "Scientific card": [],
  "Network card": [],
  "Storage adapter": [],
  "Bay accessory": [
    { key: "powerW", label: "Estimated power (W)" },
    { key: "lengthMm", label: "Depth (mm)" },
    { key: "heightMm", label: "Height (mm)" },
    { key: "widthMm", label: "Width (mm)" },
  ],
  "Drive": [
    {
      key: "storageMedium",
      label: "Storage medium",
      kind: "select",
      items: ["HDD", "SSD"],
    },
    { key: "capacityGb", label: "Capacity per drive (GB)" },
    {
      key: "driveInterface",
      label: "Interface",
      kind: "select",
      items: ["SATA", "SAS", "NVMe"],
    },
    {
      key: "driveSize",
      label: "Form factor",
      kind: "select",
      items: ["2.5", "3.5", "M.2", "5.25"],
    },
    { key: "m2Length", label: "M.2 length (mm)" },
    { key: "powerW", label: "Power per drive (W)" },
  ],
  "PSU": [{ key: "capacityW", label: "Rated power (W)" }, {
    key: "sataPower",
    label: "SATA power plugs",
  }, { key: "formFactor", label: "PSU form factor", kind: "text" }],
  "Cable": [
    {
      key: "cableProtocol",
      label: "Cable protocol",
      kind: "select",
      items: ["SATA", "SAS", "SATA/SAS", "NVMe", "Power", "Other"],
    },
    {
      key: "connectorA",
      label: "End A connector (e.g. SFF-8643)",
      kind: "text",
    },
    {
      key: "connectorB",
      label: "End B connector (e.g. SATA 7-pin)",
      kind: "text",
    },
    { key: "cableChannels", label: "Data channels per cable assembly" },
    {
      key: "cableDirection",
      label: "Breakout direction",
      kind: "select",
      items: ["bidirectional", "forward-breakout", "reverse-breakout"],
    },
    { key: "lengthMm", label: "Cable length (mm)" },
    {
      key: "stockUnit",
      label: "Stock unit (e.g. cable assembly)",
      kind: "text",
    },
  ],
  "Consumable": [
    {
      key: "consumableKind",
      label: "Consumable type (e.g. thermal pad)",
      kind: "text",
    },
    {
      key: "stockUnit",
      label: "Stock unit (e.g. pad, sheet, pack)",
      kind: "text",
    },
    { key: "thicknessMm", label: "Thickness (mm)" },
    { key: "lengthMm", label: "Length (mm)" },
    { key: "widthMm", label: "Width (mm)" },
  ],
  "Fan": [{key:"stockUnit",label:"Stock unit (e.g. fan)",kind:"text"},{key:"lengthMm",label:"Frame size (mm)"},{key:"widthMm",label:"Frame width (mm)"},{key:"heightMm",label:"Thickness (mm)"},{key:"powerW",label:"Total power per fan assembly (W)"}],
  "Cooler": [{ key: "heightMm", label: "Height (mm)" }, {
    key: "supportsSockets",
    label: "Supported sockets",
    kind: "list",
  }, { key: "powerW", label: "Fan/pump electrical power (W)" }],
};
const cardFields: typeof specFields["GPU"] = [
  { key: "slotBus", label: "Slot bus", kind: "select", items: ["PCI", "PCIe"] },
  { key: "slotWidth", label: "Physical connector width (x)" },
  { key: "requiredLanes", label: "Required electrical lanes" },
  { key: "minGeneration", label: "Minimum PCIe generation" },
  { key: "bracketWidth", label: "Rear bracket positions used" },
  { key: "lengthMm", label: "Length (mm)" },
  { key: "heightMm", label: "Height (mm)" },
  { key: "widthMm", label: "Width (mm)" },
  { key: "powerW", label: "Estimated power (W)" },
];
export function componentFields(component: Component) {
  const c = component.category, cap = componentCapabilities(component);
  let fields = specFields[c].length
    ? [...specFields[c]]
    : cap.slotCard
    ? [...cardFields]
    : [
      { key: "powerW" as const, label: "Estimated power (W)" },
      { key: "lengthMm" as const, label: "Depth (mm)" },
      { key: "heightMm" as const, label: "Height (mm)" },
      { key: "widthMm" as const, label: "Width (mm)" },
    ];
  fields = fields.filter((field) =>
    !(c === "Motherboard" && component.specs.driveTargets !== undefined &&
      ["m2Slots", "m2Lengths"].includes(field.key)) &&
    !(field.key === "lengthMm" && cap.bayConsumer) &&
    !(field.key === "m2Length" && !cap.m2) &&
    !(["capacityGb", "storageMedium"].includes(field.key) && cap.optical) &&
    !(["slotWidth", "requiredLanes", "minGeneration"].includes(field.key) &&
      cap.pci)
  );
  if (cap.m2Converter) {
    fields.push({ key: "m2Length", label: "M.2 adapter module length (mm)" });
  }
  if (c === "Drive") {
    fields = fields.map((field) =>
      field.key === "driveSize"
        ? { ...field, items: cap.optical ? ["5.25"] : ["2.5", "3.5", "M.2"] }
        : field.key === "driveInterface" && cap.optical
        ? { ...field, items: ["SATA"] }
        : field
    );
  }
  if (c === "Network card") {
    fields.push({ key: "ethernet", label: "Ethernet ports added" });
  }
  if (c === "Storage adapter" && cap.sataController) {
    fields.push({ key: "sataPorts", label: "Controller SATA data ports" });
  }
  if (cap.nvmeSled) {
    fields.push({ key: "sledDrives", label: "NVMe drive positions" }, {
      key: "requiresBifurcation",
      label: "Requires lane bifurcation",
      kind: "bool",
    }, {
      key: "sledHotSwap",
      label: "Vendor supports live hot-swap",
      kind: "bool",
    });
  }
  return fields;
}
export function fieldSection(
  key: keyof Specs,
  component: Component,
): ComponentSection {
  if (["usbA", "usbC", "ethernet"].includes(key)) return "ports";
  if (
    [
      "slotBus",
      "slotWidth",
      "requiredLanes",
      "minGeneration",
      "bracketWidth",
      "bifurcation",
      "sledDrives",
      "requiresBifurcation",
      "sledHotSwap",
    ].includes(key)
  ) return "expansion";
  if (["sataPorts", "sataPower", "m2Slots", "m2Lengths"].includes(key)) {
    return "storage";
  }
  if (
    [
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
    ].includes(key) ||
    ["lengthMm", "heightMm", "widthMm"].includes(key) &&
      !["Cable", "Consumable"].includes(component.category)
  ) return "physical";
  return "basics";
}
export function componentSections(component: Component) {
  const cap = componentCapabilities(component),
    fields = componentFields(component),
    has = (section: ComponentSection) =>
      fields.some((field) => fieldSection(field.key, component) === section);
  return ([
    "basics",
    "ports",
    "cooling",
    "expansion",
    "storage",
    "physical",
    "review",
  ] as ComponentSection[]).filter((section) =>
    section === "cooling" && (["Fan","Cooler","Motherboard","Bay accessory"].includes(component.category)||component.specs.coolingDevices!==undefined||component.specs.coolingHeaders!==undefined) ||
    section === "basics" || section === "review" || has(section) ||
    section === "ports" && cap.ports ||
    section === "expansion" &&
      (component.category === "Motherboard" || cap.slotCard) ||
    section === "storage" &&
      (cap.sff || cap.sataController || component.category === "PSU" ||
        cap.adapter === "bay-cage" ||
        component.specs.sataPowerInputs !== undefined ||
        component.specs.sataPowerPlugs !== undefined) ||
    section === "physical" &&
      (cap.bayProvider || cap.bayConsumer ||
        cap.driveTargets && component.category !== "Motherboard")
  );
}
