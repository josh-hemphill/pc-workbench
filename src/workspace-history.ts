import {
  encodeWorkspaceRoute,
  parseWorkspaceRoute,
  type WorkspaceRoute,
} from "../shared/workspace-route";

interface HistoryEntry {
  benchIndex: number;
  benchContext?: unknown;
}
/** Browser history owns page navigation. UI filters stay in history state, not URLs. */
export function createWorkspaceHistory(options: {
  read: () => WorkspaceRoute;
  capture: () => unknown;
  apply: (route: WorkspaceRoute, context?: unknown) => Promise<void>;
  canLeave: (from: WorkspaceRoute, to: WorkspaceRoute) => boolean;
}) {
  let ready = false,
    applying = false,
    restoring = false,
    index = Number(history.state?.benchIndex ?? 0),
    activeHash = location.hash;
  const state = (context: unknown): HistoryEntry => ({
    benchIndex: index,
    benchContext: context,
  });
  async function readLocation(event?: Event) {
    if (!ready || applying) return;
    if (restoring) {
      restoring = false;
      return;
    }
    const entry = history.state as HistoryEntry | null;
    // A manually entered hash has no application state. Let its hashchange
    // event handle it so a declined edit can return to the previous entry.
    if (event?.type === "popstate" && entry?.benchIndex === undefined) return;
    if (location.hash === activeHash && entry?.benchIndex === index) return;
    const target = parseWorkspaceRoute(location.hash);
    const targetIndex = entry?.benchIndex;
    if (!options.canLeave(options.read(), target)) {
      if (typeof targetIndex === "number" && targetIndex !== index) {
        restoring = true;
        history.go(index - targetIndex);
      } else if (event?.type === "hashchange" && targetIndex === undefined) {
        restoring = true;
        history.back();
      } else history.replaceState(state(options.capture()), "", activeHash);
      return;
    }
    applying = true;
    try {
      index = typeof targetIndex === "number" ? targetIndex : index + 1;
      await options.apply(target, entry?.benchContext);
      activeHash = encodeWorkspaceRoute(options.read());
      history.replaceState(state(options.capture()), "", activeHash);
    } finally {
      applying = false;
    }
  }
  window.addEventListener("popstate", readLocation);
  window.addEventListener("hashchange", readLocation);
  return {
    async start() {
      applying = true;
      try {
        await options.apply(
          parseWorkspaceRoute(location.hash),
          history.state?.benchContext,
        );
        ready = true;
        activeHash = encodeWorkspaceRoute(options.read());
        history.replaceState(state(options.capture()), "", activeHash);
      } finally {
        applying = false;
      }
    },
    async navigate(target: WorkspaceRoute, context?: unknown) {
      if (!ready || applying || !options.canLeave(options.read(), target)) {
        return false;
      }
      history.replaceState(state(options.capture()), "", activeHash);
      applying = true;
      try {
        await options.apply(target, context);
        const hash = encodeWorkspaceRoute(options.read());
        if (hash !== activeHash) {
          index++;
          activeHash = hash;
          history.pushState(state(options.capture()), "", hash);
        } else history.replaceState(state(options.capture()), "", hash);
        return true;
      } finally {
        applying = false;
      }
    },
    sync() {
      if (!ready || applying || restoring) return;
      const next = options.read(), hash = encodeWorkspaceRoute(next);
      if (hash === activeHash) {
        history.replaceState(state(options.capture()), "", hash);
        return;
      }
      const previous = parseWorkspaceRoute(activeHash);
      const resolvedDraft = previous.page === next.page &&
        ((previous.id === "new" && !!next.id && next.id !== "new") ||
          (previous.editor === next.editor && previous.editorId === "new" &&
            !!next.editorId && next.editorId !== "new") ||
          (previous.page === "Configuration transitions" && !previous.id &&
            !!next.id));
      if (resolvedDraft) {
        activeHash = hash;
        history.replaceState(state(options.capture()), "", hash);
        return;
      }
      index++;
      activeHash = hash;
      history.pushState(state(options.capture()), "", hash);
    },
    stop() {
      window.removeEventListener("popstate", readLocation);
      window.removeEventListener("hashchange", readLocation);
    },
  };
}
