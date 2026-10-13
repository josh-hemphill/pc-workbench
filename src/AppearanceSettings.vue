<script setup lang="ts">
import { computed, ref } from 'vue';
import { mdiDownload } from '@mdi/js';
import { paletteChoices, colorRoles, type ColorRole } from '../shared/theme-palettes';
import type { ThemePreference } from '../shared/appearance';
import { activePalette, previewPalette, previewMode, setPreviewColor, resetPalette, resetPreview, exportPreviewThemes } from './theme-preview';
import { themePreference, beginAppearancePreview, applyAppearancePreview, cancelAppearancePreview, appearanceDraft, appearanceDirty, settingsReady, settingsLoadError, loadAppearance, legacyTheme, importLegacyAppearance } from './appearance';

const role=ref<ColorRole>('primary'),busy=ref(false),error=ref(''),notice=ref('');
const mode=computed({get:()=>themePreference.value,set:(value:ThemePreference)=>{beginAppearancePreview().theme=value;}});
const color=computed({get:()=>activePalette.value[role.value],set:(value:string)=>setPreviewColor(role.value,value)});
async function run(action:()=>Promise<void>,message:string) {
  busy.value=true;error.value='';notice.value='';
  try{await action();notice.value=message;}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
async function reload(){cancelAppearancePreview();await loadAppearance();}
function download() {
  const url=URL.createObjectURL(new Blob([JSON.stringify({themes:exportPreviewThemes()},null,2)],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=`${previewPalette.value}-themes.json`;link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
defineExpose({hasUnsavedChanges:()=>busy.value||appearanceDirty.value,isBusy:()=>busy.value});
</script>
<template>
  <section class="panel settings-section" aria-labelledby="appearance-settings-title">
    <h2 id="appearance-settings-title">User settings · Appearance</h2>
    <p>Your appearance follows your OS user across workspaces. Changes preview live; Apply saves them and Cancel restores the saved appearance.</p>
    <v-alert v-if="error||settingsLoadError" type="error" role="alert" class="my-4">{{error||settingsLoadError}} <v-btn variant="text" :disabled="busy" @click="run(reload,'Settings reloaded.')">Reload user settings</v-btn></v-alert>
    <v-alert v-if="legacyTheme&&!appearanceDraft" type="info" class="my-4">This workspace has a legacy {{legacyTheme}} appearance preference. Import it into your user settings, or choose your own appearance below.<v-btn variant="outlined" class="mt-3" :disabled="busy||!settingsReady" @click="run(importLegacyAppearance,'Legacy appearance imported for this user.')">Import legacy appearance</v-btn></v-alert>
    <fieldset :disabled="busy||!settingsReady" class="settings-fieldset">
      <div class="form-grid"><v-select v-model="mode" :disabled="busy||!settingsReady" label="Appearance mode" :items="[{title:'System',value:'system'},{title:'Light',value:'light'},{title:'Dark',value:'dark'}]" /><v-select v-model="previewPalette" :disabled="busy||!settingsReady" label="Palette" :items="paletteChoices" /></div>
      <p role="status">Editing the {{previewMode}} palette. {{appearanceDraft?'Preview active — not yet saved.':'Saved appearance.'}}</p>
      <details class="settings-color-editor"><summary>Customize palette colors</summary>
        <div class="settings-color-grid"><div><v-select v-model="role" :disabled="busy||!settingsReady" label="Color role" :items="colorRoles.map(value=>({title:value.replaceAll('-',' '),value}))" />
        <label class="theme-preview-color">{{role.replaceAll('-',' ')}} color <input v-model="color" type="color" /></label><p>Custom colors need contrast review before adoption.</p></div>
        <v-color-picker v-model="color" :disabled="busy||!settingsReady" mode="hex" :modes="['hex']" :width="280" hide-inputs aria-label="Selected role color" /></div>
      </details>
      <div class="settings-actions"><v-btn variant="outlined" @click="resetPalette">Reset palette</v-btn><v-btn variant="text" @click="resetPreview">Restore Bench colors</v-btn><v-btn variant="outlined" :prepend-icon="mdiDownload" @click="download">Export themes</v-btn></div>
    </fieldset>
    <div class="settings-actions"><v-btn color="primary" :loading="busy" :disabled="busy||!settingsReady||!appearanceDirty" @click="run(applyAppearancePreview,'Appearance saved for this user.')">Apply appearance</v-btn><v-btn variant="outlined" :disabled="busy||!appearanceDraft" @click="cancelAppearancePreview();error='';notice=''">Cancel preview</v-btn></div>
    <p v-if="notice" role="status">{{notice}}</p>
  </section>
</template>
