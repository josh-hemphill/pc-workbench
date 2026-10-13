import { nextTick, type ObjectDirective } from "vue";

/** Add keyboard access to Vuetify's overflow wrapper, scoped to this table. */
function labelScrollRegions(element: HTMLElement, explicitName?: string) {
  const wrappers = element.matches(".v-table__wrapper")
    ? [element]
    : [...element.querySelectorAll<HTMLElement>(".v-table__wrapper")];
  for (const wrapper of wrappers) {
    const table = wrapper.querySelector("table");
    const name = explicitName?.trim() ||
      table?.getAttribute("aria-label")?.trim() ||
      table?.querySelector("caption")?.textContent?.trim() || "Data table";
    wrapper.tabIndex = 0;
    wrapper.setAttribute("role", "region");
    wrapper.setAttribute("aria-label", `${name}; scroll to view all columns`);
  }
}

// Vuetify supplies the table and caption; only the overflow region needs this.
export const tableScroll: ObjectDirective<HTMLElement, string | undefined> = {
  mounted(element, binding) {
    void nextTick(() => labelScrollRegions(element, binding.value));
  },
  updated(element, binding) {
    void nextTick(() => labelScrollRegions(element, binding.value));
  },
};
