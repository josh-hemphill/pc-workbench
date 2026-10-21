<script setup lang="ts">
import type {Connection,PortRequirement} from '../shared/types';
import {portKinds} from '../shared/types';
import {nextComponentId} from '../shared/component-editor';
const props=defineProps<{connections:Connection[]}>();
const required=(v:unknown)=>!!String(v??'').trim()||'A value is required.';
const count=(v:unknown)=>v!==''&&v!==null&&v!==undefined&&Number.isInteger(Number(v))&&Number(v)>=0&&Number(v)<=10000||'Enter a whole number from 0 to 10000.';
const nonnegative=(v:unknown)=>v===''||v===null||v===undefined||Number.isFinite(Number(v))&&Number(v)>=0||'Enter a non-negative number.';
function addInstrument(){props.connections.push({id:crypto.randomUUID(),name:'',usbA:0,usbC:0,ethernet:0,notes:'',requirements:[]});}
function addRequirement(connection:Connection){const rows=connection.requirements??=[];rows.push({id:nextComponentId('INTERFACE',rows),kind:'Ethernet',quantity:1});}
function optionalNumber(r:PortRequirement,key:'minSpeedMbps'|'minPowerW',value:unknown){if(value===''||value===null||value===undefined)delete r[key];else r[key]=Number(value);}
const detailed=(r:PortRequirement)=>!!(r.connector||r.pinout||r.protocol||r.minSpeedMbps!==undefined||r.minPowerW!==undefined||r.isolated);
</script>
<template>
<section class="control-stack mt-5" aria-label="Structured instrument requirements">
<div class="spec-heading"><h3>Structured instrument requirements</h3><v-btn variant="outlined"  :disabled="connections.length>=200" @click="addInstrument">Add instrument</v-btn></div>
<p class="form-hint">Add an instrument or device, then specify the PC interfaces it needs. Use simple USB / Ethernet counts, or add interface requirements for connector, protocol, speed, power or isolation constraints. Structured USB / Ethernet quantities and simple counts describe the same demand; they are not added together.</p>
<v-alert v-if="!connections.length" type="info" variant="tonal">No instruments added. Choose Add instrument to define its name and interface requirements.</v-alert>
<section v-for="(connection,index) in connections" :key="connection.id" class="panel control-stack pa-4" :aria-label="`Instrument ${index+1}: ${connection.name||'unnamed'}`">
<div class="spec-heading"><h4>{{connection.name||`Instrument ${index+1}`}}</h4><v-btn variant="text" color="error" :aria-label="`Remove instrument ${connection.name||index+1}`" @click="connections.splice(index,1)">Remove instrument</v-btn></div>
<v-text-field v-model="connection.name" label="Instrument / equipment name *" required :rules="[required]" maxlength="200" />
<div class="form-grid"><v-text-field v-model.number="connection.usbA" label="Dedicated USB-A connections" type="number" min="0" max="10000" step="1" :rules="[count]" /><v-text-field v-model.number="connection.usbC" label="Dedicated USB-C connections" type="number" min="0" max="10000" step="1" :rules="[count]" /><v-text-field v-model.number="connection.ethernet" label="Dedicated Ethernet connections" type="number" min="0" max="10000" step="1" :rules="[count]" /></div>
<div class="spec-heading"><h4>Interface requirements</h4><v-btn variant="outlined"  :disabled="(connection.requirements?.length||0)>=1000" @click="addRequirement(connection)">Add interface requirement<span class="sr-only"> for {{connection.name||`instrument ${index+1}`}}</span></v-btn></div>
<p v-if="!connection.requirements?.length" class="form-hint">No detailed interfaces. Add Serial, Parallel or a named Custom interface such as GPIB, CAN or trigger I/O, or refine a USB / Ethernet requirement.</p>
<section v-for="(r,i) in connection.requirements" :key="i" class="control-stack panel pa-4" :aria-label="`Interface requirement ${i+1} for ${connection.name||'instrument'}`">
<div class="form-grid"><v-select v-model="r.kind" label="Interface type" :items="portKinds" @update:model-value="v=>v!=='Custom'&&delete r.customType" /><v-text-field v-if="r.kind==='Custom'" v-model="r.customType" label="Custom interface name" required :rules="[required]" /><v-text-field v-model.number="r.quantity" label="Interface quantity" type="number" min="0" max="10000" step="1" :rules="[count]" /></div>
<details :open="detailed(r)" class="control-stack"><summary>Connector, protocol and electrical constraints</summary><p class="form-hint">Specify the PC-side interface. A matching connector shape alone does not establish compatibility. Leave undocumented constraints blank.</p><div class="form-grid mt-4"><v-text-field v-model="r.connector" label="Required PC-side connector" /><v-text-field v-model="r.pinout" label="Required pinout / wiring standard" /><v-text-field v-model="r.protocol" label="Protocol" /><v-text-field :model-value="r.minSpeedMbps" label="Minimum speed (Mbps)" type="number" min="0" :rules="[nonnegative]" clearable @update:model-value="v=>optionalNumber(r,'minSpeedMbps',v)" /><v-text-field :model-value="r.minPowerW" label="Minimum supplied power (W)" type="number" min="0" :rules="[nonnegative]" clearable @update:model-value="v=>optionalNumber(r,'minPowerW',v)" /><v-switch v-model="r.isolated" label="Requires dedicated isolation" hide-details /></div></details>
<details><summary>Reference ID</summary><v-text-field v-model="r.id" label="Requirement ID" class="mt-4" required :rules="[v=>/^[a-zA-Z0-9_-]{1,80}$/.test(String(v||''))||'Use 1–80 letters, numbers, underscores or hyphens.',v=>connection.requirements?.filter(row=>row.id===v).length===1||'Requirement IDs must be unique for this instrument.']" hint="Keep this ID stable for instrument-to-port mappings." persistent-hint /></details>
<v-btn variant="text" color="error" :aria-label="`Remove interface requirement ${i+1} from ${connection.name||'instrument'}`" @click="connection.requirements?.splice(i,1)">Remove interface requirement</v-btn>
</section>
<v-textarea v-model="connection.notes" label="Instrument connection notes" rows="2" />
</section>
</section>
</template>
