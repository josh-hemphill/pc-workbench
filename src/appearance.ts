import { computed, ref } from 'vue';
import type { ThemePreference } from '../shared/appearance.ts';
import { defaultUserSettings, userSettingsSchema, type AppearanceSettings, type SettingsSnapshot, type UserSettings } from '../shared/settings.ts';

export const cloneSettings = <T>(value:T):T => JSON.parse(JSON.stringify(value));
export const userSettings = ref<SettingsSnapshot<UserSettings>>({ value:cloneSettings(defaultUserSettings), revision:'missing', exists:false });
export const appearanceDraft = ref<AppearanceSettings|null>(null);
export const activeAppearance = computed(() => appearanceDraft.value ?? userSettings.value.value.appearance);
export const themePreference = computed(() => activeAppearance.value.theme);
export const legacyTheme = ref<ThemePreference|null>(null);
export const settingsReady = ref(false);
export const settingsLoadError = ref('');
export const systemDark = ref(window.matchMedia('(prefers-color-scheme: dark)').matches);
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', event => { systemDark.value = event.matches; });
export const appearanceDirty = computed(() => appearanceDraft.value !== null && JSON.stringify(appearanceDraft.value) !== JSON.stringify(userSettings.value.value.appearance));
export function beginAppearancePreview() {
  if (!appearanceDraft.value) appearanceDraft.value = cloneSettings(userSettings.value.value.appearance);
  return appearanceDraft.value;
}
export function cancelAppearancePreview() { appearanceDraft.value = null; }
export async function settingsRequest<T>(url:string, options:RequestInit={}):Promise<T> {
  const response=await fetch(url,{...options,signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json',...options.headers}});
  const result=await response.json();
  if(!response.ok)throw Error(result.error || 'Settings could not be saved.');
  return result;
}
export async function loadAppearance() {
  try {
    const snapshot=await settingsRequest<SettingsSnapshot<UserSettings>&{legacyTheme:ThemePreference|null}>('/api/settings/user');
    userSettings.value={...snapshot,value:userSettingsSchema.parse(snapshot.value)};
    legacyTheme.value=snapshot.legacyTheme;settingsReady.value=true;settingsLoadError.value='';
  } catch(error) { settingsReady.value=false;settingsLoadError.value=error instanceof Error?error.message:String(error); }
}
export async function saveUserAppearance(appearance:AppearanceSettings) {
  if(!settingsReady.value)throw Error('Reload user settings before saving.');
  const snapshot=await settingsRequest<SettingsSnapshot<UserSettings>>('/api/settings/user',{
    method:'PUT',headers:{'If-Match':userSettings.value.revision},body:JSON.stringify({version:1,appearance}),
  });
  userSettings.value=snapshot;legacyTheme.value=null;
}
export async function applyAppearancePreview() {
  await saveUserAppearance(cloneSettings(activeAppearance.value));
  cancelAppearancePreview();
}
let pendingSave:Promise<void>=Promise.resolve();
export function saveAppearance(theme:ThemePreference):Promise<void> {
  pendingSave=pendingSave.catch(()=>{}).then(async()=>{
    if(appearanceDraft.value)throw Error('Apply or cancel the appearance preview in Settings first.');
    await saveUserAppearance({...cloneSettings(userSettings.value.value.appearance),theme});
  });
  return pendingSave;
}
export async function importLegacyAppearance() {
  userSettings.value=await settingsRequest<SettingsSnapshot<UserSettings>>('/api/settings/user/import-legacy',{
    method:'POST',headers:{'If-Match':userSettings.value.revision},body:'{}',
  });
  legacyTheme.value=null;cancelAppearancePreview();
}
