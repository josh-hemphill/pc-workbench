<script setup lang="ts">
import {computed} from 'vue';
import type {Configuration,Database} from '../shared/types';
import {checkStorageConnections} from '../shared/storage-connections';
import {checkConfiguration} from '../shared/compatibility';
import RecordTable from './RecordTable.vue';
const props=defineProps<{configuration:Configuration;db:Database}>();
const wiringReport=computed(()=>checkStorageConnections(props.configuration,props.db,checkConfiguration(props.configuration,props.db).slotAssignments));
</script>
<template>
 <section v-if="wiringReport.summary.dataChannels||wiringReport.summary.powerPlugs" class="mt-6">
  <h3>Storage connection counts</h3><p class="form-hint">Data channels are independent of power plugs. Backplane trays share their declared upstream routes. Cable assembly counts come from the BOM; channels describe the wires within each assembly.</p>
  <div class="d-flex flex-wrap ga-2 my-3"><v-chip>{{wiringReport.summary.dataChannels}} SATA data channels</v-chip><v-chip>{{wiringReport.summary.motherboardChannels}} motherboard · {{wiringReport.summary.controllerChannels}} controller card</v-chip><v-chip>{{wiringReport.summary.backplaneChannels}} backplane inputs</v-chip><v-chip>{{wiringReport.summary.powerPlugs}} SATA power plugs</v-chip><v-chip>{{wiringReport.summary.cabledChannels}} / {{wiringReport.summary.externalChannels}} external channels have cable assignments</v-chip></div>
  <RecordTable v-if="wiringReport.links.length" v-table-scroll="'Storage data connections'" label="Storage data connections" :headers="[{title:'Controller / port',key:'source'},{title:'Consumer / input',key:'destination'},{title:'Channels',key:'quantity'},{title:'Cable assembly / channel',key:'cable'}]" :items="wiringReport.links.map(link=>({...link,id:link.placementId+'-'+link.inputId,source:link.source+' / '+(link.portId||'unassigned'),destination:link.destination+' / '+(link.inputId||'drive'),cable:link.external?(link.cable?link.cable+' / '+(link.channel||'unassigned channel'):'Cable not recorded'):'Onboard M.2'}))" />
 </section>
</template>
