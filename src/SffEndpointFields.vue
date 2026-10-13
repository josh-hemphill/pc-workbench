<script setup lang="ts">
import type {SffEndpoint} from '../shared/types';
import {sffConnectors} from '../shared/sff-connections';
const props=defineProps<{endpoint:SffEndpoint;readonlyId?:boolean}>();
function numeric(key:'channels'|'pcieLanes',value:unknown){if(value==null||value==='')delete props.endpoint[key];else props.endpoint[key]=Number(value);}
</script>
<template>
 <div class="form-grid">
  <v-text-field v-model="endpoint.id" label="SFF connector ID" :readonly="readonlyId" data-field="id" />
  <v-combobox v-model="endpoint.connector" :items="sffConnectors" label="SFF connector type" :return-object="false" data-field="connector" />
  <v-select :model-value="endpoint.protocols||[]" @update:model-value="v=>endpoint.protocols=v?.length?v:undefined" label="Supported storage protocols" :items="['SATA','SAS','NVMe']" multiple chips clearable data-field="protocols" />
  <v-text-field :model-value="endpoint.channels" label="Device channels" type="number" min="1" max="32" data-field="channels" @update:model-value="v=>numeric('channels',v)" />
  <v-text-field v-if="endpoint.protocols?.includes('NVMe')||endpoint.pcieLanes!==undefined" :model-value="endpoint.pcieLanes" label="Total electrical PCIe lanes" type="number" min="1" max="32" data-field="pcieLanes" @update:model-value="v=>numeric('pcieLanes',v)" />
  <v-checkbox v-model="endpoint.disabled" label="Connector disabled" />
 </div>
 <p class="form-hint">Channels count devices, not connector pins or PCIe lanes. Declare only protocols supported by the hardware; SFF connector shape alone does not establish compatibility.</p>
</template>
