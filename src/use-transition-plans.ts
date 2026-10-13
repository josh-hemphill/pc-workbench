import { onBeforeUnmount, onMounted, type Ref, ref, watch } from "vue";
import {
  newTransitionScenario,
  type TransitionScenario,
  transitionScenarioSchema,
} from "../shared/transitions";
import type { PlanInput, PlanSnapshot } from "../shared/transition-plans";

export function useTransitionPlans(
  scenario: Ref<TransitionScenario>,
  fileRevision: Ref<string>,
  reviewed: Ref<string>,
  workspaceRevision: () => string,
) {
  const plans = ref<PlanSnapshot[]>([]),
    activeId = ref(crypto.randomUUID() as string),
    selectedPlan = ref("");
  const planBusy = ref(false),
    planLoading = ref(true),
    plansError = ref(""),
    autosaveState = ref("");
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => resolveReady = resolve);
  const persisted = ref(JSON.stringify(scenario.value));
  let active: PlanSnapshot | null = null,
    timer: ReturnType<typeof setTimeout> | undefined,
    disposed = false,
    paused = false,
    conflicted = false;
  const fingerprint = () => JSON.stringify(scenario.value);
  async function request(
    route: string,
    method = "GET",
    input?: unknown,
    revision?: string,
  ) {
    const response = await fetch(route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(revision ? { "If-Match": revision } : {}),
      },
      body: input === undefined ? undefined : JSON.stringify(input),
    });
    const body = await response.json();
    if (!response.ok) throw Error(body.error || "Plan storage failed.");
    return body;
  }
  async function reloadPlans() {
    const data = await request("/api/transition-plans");
    plans.value = data.plans;
  }
  function remember(plan: PlanSnapshot) {
    active = plan;
    plans.value = [...plans.value.filter((p) => p.id !== plan.id), plan];
    selectedPlan.value = plan.id;
  }
  async function persist(save = false) {
    if (planBusy.value || planLoading.value || disposed || conflicted) return;
    const parsed = transitionScenarioSchema.safeParse(scenario.value);
    if (!parsed.success) {
      autosaveState.value = "Correct invalid inputs to autosave this draft.";
      return;
    }
    const current = fingerprint();
    if (!save && current === persisted.value) return;
    planBusy.value = true;
    plansError.value = "";
    autosaveState.value = "Saving…";
    try {
      const input: PlanInput = {
        id: activeId.value,
        scenario: save ? parsed.data : active?.scenario ?? null,
        draft: save ? null : parsed.data,
        workspaceRevision: save
          ? fileRevision.value
          : active?.workspaceRevision ?? fileRevision.value,
        draftWorkspaceRevision: fileRevision.value,
      };
      const plan = await request(
        `/api/transition-plans/${input.id}`,
        "PUT",
        input,
        active?.revision ?? "missing",
      );
      remember(plan);
      persisted.value = current;
      autosaveState.value = save
        ? "Plan saved in workspace."
        : "Draft autosaved in workspace.";
    } catch (e) {
      plansError.value = e instanceof Error ? e.message : String(e);
      autosaveState.value =
        "Draft not saved. Export a plan file to keep these inputs.";
      conflicted = true;
    } finally {
      planBusy.value = false;
      if (!disposed && !conflicted && fingerprint() !== current) schedule();
    }
  }
  function schedule() {
    if (fingerprint() === persisted.value) {
      clearTimeout(timer);
      if (!paused) {
        autosaveState.value = active?.draft
          ? "Draft autosaved in workspace."
          : active?.scenario
          ? "Plan saved in workspace."
          : "Changes autosave as drafts in this portable workspace.";
      }
      return;
    }
    if (paused || planLoading.value || disposed || conflicted) return;
    clearTimeout(timer);
    autosaveState.value = "Draft changes waiting to save…";
    timer = setTimeout(() => void persist(), 400);
  }
  watch(scenario, schedule, { deep: true, flush: "sync" });
  function hasUnsavedChanges() {
    return planBusy.value || fingerprint() !== persisted.value;
  }
  function confirmDiscard() {
    if (planBusy.value || planLoading.value) return false;
    if (
      hasUnsavedChanges() &&
      !window.confirm(
        "This draft has changes that have not been stored. Discard those changes? Export a plan file to keep them.",
      )
    ) return false;
    clearTimeout(timer);
    return true;
  }
  function setScenario(value: TransitionScenario, revision: string) {
    paused = true;
    clearTimeout(timer);
    scenario.value = JSON.parse(JSON.stringify(value));
    fileRevision.value = revision;
    reviewed.value = "";
    persisted.value = fingerprint();
    paused = false;
    conflicted = false;
    plansError.value = "";
  }
  function resetPlan() {
    active = null;
    activeId.value = crypto.randomUUID();
    selectedPlan.value = "";
    setScenario(newTransitionScenario(), workspaceRevision());
    autosaveState.value =
      "New plan. Changes will autosave as a workspace draft.";
  }
  function newPlan(confirmed = false) {
    if (confirmed === true || confirmDiscard()) resetPlan();
  }
  async function openWorkspacePlan(
    id: string,
    savedOnly = false,
    confirmed = false,
  ) {
    await ready;
    if (disposed || (confirmed !== true && !confirmDiscard())) return;
    planLoading.value = true;
    try {
      await reloadPlans();
    } catch (e) {
      plansError.value = e instanceof Error ? e.message : String(e);
      return;
    } finally {
      planLoading.value = false;
    }
    if (disposed) return;
    const plan = plans.value.find((p) => p.id === id);
    if (!plan) {
      plansError.value =
        "This workspace plan was not found. It may have been deleted.";
      return;
    }
    activeId.value = id;
    remember(plan);
    const inputs = savedOnly ? plan.scenario : plan.draft ?? plan.scenario;
    if (!inputs) return;
    setScenario(
      inputs,
      !savedOnly && plan.draft
        ? plan.draftWorkspaceRevision
        : plan.workspaceRevision,
    );
    autosaveState.value = !savedOnly && plan.draft
      ? "Recovered workspace draft."
      : "Opened saved workspace plan.";
  }
  function importedPlan(value: TransitionScenario, revision: string) {
    active = null;
    activeId.value = crypto.randomUUID();
    selectedPlan.value = "";
    setScenario(value, revision);
    persisted.value = "";
    schedule();
  }
  async function deletePlan() {
    if (
      !active || !confirmDiscard() ||
      !window.confirm("Delete this workspace plan and its draft?")
    ) return;
    planBusy.value = true;
    try {
      await request(
        `/api/transition-plans/${active.id}`,
        "DELETE",
        undefined,
        active.revision,
      );
      plans.value = plans.value.filter((p) => p.id !== active!.id);
      planBusy.value = false;
      resetPlan();
    } catch (e) {
      plansError.value = e instanceof Error ? e.message : String(e);
    } finally {
      planBusy.value = false;
    }
  }
  function saveWorkspacePlan() {
    clearTimeout(timer);
    void persist(true);
  }
  function retryDraft() {
    conflicted = false;
    void persist();
  }
  onMounted(async () => {
    try {
      await reloadPlans();
      autosaveState.value =
        "Changes autosave as drafts in this portable workspace.";
    } catch (e) {
      plansError.value = e instanceof Error ? e.message : String(e);
      conflicted = true;
    } finally {
      planLoading.value = false;
      resolveReady();
    }
  });
  onBeforeUnmount(() => {
    disposed = true;
    clearTimeout(timer);
  });
  return {
    awaitReady: () => ready,
    plans,
    activeId,
    selectedPlan,
    planBusy,
    planLoading,
    plansError,
    autosaveState,
    hasUnsavedChanges,
    confirmDiscard,
    newPlan,
    openWorkspacePlan,
    importedPlan,
    deletePlan,
    saveWorkspacePlan,
    retryDraft,
  };
}
