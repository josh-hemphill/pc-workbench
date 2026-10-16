<script setup lang="ts">
import {computed,ref,nextTick} from 'vue';
import {mdiClose} from '@mdi/js';
import type { SoftwareSettings, Component } from '../shared/types';
const props=defineProps<{software:SoftwareSettings;components?:Component[]}>();
type Scalar='os'|'image'|'equipmentSoftware'|'equipmentConfiguration'|'bios';
type Detail={id:string;label:string;scalar?:Scalar;kind?:'drivers'|'firmware';componentId?:string};
const added=ref(new Set<string>()),selection=ref<string|null>(null);
const details=computed<Detail[]>(()=>{
 const fields:Detail[]=([['os','Operating system'],['image','OS image identifier / checksum'],['equipmentSoftware','Equipment application version'],['equipmentConfiguration','Equipment configuration revision'],['bios','BIOS / UEFI version']] as [Scalar,string][]).map(([scalar,label])=>({id:scalar,scalar,label}));
 const ids=new Set([...(props.components||[]).map(c=>c.id),...Object.keys(props.software.drivers||{}),...Object.keys(props.software.firmware||{})]);
 for(const id of ids)for(const kind of ['drivers','firmware'] as const)fields.push({id:JSON.stringify([kind,id]),kind,componentId:id,label:`${props.components?.find(c=>c.id===id)?.name||id} ${kind==='drivers'?'driver':'firmware'} version`});
 return fields;
});
function value(detail:Detail){return detail.scalar?props.software[detail.scalar]:props.software[detail.kind!]?.[detail.componentId!];}
const visible=computed(()=>details.value.filter(d=>added.value.has(d.id)||!!value(d)?.trim()));
const choices=computed(()=>details.value.filter(d=>!visible.value.some(v=>v.id===d.id)).map(d=>({title:d.label,value:d.id})));
async function add(id:string|null){if(!id)return;added.value.add(id);await nextTick();selection.value=null;}
function update(detail:Detail,input:unknown){const text=String(input??'');if(detail.scalar){if(text)props.software[detail.scalar]=text;else delete props.software[detail.scalar];}else{if(text)(props.software[detail.kind!]??={})[detail.componentId!]=text;else delete props.software[detail.kind!]?.[detail.componentId!];}added.value.add(detail.id);}
function remove(detail:Detail){update(detail,'');added.value.delete(detail.id);if(detail.kind&&Object.keys(props.software[detail.kind]||{}).length===0)delete props.software[detail.kind];}
</script>
<template><section class="my-5 control-stack"><h3>Software & firmware</h3><v-autocomplete v-if="choices.length" v-model="selection" label="Add software or firmware detail" :items="choices" clearable @update:model-value="add" /><div v-for="detail in visible" :key="detail.id" class="d-flex align-start ga-3"><v-text-field :model-value="value(detail)" :label="detail.label" clearable @update:model-value="v=>update(detail,v)" /><v-btn :icon="mdiClose" variant="text" :aria-label="`Remove ${detail.label}`" @click="remove(detail)" /></div></section></template>
