<script setup lang="ts">
import { computed } from 'vue';
import type { Component, Configuration, Database, Placement } from '../shared/types';
import { componentCapabilities } from '../shared/component-capabilities';
const props=defineProps<{component?:Component;configuration?:Configuration;db:Database}>();
const sizes=['2.5','3.5','5.25'];
const capabilities=computed(()=>props.component?componentCapabilities(props.component):undefined);
const part=(id:string)=>props.db.components.find(c=>c.id===id);
function optional(object:object,key:string,value:unknown,numeric=false){const row=object as Record<string,unknown>;if(value===null||value===undefined||value==='')delete row[key];else row[key]=numeric?Number(value):value;}
function addBay(){if(!props.component||!capabilities.value?.bayProvider)return;const bays=props.component.specs.bayTargets??=[];let n=1;while(bays.some(b=>b.id===`BAY_${n}`))n++;bays.push({id:`BAY_${n}`,size:'5.25'});}
function replacePreset(cage=false){const spec=props.component?.specs;return !spec?.bayTargets?.length&&!spec?.driveTargets?.length&&!spec?.sataDataInputs?.length&&!spec?.sataPowerInputs?.length||window.confirm(cage?'Replace drive targets and SATA inputs with an unverified cage example? Existing configurations may need their bindings updated. Other retained specifications will be preserved.':'Replace physical mounting bays with an unverified two-bay example? Existing drive targets and configurations may need their bay bindings updated.');}
function chassisPreset(){if(!props.component||!replacePreset())return;props.component.specs.bays525=2;props.component.specs.bayTargets=[1,2].map(position=>({id:`OPTICAL_${position}`,size:'5.25',group:'Front optical bank',position}));props.component.verified=false;}
function cagePreset(size:'2.5'|'3.5',count:number){
 if(!props.component||!replacePreset(true))return;
 const specs=props.component.specs;specs.storageAdapterKind='bay-cage';specs.baySize='5.25';specs.bayUnits=size==='2.5'?1:2;
 specs.sataDataInputs=Array.from({length:count},(_,i)=>({id:`DATA_${i+1}`}));specs.sataPowerInputs=[{id:'POWER_1'}];specs.sataPowerPlugs=1;
 specs.driveTargets=Array.from({length:count},(_,i)=>({id:`DRIVE_${i+1}`,mount:'front-hot-swap',driveSizes:[size],interfaces:['SATA'],sataDataInputId:`DATA_${i+1}`,sataPowerInputId:'POWER_1'}));
 props.component.verified=false;
}
function rawProvider(p:Placement){return p.adapterPlacementId?props.configuration?.placements.find(row=>row.id===p.adapterPlacementId):undefined;}
function controllerMount(p:Placement){const provider=rawProvider(p);return part(p.componentId)?.category==='Drive'&&provider&&part(provider.componentId)&&componentCapabilities(part(provider.componentId)!).adapter==='controller';}
function selectedProvider(p:Placement){return p.adapterPlacementId&&!controllerMount(p)?rawProvider(p):props.configuration?.placements.find(row=>part(row.componentId)?.category==='Chassis');}
function providerValue(p:Placement){return controllerMount(p)?'':p.adapterPlacementId||'';}
function providers(p:Placement){const items=[{title:'Automatic chassis',value:''},...(props.configuration?.placements.filter(row=>row.id!==p.id&&part(row.componentId)&&componentCapabilities(part(row.componentId)!).bayProvider).map((row,index)=>({title:`${part(row.componentId)?.name}${row.quantity!==1?` × ${row.quantity} (split into individual placements)`: ` · placement ${index+1}`}`,value:row.id,props:{disabled:row.quantity!==1}}))||[])];const selected=providerValue(p);if(selected&&!items.some(item=>item.value===selected))items.push({title:`${part(rawProvider(p)?.componentId||'')?.name||'Previous provider'} (recorded; unavailable)`,value:selected});return items;}
function targets(p:Placement){const provider=selectedProvider(p);const items=(provider?part(provider.componentId)?.specs.bayTargets||[]:[]).map(b=>({title:`${b.id} · ${b.size} inch${b.group?` · ${b.group}`:''}${b.position!==undefined?` / position ${b.position}`:''}`,value:b.id}));for(const id of occupied(p))if(!items.some(item=>item.value===id))items.push({title:`${id} (recorded; unavailable)`,value:id});return items;}
function occupied(p:Placement){if(p.bayTargetIds!==undefined)return p.bayTargetIds;const c=part(p.componentId);if(c?.category==='Drive'){const provider=selectedProvider(p);const target=provider&&part(provider.componentId)?.specs.driveTargets?.find(t=>t.id===p.targetId);return target?.bayId?[target.bayId]:provider&&part(provider.componentId)?.specs.bayTargets?.some(b=>b.id===p.targetId)?[p.targetId!]:[];}return p.targetId?[p.targetId]:[];}
function catalogBays(selected?:string){const items=(props.component?.specs.bayTargets||[]).map(b=>({title:`${b.id} · ${b.size} inch`,value:b.id}));if(selected&&!items.some(item=>item.value===selected))items.push({title:`${selected} (recorded; unavailable)`,value:selected});return items;}
function setOccupied(p:Placement,value:string[]){if(value.length)p.bayTargetIds=value;else delete p.bayTargetIds;if(part(p.componentId)?.category!=='Drive')p.targetId=value[0]||'';}
function isPhysicalConsumer(p:Placement){const c=part(p.componentId);if(!c)return false;if(componentCapabilities(c).bayConsumer)return true;if(c.category!=='Drive'||c.specs.driveSize==='M.2'||p.mount==='rear-sled')return false;const provider=selectedProvider(p);return !provider||!!part(provider.componentId)&&componentCapabilities(part(provider.componentId)!).bayProvider;}
function changeProvider(p:Placement,value:string|null){delete p.bayTargetIds;if(!value&&controllerMount(p))return;p.adapterPlacementId=value||'';p.targetId='';}
</script>
<template>
 <section v-if="component&&(capabilities?.bayConsumer||capabilities?.bayProvider)" class="mt-6">
  <h3>Physical bay topology</h3><p class="form-hint">Mounting bays describe chassis space. Drive targets describe individual service positions. Map a direct drive target to a physical bay to avoid counting the same space twice.</p>
  <div v-if="component.category==='Chassis'" class="heading-actions mb-4"><v-btn variant="outlined" size="small" @click="chassisPreset">Example: two optical bays</v-btn></div>
  <div v-if="capabilities?.adapter==='bay-cage'" class="heading-actions mb-4"><v-btn variant="outlined" size="small" @click="cagePreset('2.5',2)">Example: dual 2.5-inch cage</v-btn><v-btn variant="outlined" size="small" @click="cagePreset('3.5',2)">Example: dual 3.5-inch cage</v-btn><v-btn variant="outlined" size="small" @click="cagePreset('3.5',3)">Example: triple 3.5-inch cage</v-btn></div>
  <p v-if="component.category==='Storage adapter'||component.category==='Chassis'" class="form-hint">Examples mark specifications unverified. Confirm vendor bay consumption, dimensions, data and power inputs, and hot-swap support before approving the configuration.</p>
  <div v-if="capabilities?.bayConsumer" class="form-grid">
   <v-select :model-value="component.specs.baySize" @update:model-value="v=>optional(component!.specs,'baySize',v)" label="Required mounting bay size (inches)" :items="sizes" clearable />
   <v-text-field :model-value="component.specs.bayUnits" @update:model-value="v=>optional(component!.specs,'bayUnits',v,true)" label="Mounting bays consumed per unit (default 1)" type="number" min="1" />
   <v-text-field :model-value="component.specs.lengthMm" @update:model-value="v=>optional(component!.specs,'lengthMm',v,true)" label="Device mounting depth (mm)" type="number" min="0" />
  </div>
  <template v-if="capabilities?.bayProvider">
   <div class="spec-heading"><h3>Physical mounting bays</h3><v-btn size="small" @click="addBay">Add mounting bay</v-btn></div>
   <p class="form-hint">Use the same group and consecutive positions for adjacent bays. Leave topology or depth blank when undocumented; it will require review.</p>
   <div v-for="(bay,i) in component.specs.bayTargets" :key="i" class="panel pa-4 mb-3"><div class="form-grid"><v-text-field v-model="bay.id" label="Mounting bay ID" required aria-required="true" /><v-select v-model="bay.size" label="Mounting bay size (inches)" :items="sizes" /><v-text-field :model-value="bay.group" label="Bay bank / adjacency group" @update:model-value="v=>optional(bay,'group',v)" /><v-text-field :model-value="bay.position" label="Position within bank" type="number" min="1" @update:model-value="v=>optional(bay,'position',v,true)" /><v-text-field :model-value="bay.maxDepthMm" label="Available device depth (mm)" type="number" min="0" @update:model-value="v=>optional(bay,'maxDepthMm',v,true)" /></div><v-btn size="small" color="error" variant="text" :aria-label="`Remove mounting bay ${bay.id||i+1}`" @click="component.specs.bayTargets?.splice(i,1)">Remove mounting bay</v-btn></div>
   <div v-for="target in component.specs.driveTargets" :key="target.id" class="form-grid mb-3"><v-select :model-value="target.bayId" :label="`Physical bay for drive target ${target.id}`" :items="catalogBays(target.bayId)" clearable hint="Only direct drive positions sharing a physical mounting bay need this alias." persistent-hint @update:model-value="v=>optional(target,'bayId',v)" /></div>
  </template>
 </section>
 <section v-if="configuration" class="mt-6"><h3>Occupied mounting bays</h3><p class="form-hint">Select every physical space occupied by each cage, accessory or direct drive. Multi-bay devices must occupy adjacent positions in the same bank. Their downstream drives bind separately to individual drive targets.</p>
  <div v-for="p in configuration.placements.filter(isPhysicalConsumer)" :key="p.id" class="panel pa-4 mb-3"><strong>{{part(p.componentId)?.name}} × {{p.quantity}}</strong><p class="form-hint">Requires {{(part(p.componentId)?.specs.bayUnits??1)*p.quantity}} physical bay(s).</p><div class="form-grid mt-3"><v-select :model-value="providerValue(p)" label="Mounting bay provider" :items="providers(p)" @update:model-value="v=>changeProvider(p,v)" /><v-select :model-value="occupied(p)" label="All occupied physical bays" :items="targets(p)" multiple chips closable-chips clearable @update:model-value="v=>setOccupied(p,v)" /></div></div>
 </section>
</template>
