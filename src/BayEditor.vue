<script setup lang="ts">
import type { Component, Configuration, Database, Specs, Placement } from '../shared/types';
const props=defineProps<{component?:Component;configuration?:Configuration;db:Database}>();
const sizes=['2.5','3.5','5.25'];
const part=(id:string)=>props.db.components.find(c=>c.id===id);
function optional(key:keyof Specs,value:unknown,numeric=false){if(!props.component)return;const specs=props.component.specs as Record<string,unknown>;if(value===null||value===undefined||value==='')delete specs[key];else specs[key]=numeric?Number(value):value;}
function addBay(){if(!props.component)return;const bays=props.component.specs.bayTargets??=[];let n=1;while(bays.some(b=>b.id===`BAY_${n}`))n++;bays.push({id:`BAY_${n}`,size:'5.25'});}
function providers(p:Placement){return [{title:'Automatic chassis',value:''},...(props.configuration?.placements.filter(row=>row.id!==p.id&&(part(row.componentId)?.category==='Chassis'||part(row.componentId)?.specs.bayTargets)).map(row=>({title:`${part(row.componentId)?.name} · ${row.id}`,value:row.id}))||[])];}
function targets(p:Placement){const provider=p.adapterPlacementId?props.configuration?.placements.find(row=>row.id===p.adapterPlacementId):props.configuration?.placements.find(row=>part(row.componentId)?.category==='Chassis');return [{title:'Unassigned bay',value:''},...(provider?part(provider.componentId)?.specs.bayTargets||[]:[]).map(b=>({title:`${b.id} · ${b.size} inch`,value:b.id}))];}
</script>
<template>
 <section v-if="component" class="mt-6">
  <h3>Bay space & adapters</h3><p class="form-hint">A cage or accessory consumes chassis bay space. A cage provides separate drive targets in the section above. SATA data connections are counted for installed drives; an empty passive cage adds no data demand.</p>
  <div v-if="component.category!=='Chassis'" class="form-grid">
   <v-select :model-value="component.specs.baySize" @update:model-value="v=>optional('baySize',v)" label="Required mounting bay size (inches)" :items="sizes" clearable />
   <v-text-field :model-value="component.specs.bayUnits" @update:model-value="v=>optional('bayUnits',v,true)" label="Mounting bays consumed per unit (default 1)" type="number" min="1" />
   <v-text-field :model-value="component.specs.sataPowerPlugs" @update:model-value="v=>optional('sataPowerPlugs',v,true)" label="SATA power plugs consumed per unit" type="number" min="0" />
  </div>
  <p v-if="component.category!=='Chassis'" class="form-hint">Record the cage's actual power connectors: a known cage count replaces separate plugs for its bound SATA drives. Leave blank if unknown. Use Bay accessory for a speaker or other device that supplies no drive bays. Bay-mounted storage adapters need a slot bus only if they also occupy an expansion slot.</p>
  <div class="spec-heading"><h3>Physical mounting bays</h3><v-btn size="small" @click="addBay">Add mounting bay</v-btn></div><p class="form-hint">Declare individual chassis mounting spaces, such as a 5.25-inch external bay. Drive targets describe drive positions; do not record the same space twice as an independent mounting bay and drive target.</p>
  <div v-for="(bay,i) in component.specs.bayTargets" :key="i" class="panel pa-4 mb-3"><div class="form-grid"><v-text-field v-model="bay.id" label="Mounting bay ID" required aria-required="true" /><v-select v-model="bay.size" label="Mounting bay size (inches)" :items="sizes" /></div><v-btn size="small" color="error" variant="text" :aria-label="`Remove mounting bay ${bay.id||i+1}`" @click="component.specs.bayTargets?.splice(i,1)">Remove mounting bay</v-btn></div>
 </section>
 <section v-if="configuration" class="mt-6"><h3>Adapter & accessory bay bindings</h3><p class="form-hint">Bind each cage or accessory to its physical mounting bay. Split quantities into individual placements before assigning specific bays. Bind drives separately to the cage's drive targets. For a device spanning several bays, also verify the remaining occupied spaces and adjacency.</p>
  <div v-for="p in configuration.placements.filter(row=>part(row.componentId)?.specs.baySize&&part(row.componentId)?.category!=='Drive')" :key="p.id" class="panel pa-4 mb-3"><strong>{{part(p.componentId)?.name}} × {{p.quantity}}</strong><div class="form-grid mt-3"><v-select v-model="p.adapterPlacementId" label="Mounting bay provider" :items="providers(p)" @update:model-value="p.targetId=''" /><v-select v-model="p.targetId" label="Physical mounting bay" :items="targets(p)" /></div></div>
 </section>
</template>
