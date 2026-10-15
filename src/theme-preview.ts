import { computed } from 'vue';
import { activeAppearance, beginAppearancePreview, themePreference, systemDark } from './appearance.ts';
import { paletteCssVariables, paletteTheme, presetPalettes, type PaletteName, type PaletteMode, type ColorRole } from '../shared/theme-palettes.ts';

export const previewPalette = computed({
  get:()=>activeAppearance.value.palette,
  set:(value:PaletteName)=>{beginAppearancePreview().palette=value;},
});
export const previewMode = computed<PaletteMode>(() =>
  themePreference.value==='dark'||(themePreference.value==='system'&&systemDark.value)?'dark':'light');
export function resolvedPalette(name:PaletteName,mode:PaletteMode) {
  const palette={...presetPalettes[name][mode]};
  for(const [role,value] of Object.entries(activeAppearance.value.customColors[name]?.[mode]??{})) {
    if(value!==undefined)palette[role as ColorRole]=value;
  }
  return palette;
}
export const activePalette = computed(()=>resolvedPalette(previewPalette.value,previewMode.value));
export const activeThemeName = computed(()=>`${previewPalette.value}-${previewMode.value}`);
export const activeThemeDefinition = computed(()=>paletteTheme(previewPalette.value,previewMode.value,activePalette.value));
export function setPreviewColor(role:ColorRole,value:string) {
  if(!/^#[0-9a-f]{6}$/i.test(value))return;
  const draft=beginAppearancePreview(),name=draft.palette,mode=previewMode.value;
  draft.customColors[name]??={};draft.customColors[name]![mode]??={};
  draft.customColors[name]![mode]![role]=value;
}
export function resetPreview() {
  const draft=beginAppearancePreview();draft.customColors={};draft.palette='bench';
}
export function resetPalette() { delete beginAppearancePreview().customColors[previewPalette.value]; }
export function exportPreviewThemes() {
  const name=previewPalette.value;
  return Object.fromEntries((['light','dark'] as const).map(mode=>[`${name}-${mode}`,paletteTheme(name,mode,resolvedPalette(name,mode))]));
}
export function applyPaletteCss() {
  const root=document.documentElement;root.dataset.theme=previewMode.value;root.style.colorScheme=previewMode.value;
  for(const [key,value] of Object.entries(paletteCssVariables(activePalette.value,previewMode.value)))root.style.setProperty(key,value);
}
