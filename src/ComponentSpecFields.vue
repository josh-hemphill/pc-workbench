<script setup lang="ts">
import type {Component,Database,Specs} from '../shared/types';
import type {componentFields} from '../shared/component-fields';
import {catalogSuggestions,normalizeCatalogValue,normalizeCatalogValues,catalogNumericValuesRule} from '../shared/catalog-options';
const props=defineProps<{component:Component;db:Database;fields:ReturnType<typeof componentFields>}>();
const suggestions=(key:string)=>catalogSuggestions(props.db,key);
function value(key:keyof Specs){const s=props.component.specs;if(key==='sataPorts'&&s.sataDataPorts!==undefined)return s.sataDataPorts.length;if(key==='sataPower'&&s.sataPowerConnectors!==undefined)return s.sataPowerConnectors.length;if(['usbA','usbC','ethernet'].includes(key)&&s.ports!==undefined)return s.ports.filter(port=>port.kind===({usbA:'USB-A',usbC:'USB-C',ethernet:'Ethernet'} as Record<string,string>)[key]).length;return s[key];}
function listValue(key:keyof Specs){const input=props.component.specs[key];return Array.isArray(input)?input.filter((entry):entry is string|number=>typeof entry==='string'||typeof entry==='number'):[];}
function textValue(key:keyof Specs){const input=value(key);return typeof input==='string'?input:undefined;}
function boolValue(key:keyof Specs){const input=value(key);return typeof input==='boolean'?input:null;}
function cpuCount(key:keyof Specs){return key==='coreCount'||key==='threadCount';}
const cpuCountRule=(v:unknown)=>v===null||v===undefined||v===''||Number.isInteger(Number(v))&&Number(v)>=1&&Number(v)<=10000||'Enter a whole number from 1 to 10000, or leave unknown.';
function named(key:keyof Specs){const s=props.component.specs;return key==='sataPorts'&&s.sataDataPorts!==undefined||key==='sataPower'&&s.sataPowerConnectors!==undefined||['usbA','usbC','ethernet'].includes(key)&&s.ports!==undefined;}
function set(key:keyof Specs,input:unknown,kind?:string){const s=props.component.specs as Record<string,unknown>;if(input===''||input==null){delete s[key];return;}if(kind==='list'){try{s[key]=normalizeCatalogValues(input,suggestions(key),{numeric:key==='m2Lengths'});}catch{s[key]=input;}}else s[key]=kind==='bool'?!!input:kind==='text'||kind==='select'?normalizeCatalogValue(input,suggestions(key)):Number(input);}
</script>
<template><div class="form-grid component-spec-fields"><template v-for="field in fields" :key="field.key">
 <v-combobox v-if="field.kind==='list'" :model-value="listValue(field.key)" :label="field.label" :items="suggestions(field.key)" :rules="field.key==='m2Lengths'?[catalogNumericValuesRule]:[]" multiple chips closable-chips clearable :return-object="false" :data-field="field.key" @update:model-value="v=>set(field.key,v,field.kind)" />
 <v-combobox v-else-if="['socket','formFactor','memoryType'].includes(field.key)" :model-value="textValue(field.key)" :label="field.label" :items="suggestions(field.key)" clearable :return-object="false" :data-field="field.key" @update:model-value="v=>set(field.key,v,field.kind)" />
 <v-select v-else-if="field.kind==='select'" :model-value="textValue(field.key)" :label="field.label" :items="field.items" clearable :data-field="field.key" @update:model-value="v=>set(field.key,v,field.kind)" />
 <v-select v-else-if="field.kind==='bool'" :model-value="boolValue(field.key)" :label="field.label" :items="field.key==='bifurcation'?[{title:'Unknown',value:null},{title:'Supported',value:true},{title:'Not supported',value:false}]:[{title:'Unknown',value:null},{title:'Yes',value:true},{title:'No',value:false}]" :data-field="field.key" @update:model-value="v=>set(field.key,v,'bool')" />
 <v-text-field v-else :model-value="value(field.key)" :label="field.label" :type="field.kind?'text':'number'" :min="field.kind?undefined:cpuCount(field.key)?1:0" :max="cpuCount(field.key)?10000:undefined" :step="cpuCount(field.key)?1:undefined" :rules="cpuCount(field.key)?[cpuCountRule]:[]" :clearable="cpuCount(field.key)" :disabled="named(field.key)" :hint="named(field.key)?'Determined by the complete named connector catalog.':cpuCount(field.key)?'Leave blank if unknown. Record each count independently; do not assume two threads per core.':undefined" :persistent-hint="named(field.key)" :data-field="field.key" @update:model-value="v=>set(field.key,v,field.kind)" />
</template></div></template>
