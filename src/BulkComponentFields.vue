<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {Component,Database} from '../shared/types';
import type {CatalogPatch} from '../shared/bulk-records';
import {commonComponentDraft,sharedComponentPaths,fullBulkEditor,changedComponentPaths,componentFieldValue,componentDraftValue,componentFieldLabel,collectionPath,sameValue,type ComponentFieldMode} from '../shared/component-bulk';
import ComponentDataEditor from './ComponentDataEditor.vue';
const props=defineProps<{ids:string[];db:Database;fillMissing?:boolean;view:'edit'|'changes'}>();
const emit=defineEmits<{'update:patch':[patch:CatalogPatch]}>();
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
// Capture the selection at opening. Reloading the workspace must not silently rebase edits.
const records=clone(props.db.components.filter(c=>props.ids.includes(c.id)));
const baseline=commonComponentDraft(records),draft=ref<Component>(clone(baseline));
const allowed=sharedComponentPaths(records),full=fullBulkEditor(records),editor=ref<InstanceType<typeof ComponentDataEditor>|null>(null);
const verification=ref<''|'verified'|'unverified'>('');
const defaultMode=ref<ComponentFieldMode>(props.fillMissing?'fill':'set');
const policies=ref<Record<string,{enabled:boolean;mode:ComponentFieldMode}>>({}),explicit=ref<string[]>([]),addPath=ref<string|null>(null);
const changed=computed(()=>changedComponentPaths(baseline,draft.value,allowed));
const paths=computed(()=>[...new Set([...changed.value,...explicit.value,...(verification.value?['verified']:[])])]);
const mixed=allowed.filter(path=>!records.every(c=>sameValue(componentFieldValue(c,path),componentFieldValue(records[0],path))));
const mixedLabels=mixed.map(path=>componentFieldLabel(path,baseline));
function policy(path:string){return policies.value[path]||{enabled:true,mode:componentDraftValue(draft.value,path)===undefined?'clear':collectionPath(path)?'merge':path==='verified'?'set':defaultMode.value};}
function changePolicy(path:string,patch:Partial<{enabled:boolean;mode:ComponentFieldMode}>){policies.value[path]={...policy(path),...patch};}
function modeOptions(path:string){if(path==='verified')return [{title:'Replace value',value:'set'}];return [{title:'Replace value',value:'set'},{title:'Fill missing only',value:'fill'},...(collectionPath(path)?[{title:'Merge records by ID',value:'merge'}]:[]),{title:'Clear value',value:'clear'}];}
function addField(){if(!addPath.value)return;explicit.value=[...new Set([...explicit.value,addPath.value])];changePolicy(addPath.value,{enabled:true});addPath.value=null;}
watch(verification,value=>{draft.value.verified=value==='verified';if(value)changePolicy('verified',{enabled:true,mode:'set'});else{explicit.value=explicit.value.filter(path=>path!=='verified');delete policies.value.verified;draft.value.verified=baseline.verified;}});
function valueSummary(value:unknown,path?:string){if(path==='verified')return value?'Verified':'Needs verification';if(value===undefined)return 'Unknown';if(Array.isArray(value))return `${value.length} entries`;const text=String(value);return text.length>120?text.slice(0,120)+'…':text;}
const patch=computed<CatalogPatch>(()=>{const fields=paths.value.filter(path=>policy(path).enabled&&(path!=='verified'||!!verification.value)).map(path=>{const mode=policy(path).mode,value=componentDraftValue(draft.value,path);return {path,mode,...(mode!=='clear'&&value!==undefined?{value:clone(value)}:{})};});return fields.length?{fields}:{};});
watch(patch,value=>emit('update:patch',value),{immediate:true,deep:true,flush:'post'});
function prepare(){return editor.value?.canChangeSection()??true;}
defineExpose({prepare,hasPendingChanges:()=>!!editor.value?.hasPendingChanges()});
</script>
<template>
<div class="control-stack">
 <div v-show="view==='edit'" class="control-stack">
 <p>Use the same fields and sections as individual editing. Only fields in Pending changes apply to the group. Names, IDs and categories stay individual.</p>
 <v-alert v-if="!full" type="info" variant="tonal">This selection spans different categories or hardware roles. The shared subset is shown below; select a matching category and role for the full editor.</v-alert>
 <v-alert v-if="mixed.length" type="info" variant="tonal"><strong>Mixed values are left blank.</strong> {{mixedLabels.join(', ')}}. Editing a blank field proposes a group change; it does not copy values from the first component.</v-alert>
 <v-select v-model="defaultMode" label="Default action for scalar changes" :items="[{title:'Fill missing values only',value:'fill'},{title:'Replace selected values',value:'set'}]" hint="Named lists default to merging by ID. Set each field’s action in Choose changes." persistent-hint />
 <v-select v-model="verification" label="Verification status" :items="[{title:'Keep existing status',value:''},{title:'Mark all verified',value:'verified'},{title:'Mark all needing verification',value:'unverified'}]" hint="An explicit choice applies to the group, including components whose specifications you edit. Otherwise specification changes require verification." persistent-hint />
 <ComponentDataEditor ref="editor" :component="draft" :db="db" bulk :mixed-keys="mixed.filter(path=>path.startsWith('specs.')).map(path=>path.slice(6))" :allowed-spec-keys="full?undefined:allowed.filter(path=>path.startsWith('specs.')).map(path=>path.slice(6))" />

 </div>
 <section v-show="view==='changes'" class="control-stack bulk-field-changes" aria-label="Pending component changes"><h3>Pending changes ({{patch.fields?.length||0}} fields)</h3><p>Untouched fields stay unchanged. Clear removes an optional specification or resets metadata. Fill preserves known zero, false and explicitly empty connector lists. Merge updates matching IDs and adds new IDs while preserving other records. Replace uses the complete list; referenced records cannot be removed. When naming count-only inventories, merge must cover the recorded capacity. Specification changes require verification unless you explicitly choose a verification status.</p>
 <div class="form-grid"><v-autocomplete v-model="addPath" label="Include a field explicitly" :items="allowed.map(path=>({title:componentFieldLabel(path,baseline),value:path}))" clearable /><v-btn variant="outlined" :disabled="!addPath" @click="addField">Include field</v-btn></div>
 <p v-if="!paths.length">Go back to Edit to change values, or include a field explicitly to clear a mixed value.</p>
 <div v-for="path in paths" :key="path" class="panel control-stack pa-4"><div class="form-grid"><v-checkbox :model-value="policy(path).enabled" :label="`Apply ${componentFieldLabel(path,baseline)}`" hide-details @update:model-value="v=>changePolicy(path,{enabled:!!v})" /><v-select v-if="path==='verified'" v-model="verification" label="New verification status" :items="[{title:'Verified',value:'verified'},{title:'Needs verification',value:'unverified'}]" :disabled="!policy(path).enabled" :rules="[value=>view!=='changes'||!policy(path).enabled||!!value||'Choose a verification status.']" hint="Choose the status to apply to every selected component." persistent-hint /><v-select v-else :model-value="policy(path).mode" :label="`Action for ${componentFieldLabel(path,baseline)}`" :items="modeOptions(path)" :disabled="!policy(path).enabled" @update:model-value="v=>changePolicy(path,{mode:v})" /></div><p>{{mixed.includes(path)?'Current values vary':`Current: ${valueSummary(componentDraftValue(baseline,path),path)}`}} → {{path==='verified'&&!verification?'Choose a status':policy(path).mode==='clear'?'Clear':valueSummary(componentDraftValue(draft,path),path)}}</p></div>
 </section>
</div>
</template>
