<script setup lang="ts">
import {useErrorFeedback} from './form-feedback';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import AppearanceSettings from './AppearanceSettings.vue';
import { appearanceDirty, cancelAppearancePreview, cloneSettings, settingsRequest } from './appearance';
import type { AppSettings, AppSettingsSnapshot } from '../shared/settings';

interface StoragePreview { value:AppSettings;exists:boolean;hasDatabase:boolean;hasLegacyCsv:boolean;lockPresent:boolean }
const appearance=ref<{hasUnsavedChanges:()=>boolean;isBusy:()=>boolean}|null>(null);
const snapshot=ref<AppSettingsSnapshot|null>(null),draft=ref<AppSettings|null>(null),preview=ref<StoragePreview|null>(null);
const busy=ref(false),loading=ref(true),error=ref(''),notice=ref('');
const appDirty=computed(()=>!!draft.value&&!!snapshot.value&&JSON.stringify(draft.value)!==JSON.stringify(snapshot.value.value));
watch(draft,()=>{preview.value=null;notice.value='';},{deep:true,flush:'sync'});
async function reload() {
  if(appDirty.value&&!window.confirm('Discard unsaved app settings and reload?'))return;
  loading.value=true;error.value='';
  try{snapshot.value=await settingsRequest<AppSettingsSnapshot>('/api/settings/app');draft.value=cloneSettings(snapshot.value.value);}
  catch(e){error.value=e instanceof Error?e.message:String(e);}finally{loading.value=false;}
}
async function validate() {
  busy.value=true;error.value='';preview.value=null;
  try{preview.value=await settingsRequest<StoragePreview>('/api/settings/app/preview',{method:'POST',body:JSON.stringify(draft.value)});}
  catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
async function save() {
  if(!snapshot.value||!preview.value)return;
  busy.value=true;error.value='';
  try{
    snapshot.value=await settingsRequest<AppSettingsSnapshot>('/api/settings/app',{method:'PUT',headers:{'If-Match':snapshot.value.revision},body:JSON.stringify(preview.value.value)});
    draft.value=cloneSettings(snapshot.value.value);preview.value=null;
    notice.value=snapshot.value.restartRequired?'App settings saved. Restart the application to use the new configuration.':'App settings saved. Environment overrides still determine any overridden values.';
  }catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;}
}
function hasUnsavedChanges(){return busy.value||appDirty.value||appearanceDirty.value||!!appearance.value?.hasUnsavedChanges();}
function confirmDiscard(){
  if(busy.value||appearance.value?.isBusy())return false;
  if(hasUnsavedChanges()&&!window.confirm('Discard unsaved settings and appearance previews?'))return false;
  cancelAppearancePreview();return true;
}
defineExpose({hasUnsavedChanges,confirmDiscard});
onMounted(reload);
onBeforeUnmount(cancelAppearancePreview);
useErrorFeedback(error);
</script>

<template>
  <div class="settings-workspace">
    <div class="page-heading"><div><div class="eyebrow">YOUR WORKSPACE. YOUR PREFERENCES.</div><h1>Settings</h1><p>Keep portable workspace data separate from your user preferences and local app configuration.</p></div></div>
    <AppearanceSettings ref="appearance" />
    <section class="panel settings-section" aria-labelledby="app-settings-title" :aria-busy="loading||busy">
      <h2 id="app-settings-title">App settings · Storage & runtime</h2>
      <p>These paths and the server port belong to your OS user. They are excluded from workspace backups.</p>
      <p v-if="loading" role="status">Loading app settings…</p>
      <v-alert v-if="error" type="error" role="alert" class="my-4">{{error}}</v-alert>
      <v-btn variant="text" :disabled="busy||loading" @click="reload">Reload app settings</v-btn>
      <template v-if="snapshot&&draft">
        <dl class="settings-locations">
          <dt>Active workspace directory</dt><dd>{{snapshot.effective.dataDir}} <span v-if="snapshot.overrides.dataDir">(BENCH_DATA_DIR override)</span></dd>
          <dt>User preferences file</dt><dd>{{snapshot.locations.userSettingsFile}} <span v-if="snapshot.overrides.userSettingsFile">(BENCH_USER_SETTINGS_FILE override)</span></dd>
          <dt>Local app configuration file</dt><dd>{{snapshot.locations.configFile}} <span v-if="snapshot.overrides.configFile">(BENCH_CONFIG_FILE override)</span></dd>
          <dt>Desktop cache directory</dt><dd>{{snapshot.locations.cacheDir}} <span v-if="snapshot.overrides.cacheDir">(environment override)</span></dd>
          <dt>Active API port</dt><dd>{{snapshot.effective.port}} <span v-if="snapshot.overrides.port">(PORT override)</span></dd>
        </dl>
        <p>Windows desktop WebView uses the cache directory above. In ordinary browsers and other desktop platforms, browser storage follows the browser/OS profile.</p>
        <v-alert v-if="snapshot.restartRequired" type="info" class="my-4" role="status">A restart is pending. Next workspace: {{snapshot.nextLaunch.dataDir}} · API port: {{snapshot.nextLaunch.port}}.</v-alert>
        <fieldset :disabled="busy||loading" class="settings-fieldset">
          <v-text-field v-model="draft.dataDir" label="Workspace directory for next launch" hint="Enter an absolute path. Saving selects a workspace; it does not move or merge data." persistent-hint />
          <v-text-field v-model.number="draft.port" label="API port for next launch" type="number" min="1" max="65535" class="mt-5" />
        </fieldset>
        <p v-if="snapshot.overrides.dataDir||snapshot.overrides.port">Environment overrides take precedence over saved settings. Remove BENCH_DATA_DIR or PORT from the launch environment to use their saved values.</p>
        <div class="settings-actions"><v-btn variant="outlined" :disabled="!appDirty||busy||loading" :loading="busy" @click="validate">Validate & preview</v-btn><v-btn variant="text" :disabled="!appDirty||busy" @click="draft=cloneSettings(snapshot.value);error=''">Cancel app changes</v-btn></div>
        <v-alert v-if="preview" type="info" class="my-4" role="status">
          <p>Next saved workspace: {{preview.value.dataDir}} · API port: {{preview.value.port}}.</p>
          <p>{{preview.hasDatabase?'An existing workspace database was found.':preview.hasLegacyCsv?'Legacy CSV data was found and will be validated during startup migration.':'No workspace database was found. Startup will initialize a workspace with illustrative sample catalogs.'}}</p>
          <p v-if="preview.lockPresent">A workspace lock is present. Close any other instance using that directory before launching it here.</p>
          <p>The current workspace stays open until restart. Its records will not be copied, merged, or deleted.</p>
          <v-btn color="primary" :disabled="busy" @click="save">Save for next launch</v-btn>
        </v-alert>
        <p v-if="notice" role="status">{{notice}}</p>
      </template>
    </section>
    <section class="panel settings-section" aria-labelledby="portable-data-title"><h2 id="portable-data-title">Portable workspace data</h2>
      <p>Use Data & imports to export a workspace backup. Select a destination here, restart, then validate and restore that backup in Data & imports.</p>
      <p>For a directory copy, stop the app first and copy the entire workspace directory, including its recovery backups. Keep an independent backup. A live SQLite file must not be copied on its own.</p>
      <p>Appearance, local paths, ports, and browser caches stay with the OS user.</p>
    </section>
  </div>
</template>
