import { z } from "zod";
import { transitionScenarioSchema } from "./transitions.ts";

// Plans reference IDs deliberately: deleted hardware must become a planning
// finding rather than prevent the user from reopening an older plan.
export const planInputSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  scenario: transitionScenarioSchema.nullable(),
  draft: transitionScenarioSchema.nullable(),
  workspaceRevision: z.string().max(100),
  draftWorkspaceRevision: z.string().max(100),
}).strict().refine(
  (p) => !!p.scenario || !!p.draft,
  "A plan must have saved inputs or a draft.",
);
export type PlanInput = z.infer<typeof planInputSchema>;
export type StoredPlan = PlanInput & { updatedAt: string };
export type PlanSnapshot = StoredPlan & { revision: string };
export function parsePlans(input: unknown): StoredPlan[] {
  const plans = z.array(
    z.object({
      id: z.string(),
      scenario: transitionScenarioSchema.nullable(),
      draft: transitionScenarioSchema.nullable(),
      workspaceRevision: z.string().max(100),
      draftWorkspaceRevision: z.string().max(100),
      updatedAt: z.iso.datetime(),
    }).strict(),
  ).max(500).parse(input);
  for (const { updatedAt: _, ...input } of plans) {
    planInputSchema.parse(input);
    if (
      new TextEncoder().encode(JSON.stringify(input)).length > 2 * 1024 * 1024
    ) throw Error("A plan must be under 2 MiB.");
  }
  if (new Set(plans.map((p) => p.id)).size !== plans.length) {
    throw Error("Duplicate transition plan IDs.");
  }
  return plans;
}
