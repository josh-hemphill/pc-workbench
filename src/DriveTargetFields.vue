<script setup lang="ts">
import type {Component, Database, DriveTarget} from '../shared/types';
import {catalogSuggestions,normalizeCatalogValues,catalogNumericValuesRule} from '../shared/catalog-options';
const props=defineProps<{target:DriveTarget;component:Component;db:Database;readonlyId?:boolean}>();
const board=props.component.category==='Motherboard';
const suggestions=(key:string)=>catalogSuggestions(props.db,key);
function optional(key:keyof DriveTarget,value:unknown,numeric=false){const row=props.target as unknown as Record<string,unknown>;if(value==null||value==='')delete row[key];else row[key]=numeric?Number(value):value;}
function list(key:string,value:unknown,numeric=false){const row=props.target as unknown as Record<string,unknown>;try{row[key]=normalizeCatalogValues(value,suggestions(key),{numeric});}catch{row[key]=value;}}
function retained(items:{title:string;value:string}[],value?:string){return value&&!items.some(item=>item.value===value)?[...items,{title:`${value} (recorded; unavailable)`,value}]:items;}
</script>
<template>
 <template v-if="board&&!target.driveSizes?.includes('M.2')"><p class="form-hint">Confirm this is an M.2 slot before assigning a drive or converter.</p><v-btn variant="outlined" @click="target.driveSizes=['M.2'];target.mount='internal'">Declare this as an M.2 slot</v-btn></template>
 <div class="form-grid">
  <v-text-field v-model="target.id" :label="board?'M.2 slot ID':'Target ID'" :readonly="readonlyId" data-field="id" />
  <v-select v-if="!board" v-model="target.mount" label="Mount / access" :items="['auto','internal','front-hot-swap','rear-sled']" />
  <v-combobox v-if="!board" :model-value="target.driveSizes||[]" :items="suggestions('driveSizes')" label="Supported drive sizes" multiple chips closable-chips clearable :return-object="false" @update:model-value="v=>list('driveSizes',v)" />
  <v-combobox :model-value="target.interfaces||[]" :items="board?['NVMe','SATA']:['NVMe','SATA','SAS']" :label="board?'M.2 slot protocols':'Supported interfaces'" multiple chips closable-chips clearable :return-object="false" data-field="interfaces" @update:model-value="v=>list('interfaces',v)" />
  <v-combobox v-if="board||target.driveSizes?.includes('M.2')" :model-value="target.m2Lengths||[]" :items="suggestions('m2Lengths')" :rules="[catalogNumericValuesRule]" label="Supported M.2 lengths (mm)" multiple chips closable-chips clearable :return-object="false" data-field="m2Lengths" @update:model-value="v=>list('m2Lengths',v,true)" />
  <v-text-field v-if="board||target.interfaces?.includes('NVMe')" :model-value="target.pcieLanes" label="Electrical PCIe lanes" type="number" min="1" max="16" data-field="pcieLanes" @update:model-value="v=>optional('pcieLanes',v,true)" />
  <v-checkbox v-if="board" v-model="target.disabled" label="Slot disabled" />
  <v-select v-if="!board" :model-value="target.bayId||''" label="Physical bay alias" data-field="bayId" :items="retained([{title:'No alias',value:''},...(component.specs.bayTargets||[]).map(bay=>({title:bay.id,value:bay.id}))],target.bayId)" @update:model-value="v=>optional('bayId',v)" />
  <v-select v-if="!board" :model-value="target.hotSwap??null" label="Hot-swappable" :items="[{title:'Unknown',value:null},{title:'Yes',value:true},{title:'No',value:false}]" @update:model-value="v=>optional('hotSwap',v)" />
  <v-select :model-value="target.bootable??null" :label="board?'Slot supports boot':'Bootable target'" :items="[{title:'Unknown',value:null},{title:'Yes',value:true},{title:'No',value:false}]" @update:model-value="v=>optional('bootable',v)" />
  <v-select v-if="!board&&component.specs.sffInputs!==undefined" :model-value="target.sffInputId||''" label="Upstream SFF backplane input" :items="retained([{title:'Not recorded',value:''},...(component.specs.sffInputs||[]).map(input=>({title:input.id,value:input.id}))],target.sffInputId)" data-field="sffInputId" @update:model-value="v=>optional('sffInputId',v)" />
 </div>
</template>
