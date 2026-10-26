export const routePages = {
  configurations: "Configurations",
  catalog: "Component catalog",
  stock: "Component inventory",
  systems: "Equipment systems",
  pcs: "PC inventory",
  storage: "Storage planner",
  transitions: "Configuration transitions",
  installations: "Installations",
  data: "Data & imports",
  settings: "Settings",
} as const;
export type RoutePage = typeof routePages[keyof typeof routePages];
export interface WorkspaceRoute {
  page: RoutePage;
  view: string;
  id: string;
  editor: "" | "component" | "system" | "pc";
  editorId: string;
  editorView: string;
}
const defaults: Record<RoutePage, string> = {
  "Configurations": "components",
  "Component catalog": "components",
  "Component inventory": "allocations",
  "Equipment systems": "",
  "PC inventory": "parts",
  "Storage planner": "",
  "Configuration transitions": "",
  "Installations": "locations",
  "Data & imports": "",
  "Settings": "",
};
const views: Partial<Record<RoutePage, string[]>> = {
  "Configurations": ["components", "connections", "storage", "checks"],
  "Component catalog": ["components", "gaps", "queue"],
  "Component inventory": ["allocations", "history"],
  "PC inventory": ["parts", "readiness", "report", "history", "inspection"],
  "Installations": ["locations", "requirements", "operations", "distribution"],
};
export function workspaceRoute(
  page: RoutePage = "Configurations",
): WorkspaceRoute {
  return {
    page,
    view: defaults[page],
    id: "",
    editor: "",
    editorId: "",
    editorView: "",
  };
}
export function parseWorkspaceRoute(hash: string): WorkspaceRoute {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?"),
    parts = path.split("/");
  // Retain useful aliases for links shared before catalog consolidation.
  const slug = parts[0] === "catalog-data" ? "catalog" : parts[0];
  const page = routePages[slug as keyof typeof routePages] ?? "Configurations",
    route = workspaceRoute(page);
  if (parts[0] === "catalog-data") route.view = "gaps";
  const recordFirst = ["Configurations", "PC inventory", "Component inventory"]
    .includes(page);
  if (recordFirst) {
    if (parts[1]) {
      try {
        route.id = decodeURIComponent(parts[1]);
      } catch {
        return workspaceRoute();
      }
    }
    if (views[page]?.includes(parts[2])) route.view = parts[2];
  } else if (views[page]?.includes(parts[1])) route.view = parts[1];
  if (!recordFirst && parts[2]) {
    try {
      route.id = decodeURIComponent(parts[2]);
    } catch {
      return workspaceRoute();
    }
  }
  if (!views[page] && parts[1]) {
    try {
      route.id = decodeURIComponent(parts[1]);
    } catch {
      return workspaceRoute();
    }
  }
  const params = new URLSearchParams(query), editor = params.get("edit");
  if (editor && ["component", "system", "pc"].includes(editor)) {
    route.editor = editor as WorkspaceRoute["editor"];
    route.editorId = params.get("record") || "new";
    if (editor === "component") {
      route.editorView =
        ["basics", "ports", "cooling", "expansion", "storage", "physical", "review"]
            .includes(params.get("section") || "")
          ? params.get("section")!
          : "basics";
    }
  }
  return route;
}
export function encodeWorkspaceRoute(route: WorkspaceRoute): string {
  const slug =
    Object.entries(routePages).find(([, page]) => page === route.page)?.[0] ??
      "configurations";
  const recordFirst = ["Configurations", "PC inventory", "Component inventory"]
    .includes(route.page);
  const parts = [slug];
  if (recordFirst) {
    if (route.id) {
      parts.push(encodeURIComponent(route.id));
      parts.push(
        views[route.page]!.includes(route.view)
          ? route.view
          : defaults[route.page],
      );
    }
  } else {
    if (views[route.page]) {
      parts.push(
        views[route.page]!.includes(route.view)
          ? route.view
          : defaults[route.page],
      );
    }
    if (route.id) parts.push(encodeURIComponent(route.id));
  }
  const params = new URLSearchParams();
  if (route.editor) {
    params.set("edit", route.editor);
    params.set("record", route.editorId || "new");
    if (
      route.editor === "component" && route.editorView &&
      route.editorView !== "basics"
    ) params.set("section", route.editorView);
  }
  return "#/" + parts.join("/") + (params.size ? "?" + params.toString() : "");
}
