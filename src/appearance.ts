import { ref } from 'vue';
import { isThemePreference, type ThemePreference } from '../shared/appearance';

const storageKey = 'pc-workbench-theme';
export const themePreference = ref<ThemePreference>('system');
const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
const media = window.matchMedia('(prefers-color-scheme: dark)');
media.addEventListener('change', event => { systemDark.value = event.matches; });
export { systemDark };
export function cacheTheme(value: ThemePreference) {
  themePreference.value = value;
  try { localStorage.setItem(storageKey, value); } catch { /* Workspace persistence still works when browser storage is unavailable. */ }
}
export async function loadAppearance() {
  try { const value = localStorage.getItem(storageKey); if (isThemePreference(value)) themePreference.value = value; } catch { /* Private browser storage can be disabled. */ }
  try {
    const response = await fetch('/api/preferences', { signal: AbortSignal.timeout(1500) });
    if (!response.ok) return;
    const preferences = await response.json();
    if (isThemePreference(preferences.theme)) cacheTheme(preferences.theme);
  } catch { /* The application itself reports API connection failures. */ }
}
let pendingSave: Promise<void> = Promise.resolve();
export function saveAppearance(value: ThemePreference): Promise<void> {
  cacheTheme(value);
  // Serialize rapid changes so the last selection is also the stored one.
  pendingSave = pendingSave.catch(() => {}).then(async () => {
    const response = await fetch('/api/preferences', {
      signal: AbortSignal.timeout(5000), method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ theme: value }),
    });
    if (!response.ok) throw Error('The appearance changed, but its preference could not be saved.');
  });
  return pendingSave;
}
