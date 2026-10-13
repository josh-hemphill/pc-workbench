<script setup lang="ts">
import {computed} from 'vue';
import type {Configuration,Database,Placement,SffConnection,StorageBindings} from '../shared/types';
import {componentCapabilities} from '../shared/component-capabilities';
import {mapStorageBindings} from '../shared/storage-bindings';
const props=defineProps<{configuration:Configuration;db:Database;placement?:Placement}>();
const emit=defineEmits<{'update:bindings':[bindings:StorageBindings]}>();
const part=(id:string)=>props.db.components.find(component=>component.id===id);
const rows=computed(()=>props.placement?[props.placement]:props.configuration.placements);
const converters=computed(()=>rows.value.filter(row=>{const c=part(row.componentId);return c&&componentCapabilities(c).m2Converter;}));
const hasSffProviders=computed(()=>props.configuration.placements.some(p=>part(p.componentId)?.specs.sffPorts?.length));
const consumers=computed(()=>rows.value.filter(row=>{const c=part(row.componentId),provider=props.configuration.placements.find(p=>p.id===row.adapterPlacementId),target=provider&&part(provider.componentId)?.specs.driveTargets?.find(target=>target.id===row.targetId);return c&&(row.sffConnections?.length||c.specs.sffInputs?.length||!target?.sffInputId&&c.category==='Drive'&&c.specs.driveSize!=='M.2'&&(hasSffProviders.value||c.specs.driveInterface==='SAS'||c.specs.driveInterface==='NVMe'));}));
function keep(items:{title:string;value:string}[],value?:string){return value&&!items.some(item=>item.value===value)?[...items,{title:`${value} (recorded; unavailable)`,value}]:items;}
function publish(row:Placement){emit('update:bindings',mapStorageBindings(row));}
function providers(row:Placement,selected?:string){return keep([{title:'Select provider',value:''},...props.configuration.placements.filter(p=>p.id!==row.id&&part(p.componentId)?.specs.sffPorts?.length&&componentCapabilities(part(p.componentId)!).sffProvider).map(p=>({title:`${part(p.componentId)!.name} · ${p.id}`,value:p.id}))],selected);}
function ports(route:SffConnection){const provider=props.configuration.placements.find(p=>p.id===route.providerPlacementId);return keep([{title:'Select source port',value:''},...(provider?part(provider.componentId)?.specs.sffPorts||[]:[]).filter(port=>!port.disabled).map(port=>({title:`${port.id} · ${port.connector} · ${port.protocols?.join('/')||'protocol unknown'}`,value:port.id}))],route.portId);}
function inputs(row:Placement,selected?:string){const list=part(row.componentId)?.specs.sffInputs;return keep(list!==undefined?list.map(input=>({title:`${input.id} · ${input.connector}`,value:input.id})):[{title:'Direct drive input',value:''}],selected);}
function cables(selected?:string){return keep([{title:'Cable not recorded',value:''},...props.configuration.placements.filter(p=>part(p.componentId)?.category==='Cable').map(p=>({title:`${part(p.componentId)!.name} · ${p.id}`,value:p.id}))],selected);}
function add(row:Placement){const input=part(row.componentId)?.specs.sffInputs?.[0];(row.sffConnections??=[]).push({providerPlacementId:'',portId:'',inputId:input?.id||'',sourceChannel:1,channels:input?.channels||1,...(input?.pcieLanes?{pcieLanes:input.pcieLanes}:{})});publish(row);}
function numeric(row:Placement,route:SffConnection,key:'sourceChannel'|'channels'|'pcieLanes'|'cableChannel',value:unknown){if(value==null||value==='')delete route[key];else route[key]=Number(value);publish(row);}
function selectInput(row:Placement,route:SffConnection,value:string){route.inputId=value;const input=part(row.componentId)?.specs.sffInputs?.find(input=>input.id===value);route.channels=input?.channels||1;if(input?.pcieLanes)route.pcieLanes=input.pcieLanes;else delete route.pcieLanes;publish(row);}
function motherboardItems(row:Placement){return keep([{title:'Select motherboard',value:''},...props.configuration.placements.filter(p=>part(p.componentId)?.category==='Motherboard').map(p=>({title:`${part(p.componentId)!.name} · ${p.id}`,value:p.id}))],row.adapterPlacementId);}
function m2Items(row:Placement){const provider=props.configuration.placements.find(p=>p.id===row.adapterPlacementId);return keep([{title:'Select M.2 slot',value:''},...(provider?part(provider.componentId)?.specs.driveTargets||[]:[]).filter(target=>target.driveSizes?.includes('M.2')&&!target.disabled).map(target=>({title:`${target.id} · ${target.pcieLanes===undefined?'lanes unknown':'PCIe x'+target.pcieLanes}`,value:target.id}))],row.targetId);}
</script>
<template>
 <section v-if="(!placement&&converters.length)||consumers.length" class="control-stack mt-6">
  <h3>SFF connections &amp; M.2 conversion</h3><p class="form-hint">Bind each adapter to one motherboard M.2 slot. Wire downstream drives/backplanes to its SFF ports, or to a native SFF controller. A passive connector adapter does not convert storage protocols or create lanes.</p>
  <div v-for="row in (placement?[]:converters)" :key="row.id" class="panel pa-4 control-stack">
   <strong>{{part(row.componentId)?.name}} · M.2 upstream slot</strong>
   <div class="form-grid"><v-select v-model="row.adapterPlacementId" label="Upstream motherboard" :items="motherboardItems(row)" @update:model-value="row.targetId=''" /><v-select v-model="row.targetId" label="Occupied M.2 slot" :items="m2Items(row)" /></div>
   <p class="form-hint">This slot is occupied by the converter and cannot also hold a drive. Add the adapter and cable as individual BOM/stock items.</p>
  </div>
  <div v-for="row in consumers" :key="row.id" class="panel pa-4 control-stack">
   <div class="section-head"><strong>{{part(row.componentId)?.name}}</strong><v-btn variant="outlined" :disabled="row.quantity!==1||(row.sffConnections?.length||0)>=32" @click="add(row)">Add SFF data route</v-btn></div>
   <p v-if="row.quantity!==1" class="form-hint">Split this line into individual components before assigning physical ports.</p>
   <p v-if="!row.sffConnections?.length" class="form-hint">Use SFF routes for documented SAS/SATA/NVMe cabling. Ordinary SATA connections remain in the SATA section.</p>
   <div v-for="(route,index) in row.sffConnections" :key="index" class="control-stack">
    <div class="form-grid">
     <v-select :model-value="route.inputId||''" label="SFF consumer input" :items="inputs(row,route.inputId)" @update:model-value="v=>selectInput(row,route,v)" />
     <v-select v-model="route.providerPlacementId" label="SFF source provider" :items="providers(row,route.providerPlacementId)" @update:model-value="route.portId='';publish(row)" />
     <v-select v-model="route.portId" label="SFF source port" :items="ports(route)" @update:model-value="publish(row)" />
     <v-text-field :model-value="route.sourceChannel" label="First source device channel" type="number" min="1" max="32" @update:model-value="v=>numeric(row,route,'sourceChannel',v)" />
     <v-text-field :model-value="route.channels" label="Device channels consumed" type="number" min="1" max="32" @update:model-value="v=>numeric(row,route,'channels',v)" />
     <v-text-field :model-value="route.pcieLanes" label="PCIe lanes consumed (NVMe only)" type="number" min="1" max="32" @update:model-value="v=>numeric(row,route,'pcieLanes',v)" />
     <v-select v-model="route.cablePlacementId" label="SFF cable assembly" :items="cables(route.cablePlacementId)" @update:model-value="publish(row)" />
     <v-text-field :model-value="route.cableChannel" label="First cable device channel" type="number" min="1" max="32" @update:model-value="v=>numeric(row,route,'cableChannel',v)" />
    </div>
    <v-btn variant="text" color="error" @click="row.sffConnections?.splice(index,1);publish(row)">Remove SFF route</v-btn>
   </div>
  </div>
 </section>
</template>
