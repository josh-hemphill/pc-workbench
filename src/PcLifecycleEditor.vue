<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { Database, InventoryPC, SoftwareSettings } from '../shared/types';
import SoftwareEditor from './SoftwareEditor.vue';
const props = defineProps<{ pc: InventoryPC; db?: Database }>();
const software=ref<SoftwareSettings>({});
watch(()=>props.pc.software||props.pc.buildSettings?.software,value=>{software.value=JSON.parse(JSON.stringify(value||{}));},{immediate:true,deep:true});
watch(software,value=>{if(JSON.stringify(value)!==JSON.stringify(props.pc.software||props.pc.buildSettings?.software||{}))props.pc.software=JSON.parse(JSON.stringify(value));},{deep:true});
const components = computed(()=>{const ids=new Set(props.db?.inventory.flatMap(s=>s.allocations.some(a=>a.pcId===props.pc.id&&a.state==='installed')?[s.componentId]:[])||[]);for(const p of props.db?.configurations.find(c=>c.id===props.pc.configurationId)?.placements||[])ids.add(p.componentId);return props.db?.components.filter(c=>ids.has(c.id))||[];});
const drivers = computed({ get: () => Object.entries(software.value.drivers || {}).map(([k,v]) => `${k}=${v}`).join('\n'), set: value => { software.value.drivers = entries(value); } });
const firmware = computed({ get: () => Object.entries(software.value.firmware || {}).map(([k,v]) => `${k}=${v}`).join('\n'), set: value => { software.value.firmware = entries(value); } });
function entries(value: string) { return Object.fromEntries(value.split('\n').filter(line => line.includes('=')).map(line => { const split = line.indexOf('='); return [line.slice(0,split).trim(), line.slice(split+1).trim()]; })); }
</script>
<template>
  <div class="spec-heading"><h3>Lifecycle & software</h3></div>
  <v-select v-model="pc.lifecycle" label="Lifecycle" :items="['Planning','Building','Maintenance','Retired',...(pc.commissioning ? ['Commissioned','In service'] : [])]" class="mb-5" />
  <p class="form-hint">Commission from the PC detail after recording installed hardware. Each commissioning captures a versioned hardware, equipment and software snapshot.</p>
  <SoftwareEditor v-if="db" :software="software" :components="components" />
  <template v-else><div class="form-grid"><v-text-field v-model="software.os" label="Operating system / image version" /><v-text-field v-model="software.bios" label="BIOS / UEFI version" /></div>
  <div class="form-grid"><v-textarea v-model="drivers" label="Drivers (component=version, one per line)" rows="3" /><v-textarea v-model="firmware" label="Firmware (component=version, one per line)" rows="3" /></div></template>
</template>
