<script setup lang="ts">
import {computed,ref,nextTick} from 'vue';
import {mdiClose} from '@mdi/js';
import type {Specs,Database} from '../shared/types';
import {catalogSuggestions,normalizeCatalogValues} from '../shared/catalog-options';
const props=defineProps<{specs:Specs;db:Database;allowedKeys?:string[]}>();
type Key='supportedOS'|'requiredDriver'|'requiredFirmware';
const allFields:{key:Key;label:string}[]=[{key:'supportedOS',label:'Supported operating systems'},{key:'requiredDriver',label:'Required driver version'},{key:'requiredFirmware',label:'Required firmware version'}];
const fields=allFields.filter(field=>!props.allowedKeys||props.allowedKeys.includes(field.key));
const added=ref(new Set<Key>()),selection=ref<Key|null>(null);
const visible=computed(()=>fields.filter(f=>added.value.has(f.key)||(f.key==='supportedOS'?!!props.specs.supportedOS?.length:!!props.specs[f.key]?.trim())));
const choices=computed(()=>fields.filter(f=>!visible.value.includes(f)).map(f=>({title:f.label,value:f.key})));
async function add(key:Key|null){if(!key)return;added.value.add(key);await nextTick();selection.value=null;}
function remove(key:Key){delete props.specs[key];added.value.delete(key);}
function update(key:'requiredDriver'|'requiredFirmware',value:unknown){added.value.add(key);const text=String(value??'');if(text)props.specs[key]=text;else delete props.specs[key];}
function os(value:unknown){props.specs.supportedOS=normalizeCatalogValues(value,catalogSuggestions(props.db,'supportedOS'));added.value.add('supportedOS');}
</script>
<template><section class="control-stack"><v-select v-if="choices.length" v-model="selection" label="Add software or firmware requirement" :items="choices" clearable @update:model-value="add" /><div v-for="field in visible" :key="field.key" class="d-flex align-start ga-3"><v-combobox v-if="field.key==='supportedOS'" :model-value="specs.supportedOS||[]" :items="catalogSuggestions(db,'supportedOS')" :label="field.label" multiple chips closable-chips clearable :return-object="false" @update:model-value="os" /><v-text-field v-else :model-value="specs[field.key]" :label="field.label" clearable @update:model-value="v=>update(field.key as 'requiredDriver'|'requiredFirmware',v)" /><v-btn :icon="mdiClose" variant="text" :aria-label="`Remove ${field.label}`" @click="remove(field.key)" /></div></section></template>
