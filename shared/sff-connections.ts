import type {
  Component,
  Configuration,
  Database,
  Finding,
  Resource,
  StorageProtocol,
} from "./types.ts";
import { componentCapabilities } from "./component-capabilities.ts";
export const sffConnectors = [
  "SFF-8087",
  "SFF-8088",
  "SFF-8643",
  "SFF-8644",
  "SFF-8654 4i",
  "SFF-8654 8i",
  "SFF-8611",
  "SFF-8612",
  "SFF-8639",
];
function connectorKey(value?: string) {
  const name = value?.trim().toUpperCase();
  return name && /^(SATA|SATA ?7[ -]?PIN|SATA DATA(?: ?7[ -]?PIN)?)$/.test(name)
    ? "SATA"
    : name?.replace(/^(SFF)[ -]?(\d{4})/, "$1-$2");
}
export function onboardM2Count(component?: Component) {
  return component?.specs.driveTargets !== undefined
    ? component.specs.driveTargets.filter((target) =>
      target.driveSizes?.includes("M.2") && !target.disabled
    ).length
    : component?.specs.m2Slots;
}
/** Physical plugs, device channels and PCIe lanes are independent budgets. No protocol is inferred from a connector shape. */
export function checkSffConnections(
  config: Configuration,
  db: Database,
  slotAssignments: Record<string, string> = {},
) {
  const rows = config.placements.flatMap((p) => {
    const c = db.components.find((c) => c.id === p.componentId);
    return c ? [{ p, c }] : [];
  });
  type Row = typeof rows[number];
  const byId = new Map(rows.map((row) => [row.p.id, row])),
    findings: Finding[] = [],
    resources: Resource[] = [];
  const add = (severity: Finding["severity"], title: string, detail: string) =>
    findings.push({ severity, title, detail });
  const booked = new Map<string, Set<number>>(),
    lanes = new Map<string, number>(),
    cableUse = new Map<string, Set<number>>(),
    m2Use = new Map<string, number>();
  const links: {
    id: string;
    source: string;
    destination: string;
    channels: number;
    lanes: number;
    protocol: string;
    cable: string;
  }[] = [];
  const board = rows.find((row) => row.c.category === "Motherboard");
  const activeM2Rules = (provider: Row) =>
    provider.c.specs.laneRules?.filter((rule) =>
      Object.values(slotAssignments).some((slot) =>
        rule.slots.includes(slot)
      ) && rule.disableM2Slots
    ) || [];
  function reserveM2(row: Row) {
    const provider = row.p.adapterPlacementId
      ? byId.get(row.p.adapterPlacementId)
      : board;
    const target = provider?.c.specs.driveTargets?.find((target) =>
      target.id === row.p.targetId
    );
    if (!provider || provider.c.category !== "Motherboard") {
      add(
        "error",
        "M.2 converter source invalid",
        `${row.c.name}: select its motherboard slot provider.`,
      );
      return;
    }
    if (row.p.quantity !== 1 || provider.p.quantity !== 1) {
      add(
        "error",
        "Ambiguous M.2 converter instance",
        `${row.c.name}: split adapter and motherboard placements before binding a slot.`,
      );
    }
    if (!row.p.targetId) {
      add(
        "warning",
        "M.2 converter slot unrecorded",
        `${row.c.name}: select the actual M.2 slot; a converter and a drive cannot use it together.`,
      );
      return;
    }
    if (!target) {
      add(
        "error",
        "M.2 converter slot missing",
        `${row.c.name}: ${row.p.targetId} is absent from the motherboard catalog.`,
      );
      return;
    }
    const key = `${provider.p.id}:${target.id}`;
    m2Use.set(key, (m2Use.get(key) || 0) + row.p.quantity);
    if (
      !target.driveSizes?.includes("M.2") ||
      !target.interfaces?.includes("NVMe")
    ) {
      add(
        "error",
        "M.2 converter interface mismatch",
        `${row.c.name}: ${target.id} must provide documented M.2 PCIe/NVMe support; a passive adapter does not convert SATA or SAS protocols.`,
      );
    }
    if (target.disabled) {
      add(
        "error",
        "M.2 slot disabled",
        `${provider.c.name} / ${target.id} is disabled.`,
      );
    }
    if (
      target.m2Lengths && row.c.specs.m2Length !== undefined &&
      !target.m2Lengths.includes(row.c.specs.m2Length)
    ) {
      add(
        "error",
        "M.2 converter length mismatch",
        `${row.c.name}: ${target.id} does not accept its ${row.c.specs.m2Length} mm module.`,
      );
    }
    if (!target.m2Lengths || row.c.specs.m2Length === undefined) {
      add(
        "warning",
        "M.2 converter fit unknown",
        `${row.c.name}: document module length and ${target.id} supported lengths.`,
      );
    }
    if (activeM2Rules(provider).length) {
      add(
        "warning",
        "M.2 lane-sharing route unconfirmed",
        `${target.id}: active rules disable unnamed M.2 slots; verify this slot remains available.`,
      );
    }
    const outputs = row.c.specs.sffPorts;
    if (!outputs?.length) {
      add(
        "warning",
        "M.2 converter outputs unknown",
        `${row.c.name}: record its SFF output ports.`,
      );
    }
    const outputLanes = outputs?.reduce(
      (sum, port) => sum + (port.disabled ? 0 : port.pcieLanes || 0),
      0,
    ) || 0;
    if (target.pcieLanes !== undefined && outputLanes > target.pcieLanes) {
      add(
        "error",
        "M.2 converter lane capacity exceeded",
        `${row.c.name}: declared outputs need ${outputLanes} PCIe lanes but ${target.id} provides ${target.pcieLanes}.`,
      );
    }
    if (target.pcieLanes === undefined) {
      add(
        "warning",
        "M.2 slot lanes unknown",
        `${provider.c.name} / ${target.id}: document electrical PCIe lanes.`,
      );
    }
    if (
      outputs?.some((port) =>
        port.protocols?.some((protocol) => protocol !== "NVMe")
      )
    ) {
      add(
        "error",
        "Passive M.2 converter protocol invalid",
        `${row.c.name}: M.2-to-SFF is a PCIe/NVMe wiring adapter, not a SATA/SAS controller.`,
      );
    }
    if (
      (outputs?.reduce((sum, port) => sum + (port.channels || 1), 0) || 0) > 1
    ) {
      add(
        "warning",
        "M.2 converter bifurcation review",
        `${row.c.name}: multiple NVMe devices require documented upstream lane splitting or an active PCIe switch.`,
      );
    }
  }
  for (const row of rows) {
    if (componentCapabilities(row.c).m2Converter) reserveM2(row);
    if (
      row.c.category === "Drive" && row.c.specs.driveSize === "M.2" &&
      row.p.targetId
    ) {
      const provider = row.p.adapterPlacementId
        ? byId.get(row.p.adapterPlacementId)
        : board;
      if (provider?.c.category === "Motherboard") {
        const key = `${provider.p.id}:${row.p.targetId}`;
        m2Use.set(key, (m2Use.get(key) || 0) + row.p.quantity);
        if (
          provider.c.specs.driveTargets?.find((target) =>
            target.id === row.p.targetId
          )?.disabled
        ) {
          add(
            "error",
            "M.2 slot disabled",
            `${row.c.name}: ${row.p.targetId} is disabled.`,
          );
        }
      }
    }
  }
  for (const [key, count] of m2Use) {
    if (count > 1) {
      add(
        "error",
        "M.2 slot double booked",
        `${key}: a drive and/or converter require ${count} uses of one physical slot.`,
      );
    }
  }
  // A cable assembly can also have SATA breakout channels assigned elsewhere.
  for (const row of rows) {
    for (const route of row.p.sataDataConnections || []) {
      if (route.cablePlacementId && route.cableChannel) {
        const set = cableUse.get(route.cablePlacementId) || new Set<number>();
        set.add(route.cableChannel);
        cableUse.set(route.cablePlacementId, set);
      }
    }
  }
  const cageDemand = new Map<string, number>();
  const cageRequirements = new Map<
    string,
    { boot: boolean; hotPlug: boolean; controllers: Set<string> }
  >();
  for (const drive of rows.filter((row) => row.c.category === "Drive")) {
    const provider = byId.get(drive.p.adapterPlacementId || ""),
      target = provider?.c.specs.driveTargets?.find((target) =>
        target.id === drive.p.targetId
      );
    if (target?.sffInputId && provider) {
      const key = `${provider.p.id}:${target.sffInputId}`;
      cageDemand.set(key, (cageDemand.get(key) || 0) + drive.p.quantity);
      const requirements = cageRequirements.get(key) ||
        { boot: false, hotPlug: false, controllers: new Set<string>() };
      requirements.boot ||= drive.p.role === "boot";
      requirements.hotPlug ||= drive.p.mount === "front-hot-swap" ||
        target.mount === "front-hot-swap";
      if (drive.p.controllerPlacementId) {
        requirements.controllers.add(drive.p.controllerPlacementId);
      }
      cageRequirements.set(key, requirements);
      if (drive.p.sffConnections?.length) {
        add(
          "error",
          "SFF drive route bypasses backplane",
          `${drive.c.name}: route the backplane input instead of adding a direct drive connection.`,
        );
      }
      const input = provider.c.specs.sffInputs?.find((input) =>
        input.id === target.sffInputId
      );
      if (
        input?.protocols && drive.c.specs.driveInterface &&
        !input.protocols.includes(drive.c.specs.driveInterface)
      ) {
        add(
          "error",
          "SFF backplane protocol mismatch",
          `${drive.c.name}: ${target.sffInputId} does not support ${drive.c.specs.driveInterface}.`,
        );
      }
    }
  }
  for (const row of rows) {
    const routes = row.p.sffConnections || [], seen = new Set<string>();
    const sffMounted = row.c.category === "Drive" &&
      row.c.specs.driveSize !== "M.2" &&
      ["SAS", "NVMe"].includes(row.c.specs.driveInterface || "");
    const cage = byId.get(row.p.adapterPlacementId || ""),
      cageTarget = cage?.c.specs.driveTargets?.find((target) =>
        target.id === row.p.targetId
      );
    if (
      sffMounted && !row.c.specs.sataPowerInputs?.length &&
      !cageTarget?.sffInputId
    ) {
      add(
        "warning",
        "SFF drive power review",
        `${row.c.name}: verify power delivery separately from the SFF data cable; document auxiliary inputs where applicable.`,
      );
    }
    if (sffMounted && !routes.length && !cageTarget?.sffInputId) {
      add(
        "warning",
        "SFF drive connection unrecorded",
        `${row.c.name}: record its SAS/NVMe cable and supplying port.`,
      );
    }
    if (
      row.c.category === "Drive" && row.c.specs.driveSize === "M.2" &&
      routes.length
    ) {
      add(
        "error",
        "Onboard M.2 SFF route invalid",
        `${row.c.name}: bind the module to an M.2 slot; external SFF outputs belong to a separate converter.`,
      );
    }
    if (routes.length && row.p.sataDataConnections?.length) {
      add(
        "error",
        "Storage data route double mapped",
        `${row.c.name}: use one upstream SFF or SATA data route per input.`,
      );
    }
    for (const [index, route] of routes.entries()) {
      const inputId = route.inputId || "",
        input = row.c.specs.sffInputs?.find((input) => input.id === inputId),
        provider = byId.get(route.providerPlacementId),
        port = provider?.c.specs.sffPorts?.find((port) =>
          port.id === route.portId
        );
      if (row.c.specs.sffInputs !== undefined && !input) {
        add(
          "error",
          "SFF input missing",
          `${row.c.name}: ${
            inputId || "unnamed input"
          } is absent from the complete input catalog.`,
        );
      }
      if (row.c.category !== "Drive" && row.c.specs.sffInputs === undefined) {
        add(
          "error",
          "SFF consumer invalid",
          `${row.c.name}: document input connectors before assigning routes.`,
        );
      }
      if (seen.has(inputId)) {
        add(
          "error",
          "SFF input double mapped",
          `${row.c.name} / ${inputId || "drive"}: select one upstream route.`,
        );
      }
      seen.add(inputId);
      if (row.p.quantity !== 1 || provider && provider.p.quantity !== 1) {
        add(
          "error",
          "Ambiguous SFF instance",
          `${row.c.name}: split component placements before naming physical connectors.`,
        );
      }
      if (
        !provider || provider === row ||
        !componentCapabilities(provider.c).sffProvider
      ) {
        add(
          "error",
          "SFF provider invalid",
          `${row.c.name}: select an installed motherboard/controller/converter port.`,
        );
        continue;
      }
      const legacyController = row.p.controllerPlacementId,
        upstream = componentCapabilities(provider.c).m2Converter
          ? (provider.p.adapterPlacementId || board?.p.id)
          : provider.p.id;
      const demands = cageRequirements.get(`${row.p.id}:${inputId}`);
      if (
        legacyController && legacyController !== upstream ||
        demands && [...demands.controllers].some((id) => id !== upstream)
      ) {
        add(
          "error",
          "SFF controller route conflicts",
          `${row.c.name}: the recorded controller and SFF route select different upstream providers.`,
        );
      }
      if (!port) {
        add(
          "error",
          "SFF port missing",
          `${provider.c.name}: ${
            route.portId || "unnamed port"
          } is absent from its catalog.`,
        );
        continue;
      }
      if (port.disabled || input?.disabled) {
        add(
          "error",
          "SFF connector disabled",
          `${provider.c.name} / ${port.id} or ${row.c.name} / ${inputId} is disabled.`,
        );
      }
      const protocols: StorageProtocol[] =
        row.c.category === "Drive" && row.c.specs.driveInterface
          ? [row.c.specs.driveInterface]
          : input?.protocols || [];
      if (!protocols.length || !port.protocols?.length) {
        add(
          "warning",
          "SFF protocol unconfirmed",
          `${provider.c.name} / ${port.id} → ${row.c.name}: document protocols; connector shape alone does not verify data compatibility.`,
        );
      } else if (
        protocols.some((protocol) => !port.protocols!.includes(protocol))
      ) {
        add(
          "error",
          "SFF protocol mismatch",
          `${provider.c.name} / ${port.id} does not support ${
            protocols.join(", ")
          }.`,
        );
      }
      if (
        row.c.category === "Drive" && input?.protocols &&
        protocols.some((protocol) => !input.protocols!.includes(protocol))
      ) {
        add(
          "error",
          "SFF drive input protocol mismatch",
          `${row.c.name}: the input catalog contradicts its drive interface.`,
        );
      }
      const downstreamDemand = cageDemand.get(`${row.p.id}:${inputId}`) || 0;
      if (input && row.c.category !== "Drive" && input.channels === undefined) {
        add(
          "warning",
          "SFF input channel capacity unknown",
          `${row.c.name} / ${inputId}: document channel demand; downstream drives establish a minimum budget.`,
        );
      }
      const count = route.channels ?? input?.channels ??
          Math.max(1, downstreamDemand),
        start = route.sourceChannel ?? 1;
      if (count < downstreamDemand) {
        add(
          "error",
          "SFF backplane route insufficient channels",
          `${row.c.name} / ${inputId}: ${downstreamDemand} mounted drives require more than ${count} routed channels.`,
        );
      }
      if (input?.channels !== undefined && count !== input.channels) {
        add(
          "error",
          "SFF input channel mismatch",
          `${row.c.name} / ${inputId}: consumes ${input.channels} channels, route supplies ${count}.`,
        );
      }
      if (row.c.category === "Drive" && count !== 1) {
        add(
          "error",
          "SFF drive channel count invalid",
          `${row.c.name}: a single drive consumes one device channel.`,
        );
      }
      const key = `${provider.p.id}:${port.id}`,
        used = booked.get(key) || new Set<number>();
      for (let channel = start; channel < start + count; channel++) {
        if (used.has(channel)) {
          add(
            "error",
            "SFF channel double booked",
            `${provider.c.name} / ${port.id} / channel ${channel} is already assigned.`,
          );
        }
        used.add(channel);
      }
      booked.set(key, used);
      if (port.channels === undefined) {
        add(
          "warning",
          "SFF channel capacity unknown",
          `${provider.c.name} / ${port.id}: document device channels.`,
        );
      } else if (start + count - 1 > port.channels) {
        add(
          "error",
          "SFF channel capacity exceeded",
          `${provider.c.name} / ${port.id}: route exceeds ${port.channels} device channels.`,
        );
      }
      const laneCount = route.pcieLanes ?? input?.pcieLanes ?? 0;
      if (protocols.includes("NVMe")) {
        if (!laneCount) {
          add(
            "warning",
            "SFF PCIe lanes unrecorded",
            `${row.c.name}: record electrical lanes required by this connection.`,
          );
        }
        if (input?.pcieLanes !== undefined && laneCount !== input.pcieLanes) {
          add(
            "error",
            "SFF input lane mismatch",
            `${row.c.name}: route must supply its declared ${input.pcieLanes} lanes.`,
          );
        }
        lanes.set(key, (lanes.get(key) || 0) + laneCount);
        if (port.pcieLanes === undefined) {
          add(
            "warning",
            "SFF PCIe lane capacity unknown",
            `${provider.c.name} / ${port.id}: document PCIe lanes.`,
          );
        }
      } else if (laneCount) {
        add(
          "error",
          "SFF lane protocol invalid",
          `${row.c.name}: PCIe lanes apply to NVMe, not SATA/SAS links.`,
        );
      }
      const bootRequired = row.p.role === "boot" || demands?.boot,
        hotPlugRequired = row.p.mount === "front-hot-swap" || demands?.hotPlug;
      const upstreamProvider = upstream ? byId.get(upstream) : undefined,
        upstreamSlot = componentCapabilities(provider.c).m2Converter
          ? upstreamProvider?.c.specs.driveTargets?.find((target) =>
            target.id === provider.p.targetId
          )
          : undefined;
      if (
        bootRequired &&
        (provider.c.specs.bootable === false ||
          upstreamProvider?.c.specs.bootable === false ||
          upstreamSlot?.bootable === false)
      ) {
        add(
          "error",
          "SFF provider cannot boot",
          `${provider.c.name} cannot boot ${row.c.name}.`,
        );
      }
      if (
        hotPlugRequired &&
        (provider.c.specs.hotPlug === false ||
          upstreamProvider?.c.specs.hotPlug === false)
      ) {
        add(
          "error",
          "SFF hot-plug unsupported",
          `${provider.c.name}: live removal is not supported.`,
        );
      }
      const cable = route.cablePlacementId
        ? byId.get(route.cablePlacementId)
        : undefined;
      if (!cable) {
        add(
          route.cablePlacementId ? "error" : "warning",
          route.cablePlacementId ? "SFF cable missing" : "SFF cable unrecorded",
          `${row.c.name}: record the connecting cable assembly.`,
        );
      } else if (cable.c.category !== "Cable") {
        add(
          "error",
          "SFF cable invalid",
          `${row.c.name}: select a Cable component.`,
        );
      } else {
        if (cable.p.quantity !== 1) {
          add(
            "error",
            "Ambiguous SFF cable instance",
            `${cable.c.name}: split cable assemblies before assigning channels.`,
          );
        }
        const cableStart = route.cableChannel ?? 1,
          cableSet = cableUse.get(cable.p.id) || new Set<number>();
        for (
          let channel = cableStart;
          channel < cableStart + count;
          channel++
        ) {
          if (cableSet.has(channel)) {
            add(
              "error",
              "Storage cable channel double booked",
              `${cable.c.name} / channel ${channel} is already assigned.`,
            );
          }
          cableSet.add(channel);
        }
        cableUse.set(cable.p.id, cableSet);
        if (cable.c.specs.cableChannels === undefined) {
          add(
            "warning",
            "SFF cable capacity unknown",
            `${cable.c.name}: document device channels.`,
          );
        } else if (cableStart + count - 1 > cable.c.specs.cableChannels) {
          add(
            "error",
            "SFF cable capacity exceeded",
            `${cable.c.name}: insufficient channels for this route.`,
          );
        }
        const protocol = cable.c.specs.cableProtocol;
        if (!protocol || protocol === "Other") {
          add(
            "warning",
            "SFF cable protocol unknown",
            `${cable.c.name}: verify the actual wiring protocol.`,
          );
        } else if (
          protocols.some((value) =>
            protocol !== value && !(protocol === "SATA/SAS" && value !== "NVMe")
          )
        ) {
          add(
            "error",
            "SFF cable protocol mismatch",
            `${cable.c.name}: ${protocol} cannot carry ${
              protocols.join(", ")
            }.`,
          );
        }
        const a = connectorKey(cable.c.specs.connectorA),
          b = connectorKey(cable.c.specs.connectorB),
          source = connectorKey(port.connector),
          dest = connectorKey(input?.connector) ||
            (row.c.specs.driveInterface === "SATA" ? "SATA" : undefined);
        const direction = cable.c.specs.cableDirection;
        if (a && b && dest) {
          const forward = a === source && b === dest,
            reverse = b === source && a === dest;
          if (
            !(direction === "reverse-breakout"
              ? reverse
              : direction === "forward-breakout"
              ? forward
              : forward || reverse)
          ) {
            add(
              "error",
              "SFF cable connector or direction mismatch",
              `${cable.c.name}: cable ends and breakout direction do not match the recorded source and input connectors.`,
            );
          }
        } else {add(
            "warning",
            "SFF cable connector review",
            `${cable.c.name}: document both cable ends and destination connector; verify pinout and breakout direction.`,
          );}
      }
      links.push({
        id: `${row.p.id}:${index}`,
        source: `${provider.c.name} / ${port.id} / ${start}–${
          start + count - 1
        }`,
        destination: `${row.c.name} / ${inputId || "drive"}`,
        channels: count,
        lanes: laneCount,
        protocol: protocols.join(", ") || "Unknown",
        cable: cable?.c.name || "Unrecorded",
      });
    }
    for (const input of row.c.specs.sffInputs || []) {
      if (!seen.has(input.id) && !input.disabled) {
        add(
          "warning",
          "SFF input connection unrecorded",
          `${row.c.name} / ${input.id}: record its upstream physical connection.`,
        );
      }
      const demand = cageDemand.get(`${row.p.id}:${input.id}`) || 0;
      if (input.channels !== undefined && demand > input.channels) {
        add(
          "error",
          "SFF backplane channel capacity exceeded",
          `${row.c.name} / ${input.id}: ${demand} drives exceed ${input.channels} channels.`,
        );
      }
    }
  }
  for (const row of rows) {
    for (const port of row.c.specs.sffPorts || []) {
      const key = `${row.p.id}:${port.id}`,
        used = booked.get(key)?.size || 0,
        laneCount = lanes.get(key) || 0;
      if (port.channels !== undefined) {
        resources.push({
          name: `SFF channels ${row.c.name} / ${port.id}`,
          used,
          available: port.disabled ? 0 : port.channels * row.p.quantity,
        });
      }
      if (port.pcieLanes !== undefined) {
        resources.push({
          name: `SFF PCIe lanes ${row.c.name} / ${port.id}`,
          used: laneCount,
          available: port.disabled ? 0 : port.pcieLanes * row.p.quantity,
        });
        if (laneCount > port.pcieLanes * row.p.quantity) {
          add(
            "error",
            "SFF PCIe lane capacity exceeded",
            `${row.c.name} / ${port.id}: ${laneCount} lanes exceed ${
              port.pcieLanes * row.p.quantity
            }.`,
          );
        }
      }
    }
  }
  for (
    const row of rows.filter((row) => componentCapabilities(row.c).m2Converter)
  ) {
    const provider = row.p.adapterPlacementId
        ? byId.get(row.p.adapterPlacementId)
        : board,
      target = provider?.c.specs.driveTargets?.find((target) =>
        target.id === row.p.targetId
      );
    const used = (row.c.specs.sffPorts || []).reduce(
      (sum, port) => sum + (lanes.get(`${row.p.id}:${port.id}`) || 0),
      0,
    );
    if (target?.pcieLanes !== undefined && used > target.pcieLanes) {
      add(
        "error",
        "M.2 converter lane capacity exceeded",
        `${row.c.name}: routes consume ${used} lanes from ${target.id}, which supplies ${target.pcieLanes}.`,
      );
    }
  }
  return { findings, resources, links };
}
