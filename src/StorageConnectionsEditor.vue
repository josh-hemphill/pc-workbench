<script setup lang="ts">
import { computed } from 'vue';
import type { Component, Configuration, Database, Placement, Specs, StorageBindings } from '../shared/types';
import { componentCapabilities } from '../shared/component-capabilities';
import { mapStorageBindings } from '../shared/storage-bindings';

const props = defineProps<{ component?: Component; configuration?: Configuration; placement?: Placement; db: Database }>();
const emit = defineEmits<{ 'update:bindings': [bindings: StorageBindings] }>();
const part = (id: string) => props.db.components.find(component => component.id === id);
const capabilities = computed(() => props.component && componentCapabilities(props.component));
const cageInputs = computed(() => capabilities.value?.adapter === 'bay-cage');
const powerInputs = computed(() => cageInputs.value || props.component?.category === 'Bay accessory' || props.component?.category === 'Storage adapter'&&(props.component.specs.sataPowerInputs!==undefined||props.component.specs.sataPowerPlugs!==undefined));
const hasComponentFields = computed(() => capabilities.value?.sataController || props.component?.category === 'PSU' || cageInputs.value || powerInputs.value);
const placements = computed(() => props.placement ? [props.placement] : props.configuration?.placements || []);
const providers = computed(() => props.configuration?.placements || []);
const consumers = computed(() => placements.value.filter(placement => {
  const component = part(placement.componentId);
  return component && (component.category === 'Drive' && component.specs.driveInterface === 'SATA' || component.specs.sataDataInputs?.length || powerDemand(placement) > 0 || placement.sataDataConnections?.length || placement.sataPowerConnections?.length);
}));
const nextId = (prefix: string, rows: { id: string }[]) => { let n = 1; while (rows.some(row => row.id === `${prefix}_${n}`)) n++; return `${prefix}_${n}`; };
function syncCounts() {
  if (!props.component) return;
  const specs = props.component.specs;
  if (specs.sataDataPorts !== undefined) specs.sataPorts = specs.sataDataPorts.length;
  if (specs.sataPowerConnectors !== undefined) specs.sataPower = specs.sataPowerConnectors.length;
  if (specs.sataPowerInputs !== undefined) specs.sataPowerPlugs = specs.sataPowerInputs.length;
}
function addEndpoint(key: 'sataDataPorts' | 'sataPowerConnectors' | 'sataDataInputs' | 'sataPowerInputs') {
  if (!props.component) return;
  const rows = props.component.specs[key] ??= [];
  const prefix = key === 'sataDataPorts' ? 'SATA' : key === 'sataPowerConnectors' ? 'PLUG' : key === 'sataDataInputs' ? 'DATA' : 'POWER';
  rows.push({ id: nextId(prefix, rows) }); syncCounts();
}
function generateEndpoints(key: 'sataDataPorts' | 'sataPowerConnectors' | 'sataPowerInputs', count: number | undefined) {
  if (!props.component || count === undefined) return;
  if (props.component.specs[key]?.length && !window.confirm('Replace the named connector list? Existing wiring references may need updating.')) return;
  const prefix = key === 'sataDataPorts' ? 'SATA' : key === 'sataPowerConnectors' ? 'PLUG' : 'POWER';
  props.component.specs[key] = Array.from({ length: Math.min(1000, Math.max(0, count)) }, (_, index) => ({ id: `${prefix}_${index + 1}` })); syncCounts();
}
function removeEndpoint(key: 'sataDataPorts' | 'sataPowerConnectors' | 'sataDataInputs' | 'sataPowerInputs', index: number) { props.component?.specs[key]?.splice(index, 1); syncCounts(); }
function setPowerCount(value:unknown){if(!props.component)return;if(value===null||value===undefined||value==='')delete props.component.specs.sataPowerPlugs;else props.component.specs.sataPowerPlugs=Number(value);}
function countOnly(key: 'sataDataPorts'|'sataPowerConnectors'|'sataPowerInputs') {
 if(!props.component)return;const specs=props.component.specs,catalog=specs[key];
 if(catalog!==undefined){const countKey=key==='sataDataPorts'?'sataPorts':key==='sataPowerConnectors'?'sataPower':'sataPowerPlugs';specs[countKey]=catalog.length;}
 delete specs[key];
}
function publish(placement: Placement) { emit('update:bindings', mapStorageBindings(placement)); }
function addData(placement: Placement) { (placement.sataDataConnections ??= []).push({ controllerPlacementId: placement.controllerPlacementId || '', ...(part(placement.componentId)?.specs.sataDataInputs?.[0] ? { inputId: part(placement.componentId)!.specs.sataDataInputs![0].id } : {}) }); publish(placement); }
function addPower(placement: Placement) { (placement.sataPowerConnections ??= []).push({ powerProviderPlacementId: '', ...(part(placement.componentId)?.specs.sataPowerInputs?.[0] ? { inputId: part(placement.componentId)!.specs.sataPowerInputs![0].id } : {}) }); publish(placement); }
function powerDemand(placement: Placement) {
  const component = part(placement.componentId);
  if (!component) return 0;
  if (component.specs.sataPowerInputs !== undefined) return component.specs.sataPowerInputs.length;
  if (component.specs.sataPowerPlugs !== undefined) return component.specs.sataPowerPlugs;
  if (component.category !== 'Drive' || component.specs.driveInterface !== 'SATA' || component.specs.driveSize === 'M.2') return 0;
  const provider = providers.value.find(row => row.id === placement.adapterPlacementId);
  const cage = provider && part(provider.componentId);
  const target = cage?.specs.driveTargets?.find(row => row.id === placement.targetId);
  if (cage && componentCapabilities(cage).adapter === 'bay-cage' && target?.interfaces?.includes('SATA') && target.driveSizes?.includes(component.specs.driveSize || '') && (placement.mount === 'auto' || target.mount === placement.mount) && (cage.specs.sataPowerInputs !== undefined || cage.specs.sataPowerPlugs !== undefined)) return 0;
  return 1;
}
function dataInputs(placement: Placement) { const inputs=part(placement.componentId)?.specs.sataDataInputs;return inputs!==undefined?inputs.map(input=>({title:input.id,value:input.id})):[{title:'Drive data input',value:''}]; }
function powerInputItems(placement: Placement) { const inputs=part(placement.componentId)?.specs.sataPowerInputs;return inputs!==undefined?inputs.map(input=>({title:input.id,value:input.id})):[{title:'Default power input',value:''}]; }
function keepRecorded(items: { title: string; value: string }[], selected?: string) { return selected && !items.some(item => item.value === selected) ? [...items, { title: `${selected} (recorded; unavailable)`, value: selected }] : items; }
function controllerItems(placement: Placement, selected: string) { return keepRecorded([{ title: 'Automatic motherboard', value: '' }, ...providers.value.filter(row => row.id !== placement.id && part(row.componentId) && componentCapabilities(part(row.componentId)!).sataController).map(row => ({ title: `${part(row.componentId)!.name} · ${row.id}`, value: row.id }))], selected); }
function powerProviders(placement: Placement, selected: string) { return keepRecorded([{ title: 'Automatic PSU', value: '' }, ...providers.value.filter(row => row.id !== placement.id && part(row.componentId)?.category === 'PSU').map(row => ({ title: `${part(row.componentId)!.name} · ${row.id}`, value: row.id }))], selected); }
function dataPorts(providerId: string, selected?: string) {
  const provider = providers.value.find(row => providerId ? row.id === providerId : part(row.componentId)?.category === 'Motherboard');
  return keepRecorded([{ title: 'Unassigned / count only', value: '' }, ...(provider ? part(provider.componentId)?.specs.sataDataPorts || [] : []).filter(port => !port.disabled).map(port => ({ title: port.id, value: port.id }))], selected);
}
function powerPlugs(providerId: string, selected?: string) {
  const provider = providers.value.find(row => providerId ? row.id === providerId : part(row.componentId)?.category === 'PSU');
  return keepRecorded([{ title: 'Unassigned / count only', value: '' }, ...(provider ? part(provider.componentId)?.specs.sataPowerConnectors || [] : []).map(plug => ({ title: `${plug.id}${plug.harness ? ` · ${plug.harness}` : ''}`, value: plug.id }))], selected);
}
function removeConnection(placement: Placement, key: 'sataDataConnections' | 'sataPowerConnections', index: number) { placement[key]?.splice(index, 1); publish(placement); }
const routeOptions = (key: 'sataDataInputs' | 'sataPowerInputs') => [{ title: 'Not recorded', value: '' }, ...(props.component?.specs[key] || []).map(input => ({ title: input.id, value: input.id }))];
</script>

<template>
 <section v-if="component && hasComponentFields" class="mt-6">
  <h3>SATA connections</h3><p class="form-hint">Data ports carry one drive channel each. Power connectors are the end plugs on PSU cables, not the modular sockets on the PSU. Named source lists describe the complete connector inventory and override count-only capacity.</p>
  <template v-if="capabilities?.sataController">
   <div class="spec-heading"><h3>SATA data ports provided</h3><v-btn size="small" @click="addEndpoint('sataDataPorts')">Add SATA data port</v-btn></div>
   <v-btn size="small" variant="text" :disabled="component.specs.sataPorts===undefined" @click="generateEndpoints('sataDataPorts',component.specs.sataPorts)">Name ports from count</v-btn><v-btn v-if="component.specs.sataDataPorts!==undefined" size="small" variant="text" @click="countOnly('sataDataPorts')">Use count only</v-btn>
   <div v-for="(port,index) in component.specs.sataDataPorts" :key="index" class="form-grid mt-3"><v-text-field v-model="port.id" label="SATA data port ID" required aria-required="true" /><v-checkbox v-model="port.disabled" label="Always unavailable / disabled" hide-details /><v-btn variant="text" color="error" :aria-label="`Remove SATA data port ${port.id}`" @click="removeEndpoint('sataDataPorts',index)">Remove port</v-btn></div>
  </template>
  <template v-if="component.category==='PSU'">
   <div class="spec-heading"><h3>SATA power plugs provided</h3><v-btn size="small" @click="addEndpoint('sataPowerConnectors')">Add SATA power plug</v-btn></div>
   <v-btn size="small" variant="text" :disabled="component.specs.sataPower===undefined" @click="generateEndpoints('sataPowerConnectors',component.specs.sataPower)">Name plugs from count</v-btn><v-btn v-if="component.specs.sataPowerConnectors!==undefined" size="small" variant="text" @click="countOnly('sataPowerConnectors')">Use count only</v-btn>
   <div v-for="(plug,index) in component.specs.sataPowerConnectors" :key="index" class="form-grid mt-3"><v-text-field v-model="plug.id" label="SATA power plug ID" required aria-required="true" /><v-combobox v-model="plug.harness" label="Cable / harness name (optional)" :items="[...new Set(db.components.flatMap(row=>row.specs.sataPowerConnectors?.map(value=>value.harness).filter((value):value is string=>!!value)||[]))]" :return-object="false" /><v-btn variant="text" color="error" :aria-label="`Remove SATA power plug ${plug.id}`" @click="removeEndpoint('sataPowerConnectors',index)">Remove plug</v-btn></div>
  </template>
  <template v-if="cageInputs">
   <div class="spec-heading"><h3>Cage SATA data inputs</h3><v-btn size="small" @click="addEndpoint('sataDataInputs')">Add cage data input</v-btn></div><p class="form-hint">A passive SATA backplane cannot create controller channels. Record one upstream data input per drive channel, then associate each tray below.</p>
   <div v-for="(input,index) in component.specs.sataDataInputs" :key="index" class="form-grid mt-3"><v-text-field v-model="input.id" label="Cage data input ID" required aria-required="true" /><v-btn variant="text" color="error" :aria-label="`Remove cage data input ${input.id}`" @click="removeEndpoint('sataDataInputs',index)">Remove input</v-btn></div>
  </template>
  <template v-if="powerInputs">
   <v-text-field :model-value="component.specs.sataPowerInputs!==undefined?component.specs.sataPowerInputs.length:component.specs.sataPowerPlugs" label="SATA power plugs consumed per unit" type="number" min="0" :disabled="component.specs.sataPowerInputs!==undefined" :hint="component.specs.sataPowerInputs!==undefined?'Count is determined by the named input list. Choose Use input count only to edit a scalar count.':'Leave blank for unknown; enter 0 for known absent demand.'" persistent-hint @update:model-value="setPowerCount" /><div class="spec-heading"><h3>SATA power inputs consumed</h3><v-btn size="small" @click="addEndpoint('sataPowerInputs')">Add SATA power input</v-btn></div>
   <v-btn size="small" variant="text" :disabled="component.specs.sataPowerPlugs===undefined" @click="generateEndpoints('sataPowerInputs',component.specs.sataPowerPlugs)">Name power inputs from count</v-btn><v-btn v-if="component.specs.sataPowerInputs!==undefined" size="small" variant="text" @click="countOnly('sataPowerInputs')">Use input count only</v-btn>
   <div v-for="(input,index) in component.specs.sataPowerInputs" :key="index" class="form-grid mt-3"><v-text-field v-model="input.id" label="SATA power input ID" required aria-required="true" /><v-btn variant="text" color="error" :aria-label="`Remove SATA power input ${input.id}`" @click="removeEndpoint('sataPowerInputs',index)">Remove input</v-btn></div>
  </template>
  <template v-if="cageInputs && component.specs.driveTargets?.length"><h3 class="mt-5">Tray connection routing</h3><div v-for="target in component.specs.driveTargets" :key="target.id" class="panel pa-4 mt-3"><strong>{{target.id}}</strong><div class="form-grid mt-3"><v-select v-model="target.sataDataInputId" label="Tray SATA data input" :items="keepRecorded(routeOptions('sataDataInputs'),target.sataDataInputId)" /><v-select v-model="target.sataPowerInputId" label="Tray SATA power input" :items="keepRecorded(routeOptions('sataPowerInputs'),target.sataPowerInputId)" /></div></div></template>
 </section>
 <section v-if="configuration && consumers.length" class="mt-6">
  <h3>SATA data & power wiring</h3><p class="form-hint">Assign physical data ports and power end plugs independently. A connected empty cage input still reserves its controller port. Drives bound to routed cage trays share the cage's power input rather than consuming another PSU plug. Split quantities into individual units before mapping named connections.</p>
  <div v-for="placement in consumers" :key="placement.id" class="panel pa-4 mt-3">
   <strong>{{part(placement.componentId)?.name}} × {{placement.quantity}}</strong>
   <p v-if="placement.quantity!==1" class="form-hint">Individual connection mapping requires quantity one. Count-only compatibility remains available.</p>
   <template v-if="part(placement.componentId)?.category==='Drive' && part(placement.componentId)?.specs.driveInterface==='SATA' || part(placement.componentId)?.specs.sataDataInputs?.length || placement.sataDataConnections?.length">
    <p v-if="placement.adapterPlacementId && part(placement.componentId)?.category==='Drive'" class="form-hint">Prefer the cage's routed input for a bound tray; a direct connection here records separate drive wiring.</p>
    <v-btn size="small" variant="outlined" class="mt-3" :disabled="placement.quantity!==1" @click="addData(placement)">Add SATA data connection</v-btn>
    <div v-for="(connection,index) in placement.sataDataConnections" :key="index" class="form-grid mt-3"><v-select v-if="part(placement.componentId)?.specs.sataDataInputs?.length" v-model="connection.inputId" label="Consumer data input" :items="keepRecorded(dataInputs(placement),connection.inputId)" @update:model-value="publish(placement)" /><v-select v-model="connection.controllerPlacementId" label="SATA data controller" :items="controllerItems(placement,connection.controllerPlacementId)" @update:model-value="connection.portId='';publish(placement)" /><v-select v-model="connection.portId" label="SATA data port" :items="dataPorts(connection.controllerPlacementId,connection.portId)" @update:model-value="publish(placement)" /><v-btn variant="text" color="error" :aria-label="`Remove SATA data connection ${index+1}`" @click="removeConnection(placement,'sataDataConnections',index)">Remove data connection</v-btn></div>
   </template>
   <template v-if="powerDemand(placement)>0 || placement.sataPowerConnections?.length">
    <v-btn size="small" variant="outlined" class="mt-3" :disabled="placement.quantity!==1 || powerDemand(placement)>1 && !part(placement.componentId)?.specs.sataPowerInputs?.length" @click="addPower(placement)">Add SATA power connection</v-btn><p v-if="powerDemand(placement)>1 && !part(placement.componentId)?.specs.sataPowerInputs?.length" class="form-hint">Name this component's power inputs in the catalog before mapping multiple plugs.</p>
    <div v-for="(connection,index) in placement.sataPowerConnections" :key="index" class="form-grid mt-3"><v-select v-if="part(placement.componentId)?.specs.sataPowerInputs?.length" v-model="connection.inputId" label="Consumer power input" :items="keepRecorded(powerInputItems(placement),connection.inputId)" @update:model-value="publish(placement)" /><v-select v-model="connection.powerProviderPlacementId" label="SATA power provider" :items="powerProviders(placement,connection.powerProviderPlacementId)" @update:model-value="connection.connectorId='';publish(placement)" /><v-select v-model="connection.connectorId" label="SATA power plug" :items="powerPlugs(connection.powerProviderPlacementId,connection.connectorId)" @update:model-value="publish(placement)" /><v-btn variant="text" color="error" :aria-label="`Remove SATA power connection ${index+1}`" @click="removeConnection(placement,'sataPowerConnections',index)">Remove power connection</v-btn></div>
   </template>
  </div>
 </section>
</template>
