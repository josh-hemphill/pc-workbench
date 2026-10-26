<script setup lang="ts">
import type {Database,InventoryPC} from '../shared/types';
import {surveyChoices} from '../shared/hardware-survey';
defineProps<{pc:InventoryPC;db:Database}>();
</script>
<template>
<section class="control-stack my-5">
 <h3>Hardware survey</h3><p>Use the PC’s Inspection tab to record discoveries, category coverage and dated evidence. This field summarizes survey status; part identity and tested condition are separate.</p>
 <template v-if="pc.hardwareSurvey">
  <v-select v-model="pc.hardwareSurvey.status" :items="surveyChoices" @update:model-value="v=>{if(v==='complete')pc.hardwareSurvey!.configurationId=''}" label="Hardware recording status" />
  <template v-if="pc.hardwareSurvey.status!=='complete'">
   <v-autocomplete v-model="pc.hardwareSurvey.configurationId" label="Assumed current configuration" :items="[{title:'Unknown — survey needed',value:''},...db.configurations.map(c=>({title:c.name,value:c.id}))]" />
   <p class="form-hint">Choose a best estimate of the hardware currently present. This is separate from the planned configuration and the location’s target. Duplicate a configuration to describe a different assumption if needed. Recorded parts must agree with this estimate.</p>
  </template>
  <v-alert v-if="pc.hardwareSurvey.status!=='complete'&&(!pc.hardwareSurvey.configurationId||!pc.hardwareSurvey.evidence.trim())" type="info" variant="tonal">This PC can be saved with an incomplete survey. {{!pc.hardwareSurvey.configurationId?'Choose an assumed current configuration':'Record the assumption’s source and date'}} before using it to plan conversions.</v-alert>
  <v-textarea v-model="pc.hardwareSurvey.evidence" label="Survey / assumption evidence and date" rows="2" hint="For example: device reported by site owner, 2026-10-20; hardware inferred from adjacent station. Confirm drive capacities onsite." persistent-hint />
  <p class="form-hint">Assumptions never create stock or installed parts. Mark fully recorded after enumerating hardware in inventory; commissioning requires a completed survey.</p>
 </template>
 <template v-else><p>Survey status has not been recorded. Existing planning uses installed parts, or the linked configuration when no parts are recorded.</p><v-btn variant="outlined" @click="pc.hardwareSurvey={status:'uninspected',configurationId:'',evidence:''}">Record hardware survey status</v-btn></template>
</section>
</template>
