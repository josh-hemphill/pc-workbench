# Vuetify implementation audit

Reviewed 2026-10-09 against the official documentation source for **Vuetify 4.2.4**, the latest stable release at review time and the version already pinned in this application. Three independent code reviews covered forms/accessibility, tables, and navigation/location workflows. The findings below describe the original implementation; the subsequent refactor is recorded here.

Release: https://github.com/vuetifyjs/vuetify/releases/tag/v4.2.4

## Implementation status

The refactor now uses:

- `VNavigationDrawer`, `VListItem`, `VAppBar`, `VMain`, and `VBreadcrumbs` for the application shell. Desktop navigation defaults open and can be collapsed with the hamburger button. Mobile navigation uses a full-width temporary drawer below the two-row top bar, preserving access to the hamburger button and current path. Data and imports lives in the drawer's append slot. Navigation buttons retain explicit accessible button roles, keyboard tab stops, current-page names, and existing dirty-draft guards.
- `VForm` for configuration, component, equipment, PC, inventory, installation, and bulk editors. Submit handlers await Vuetify's validation result and check busy state before and after awaiting. Invalid fields receive focus; configuration validation opens the relevant tab when needed. Enter previews bulk changes; applying or deleting remains an explicit reviewed action.
- Scrollable `VDialog` shells with card title, text, and action sections. Root editors supply their captured activators for native focus restoration, retaining a fallback when an opener has disappeared. Shared programmatic inventory/installation dialogs retain their existing opener fallback handling.
- `VAutocomplete` for large existing-record pickers, while fixed enums remain selects and editable vocabularies remain multi-select comboboxes.
- Native table checkbox event forwarding for Shift range selection, preserving record-specific accessible labels. The component catalog also uses `VDataTable` sorting, pagination, and built-in search across component names and manufacturers. Bulk domain filters and additive hidden selections remain unchanged.
- Explicit tab/panel relationships and native catalog tab windows. Stable panel IDs and accessible names remain application responsibilities.
- Vuetify's built-in light/dark/system theme resolution. Existing SQLite preference storage and startup caching remain; custom UI colors use Vuetify-generated variables instead of duplicate light/dark CSS palettes.
- `VSnackbarQueue` for notifications and native chips for build health and catalog status. Compatible builds now have explicit success styling.
- An explicit component/directive registration list and a shared scoped `v-table-scroll` directive. Tables use declarative labels or captions; the directive supplies the keyboard-scroll regions Vuetify does not provide.

The optional tree browser was not added: existing operational tables and searchable full-path pickers already meet location browsing and assignment needs. Structural tree leaves still must not determine assignment eligibility. CSS Grid and the accessible native appearance selector remain appropriate. Accessibility-specific typography, contrast, wrapping, and focus overrides were retained where supported component props alone do not provide equivalent behavior; obsolete shell rules and duplicated basic field styles were removed.

Production output compared with the pre-refactor commit: JavaScript approximately **1,104 → 844 kB** and CSS **545 → 390 kB**, before compression. The existing large JavaScript chunk warning remains; no warning threshold was raised.

Validation: application type checks and production/backend builds pass; **231 application tests** and **7 desktop tests** pass. Isolated Chromium checks cover real desktop/mobile navigation, keyboard submission and invalid-field focus, opener focus restoration, native manufacturer search, light/dark/system appearance, 44-pixel appearance targets, Shift selection without double toggles, keyboard tab activation, numeric bulk-fill errors, retained hidden selections, preview invalidation, atomic bulk edits, and dependency-aware deletion. Test workspaces were temporary; no production inventory data was modified.

Responsive follow-up: the desktop drawer is 304 pixels wide and the appearance selector is 184 pixels wide. Desktop navigation retains its open/closed state during page changes; crossing into mobile closes the drawer, and returning to desktop opens it. Mobile layout reserves 128 pixels for the top bar. Page overflow checks compare `scrollWidth` with `documentElement.clientWidth`, which accounts for vertical scrollbars. Long unbroken record names exposed grid minimum-width overflow; shrinking grid children and wrapping names fixes it without hiding page content or disabling horizontal table scrolling. Browser checks cover all pages and the builder at narrow widths, including long names, and real drawer toggles at desktop and mobile sizes.

## Findings and recommended order

### 1. Restore native range selection in table checkbox slots

The location, PC inventory, location overview, and catalog-maintenance tables customize `item.data-table-select` to give each checkbox a record-specific accessible name. That is useful, but their `v-bind="checkbox"` uses Vuetify's supplied slot click handler, which calls `toggleSelect(item)` without the row index or mouse event. Vuetify's default checkbox passes both and supports Shift range selection.

Preserve the accessible names and explicitly forward the slot's `internalItem`, `index`, and click event to `toggleSelect`, stopping propagation. Override the supplied click handler rather than adding a second toggle. Verify ordinary selection, Shift selection, sorting, pagination, filtered selections, and the application's selection limits together.

Evidence: installed `VDataTableRow.js`, lines 141–155; application checkbox slots in `InstallationsWorkspace.vue`, `InventoryWorkspace.vue`, `LocationOverview.vue`, and `CatalogMaintenance.vue`.

Docs: https://vuetifyjs.com/en/components/data-tables/data-and-display/

### 2. Use VForm to coordinate input validation and submission

The application has input `rules` and manual save-time checks but no `VForm`. Wrap editors in `VForm`, await `validate()` or the submit event's validation result before saving, and use submit buttons to support keyboard submission. Choose an explicit `validate-on` policy. Native `required`, `min`, and `max` attributes alone do not replace Vuetify rules or backend validation.

Keep shared schema validation, compatibility checks, lifecycle rules, atomic bulk previews, and server errors. `VForm` coordinates fields; it does not supply those business rules or automatically focus the first invalid field.

Docs: https://vuetifyjs.com/en/components/forms/

### 3. Replace the custom navigation shell with the application layout system

`App.vue` and `style.css` implement a fixed sidebar, main-content offsets, responsive navigation, bottom positioning, and a top bar. `VNavigationDrawer`, `VList`/`VListItem`, `VAppBar`, and `VMain` already coordinate these responsibilities. The drawer's `append` slot is a direct fit for the bottom Data and imports action. `VBreadcrumbs` can replace the manually assembled breadcrumb strip.

Preserve the existing unsaved-change guard, page focus handoff, landmarks, and the intended mobile navigation experience. Introducing Vue Router is not required for this replacement.

Docs: https://vuetifyjs.com/en/features/application-layout/
and https://vuetifyjs.com/en/components/navigation-drawers/

### 4. Simplify dialog shells and focus handling

Editors already use `VDialog`, but repeat custom header/body/footer markup and scrolling CSS. Prefer `VDialog scrollable` with `VCardTitle`, `VCardText`, and `VCardActions`, keeping semantic headings and `aria-labelledby`.

Vuetify already provides modal semantics, focus retention, initial content focus, and activator focus restoration. Supply an activator element where practical. Programmatically opened shared dialogs still need a fallback when their opener disappears. Keep dirty-draft guards and explicit Escape behavior; removing `persistent` indiscriminately would bypass them.

Docs: https://vuetifyjs.com/en/components/dialogs/

### 5. Consolidate theming and reduce fragile CSS overrides

`appearance.ts` separately watches `prefers-color-scheme`; `App.vue` resolves that into two named themes. Vuetify 4 supports `defaultTheme: 'system'` and runtime `theme.change('system' | 'light' | 'dark')`, including reacting to system changes. Define our palettes as light/dark themes and let Vuetify resolve them. Retain SQLite preference persistence and the startup cache, since those serve the standalone application's storage requirements.

Use Vuetify-generated theme variables/custom colors instead of maintaining parallel color definitions where practical. The stylesheet has 96 `!important` declarations, many targeting internal component classes. Prefer global defaults, supported sizing/density props, and documented Sass customization first. Retain necessary contrast, focus, wrapping, and target-size adjustments until browser checks demonstrate equivalent behavior.

Docs: https://vuetifyjs.com/en/features/theme/
and https://vuetifyjs.com/en/features/global-configuration/

### 6. Stop registering the entire component library

`src/main.ts` imports and registers all Vuetify components and directives. Use `vite-plugin-vuetify` automatic imports or an explicit component/directive allowlist to enable effective tree shaking. Verify the Deno/Vite integration and compare production bundle sizes rather than assuming a specific reduction. Whole-library registration is an avoidable contributor to the existing large-chunk warning.

Docs: https://vuetifyjs.com/en/features/treeshaking/

### 7. Use searchable pickers and optional tree browsing

Large existing-record choices such as PCs, parent locations, components, and configurations are better candidates for `VAutocomplete` than `VSelect`. Keep `VCombobox` for catalog vocabulary fields where users may author new values; the current multi-select combobox approach is appropriate.

Stable `VTreeview` can provide location hierarchy browsing, search, expansion, and keyboard navigation. Keep ID-based hierarchy construction, cycle exclusion, assignment eligibility, and explicit bulk selection. A Station/Bench/System may have children, so structural leaf status must not determine assignment eligibility. Tree selection must not silently add descendant deletion targets.

Docs: https://vuetifyjs.com/en/components/autocompletes/
and https://vuetifyjs.com/en/components/treeview/

### 8. Use declarative table labels and shared accessibility helpers

Five components repeat DOM hooks that label tables and scrolling wrappers. Vuetify 4's `VTable` forwards `aria-label` to the native table; use that and the caption slot declaratively. Consolidate the remaining keyboard-scroll region labeling into one scoped helper.

Do not remove that helper entirely: the current table wrapper does not expose a complete tabindex/region-label prop interface. Likewise, `VTabs` supplies tab semantics, but `VTabsWindowItem` does not automatically establish all tab/panel relationships. Add explicit IDs, `aria-controls`, `role="tabpanel"`, and `aria-labelledby` whether retaining conditional panels or adopting windows.

Docs: https://vuetifyjs.com/en/components/tables/
and https://vuetifyjs.com/en/components/tabs/

### 9. Queue notifications instead of replacing the current message

The root `VSnackbar` uses one message and open flag, so a subsequent notification replaces the current one. `VSnackbarQueue` supplies sequential or stacked delivery, per-message options, and promise states. Use it if concurrent operations should retain all user-facing results; persistent actionable errors should remain in their relevant form or workspace.

Docs: https://vuetifyjs.com/en/components/snackbar-queue/

### 10. Standardize status badges without changing their meaning

Custom status/count badges can use `VChip` and `VBadge` with explicit domain-to-color mappings. An existing display issue deserves correction independently: `App.vue`'s build-health badge maps `Conflicts` to conflict styling and every other result to review styling, including `Compatible`. Give Compatible an explicit success mapping while retaining accessible status text.

Docs: https://vuetifyjs.com/en/components/chips/
and https://vuetifyjs.com/en/components/badges/

## Existing implementation to retain

The main list tables already use `VDataTable` sorting, pagination, ID-based selection, and page-scoped header selection. Small detail/resource tables are reasonable uses of `VTable`.

Simple text search could move to `search`, `filter-keys`, and `custom-filter`. Hierarchy, repair, compatibility, and stock filters remain application logic. Any migration must preserve access to the exact matching records for bulk actions.

Add-all-matches actions, selection caps, hidden selections, stale-ID cleanup, dependency-aware deletion, preview tokens, revision checks, CSV migration, catalog enrichment, and compatibility/resource calculations are application behavior. Vuetify's `select-strategy="all"` does not preserve our additive selection semantics across changing filters and is not an equivalent replacement.

CSS Grid and native accessible controls are not problems merely because Vuetify has alternatives. Replace custom UI where the framework demonstrably reduces maintenance or restores behavior, and preserve the application's established usability requirements.

## Original review limits

The initial findings were checked against release-pinned official documentation and installed component source. That initial review made no application changes. The later implementation and its verification are recorded above. Future framework changes should still be checked against installed APIs and targeted keyboard, focus, responsive-layout, and light/dark browser checks.
