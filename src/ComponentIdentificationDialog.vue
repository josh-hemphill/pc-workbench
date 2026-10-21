<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import type {Component,Database} from '../shared/types';
import type {IdentificationInput,IdentificationPreview} from '../shared/component-identification';
import {componentIdentityLabel} from '../shared/component-identity';
import ComponentDataEditor from './ComponentDataEditor.vue';
const props=defineProps<{sourceId:string|null;db:Database;revision:string}>();
const emit=defineEmits<{close:[];reload:[];notify:[message:string]}>();
const draft=ref<IdentificationInput|null>(null),preview=ref<IdentificationPreview|null>(null),busy=ref(false),error=ref(''),createNew=ref(false),newPart=ref<Component|null>(null),targetEditor=ref<InstanceType<typeof ComponentDataEditor>|null>(null);
const useSearch=ref('');
const matches=(values:unknown[])=>values.join(' ').toLowerCase().includes(useSearch.value.toLowerCase());
let baseline='',expected='';
watch(()=>props.sourceId,id=>{const c=props.db.components.find(c=>c.id===id);draft.value=c?{sourceId:c.id,targetId:'',evidence:'',actor:'',stock:[],configurations:[]}:null;newPart.value=c?{id:crypto.randomUUID(),name:'',category:c.category,manufacturer:c.manufacturer,model:'',identityKind:'model',specs:{},source:'',verified:false}:null;createNew.value=false;useSearch.value='';preview.value=null;error.value='';expected=props.revision;baseline=JSON.stringify(draft.value);},{immediate:true});
const source=computed(()=>props.db.components.find(c=>c.id===props.sourceId));
const stocks=computed(()=>props.db.inventory.filter(s=>s.componentId===props.sourceId&&s.quantity>0&&matches([s.id,s.serial,s.assetTag,s.location,...s.allocations.flatMap(a=>[a.pcId,props.db.pcs.find(pc=>pc.id===a.pcId)?.name])])));
const configs=computed(()=>props.db.configurations.filter(c=>c.placements.some(p=>p.componentId===props.sourceId)&&matches([c.id,c.name,...props.db.pcs.filter(pc=>pc.configurationId===c.id).flatMap(pc=>[pc.id,pc.name])])));
const targets=computed(()=>props.db.components.filter(c=>c.id!==props.sourceId&&c.identityKind!=='placeholder'&&c.category===source.value?.category&&c.model?.trim()).map(c=>({title:componentIdentityLabel(c),value:c.id})));
const input=computed<IdentificationInput|null>(()=>draft.value?{...draft.value,...(createNew.value&&newPart.value?{targetId:undefined,newComponent:newPart.value}:{})}:null);
watch(input,()=>preview.value=null,{deep:true});
function stockSelection(id:string){return draft.value?.stock.find(s=>s.stockId===id);}
function toggleStock(id:string,on:boolean){if(!draft.value)return;draft.value.stock=draft.value.stock.filter(s=>s.stockId!==id);if(on)draft.value.stock.push({stockId:id,availableQuantity:0,allocationIds:[]});}
function configSelection(id:string){return draft.value?.configurations.find(c=>c.configurationId===id);}
function toggleConfig(id:string,on:boolean){if(!draft.value)return;draft.value.configurations=draft.value.configurations.filter(c=>c.configurationId!==id);if(on)draft.value.configurations.push({configurationId:id,placementIds:[],pcIds:[],updateTemplate:false});}
function hasUnsavedChanges(){return busy.value||!!draft.value&&(JSON.stringify(draft.value)!==baseline||createNew.value);}
function confirmDiscard(){if(busy.value)return false;if(hasUnsavedChanges()&&!window.confirm('Discard the identification selection?'))return false;emit('close');return true;}
defineExpose({hasUnsavedChanges,confirmDiscard});
async function request(apply=false){if(busy.value||!input.value)return;if(createNew.value&&targetEditor.value&&!targetEditor.value.canChangeSection())return;busy.value=true;error.value='';try{const r=await fetch(`/api/catalog/identify/${apply?'apply':'preview'}`,{method:'POST',headers:{'Content-Type':'application/json','If-Match':expected},body:JSON.stringify(apply?{input:input.value,token:preview.value?.token}:input.value)});const body=await r.json();if(!r.ok)throw Error(body.error||'Identification failed.');if(apply){emit('reload');emit('notify','Selected uses identified. Review changed configurations and installed-PC compatibility.');emit('close');}else{preview.value=body;expected=r.headers.get('X-Workspace-Revision')||expected;}}catch(e){error.value=e instanceof Error?e.message:String(e);preview.value=null;}finally{busy.value=false;}}
</script>
<template>
<v-dialog :model-value="!!draft" persistent scrollable max-width="1100" aria-labelledby="identification-title" @keydown.esc.stop.prevent="confirmDiscard">
<v-card v-if="draft&&source" class="editor-dialog"><v-card-title><h2 id="identification-title">Identify uses of {{source.name}}</h2></v-card-title>
<v-card-text class="dialog-body control-stack" :inert="busy">
<v-alert v-if="error" type="error" role="alert">{{error}}</v-alert>
<p>This catchall may cover several real models. Identify one evidenced group at a time. Unselected stock and configurations remain unknown.</p>
<v-switch v-model="createNew" label="Create a new exact model" hide-details />
<ComponentDataEditor v-if="createNew&&newPart" ref="targetEditor" :component="newPart" :db="db" />
<v-autocomplete v-else v-model="draft.targetId" label="Identified model" :items="targets" clearable hint="Only same-category parts with a model / part number are offered. Add a model number to an existing catalog record if needed." persistent-hint />
<v-textarea v-model="draft.evidence" label="Identification evidence *" hint="Record the PC/asset, part label, CPU ID, memory SPD or inventory report that establishes this identity." persistent-hint rows="2" />
<v-text-field v-model="draft.actor" label="Identified by" />
<v-text-field :model-value="useSearch" @update:model-value="v=>useSearch=String(v??'')" label="Find uses by PC, configuration or stock" clearable hint="Filtering keeps selections, including hidden rows." persistent-hint /><p role="status">{{draft.configurations.length}} configuration group(s) and {{draft.stock.length}} stock record(s) selected, including hidden rows.</p>
<section class="control-stack"><h3>Configuration uses</h3><p>Choose individual placements. Copy for selected PCs to keep other PCs on the shared template. Changing a shared template affects every PC linked to it.</p>
<p v-if="!configs.length">No configuration uses match this filter.</p>
<div v-for="cfg in configs" :key="cfg.id" class="panel control-stack pa-4">
<v-checkbox :model-value="!!configSelection(cfg.id)" :label="`Identify in ${cfg.name}`" hide-details @update:model-value="v=>toggleConfig(cfg.id,!!v)" />
<template v-if="configSelection(cfg.id)"><v-select v-model="configSelection(cfg.id)!.placementIds" :label="`Placements in ${cfg.name}`" :items="cfg.placements.filter(p=>p.componentId===sourceId).map(p=>({title:`${p.id} · ${p.quantity} unit(s)`,value:p.id}))" multiple chips clearable />
<v-switch v-model="configSelection(cfg.id)!.updateTemplate" label="Update shared template and all linked PCs" hide-details @update:model-value="()=>configSelection(cfg.id)!.pcIds=[]" />
<v-select v-if="!configSelection(cfg.id)!.updateTemplate" v-model="configSelection(cfg.id)!.pcIds" :label="`Copy configuration for selected PCs in ${cfg.name}`" :items="db.pcs.filter(pc=>pc.configurationId===cfg.id).map(pc=>({title:pc.name,value:pc.id}))" multiple chips clearable />
</template></div></section>
<section class="control-stack"><h3>Physical stock</h3><p>Choose unallocated quantities and whole reserved/installed allocations. If an allocation links to a planned placement, identify that configuration use above too. A placement or allocation with several units must all represent the same model; split mixed groups using the normal configuration or stock tools first.</p><p v-if="!stocks.length">No physical stock matches this filter.</p>
<div v-for="stock in stocks" :key="stock.id" class="panel control-stack pa-4"><v-checkbox :model-value="!!stockSelection(stock.id)" :label="`Identify stock ${stock.serial||stock.assetTag||stock.id} · ${stock.location||'No location'} · ${stock.quantity} unit(s)`" hide-details @update:model-value="v=>toggleStock(stock.id,!!v)" />
<template v-if="stockSelection(stock.id)"><v-text-field v-model.number="stockSelection(stock.id)!.availableQuantity" :label="`Unallocated quantity from ${stock.id}`" type="number" min="0" :max="stock.quantity-stock.allocations.reduce((n,a)=>n+a.quantity,0)" :hint="`${stock.quantity-stock.allocations.reduce((n,a)=>n+a.quantity,0)} unallocated`" persistent-hint />
<v-select v-model="stockSelection(stock.id)!.allocationIds" :label="`Allocations from ${stock.id}`" :items="stock.allocations.map(a=>({title:`${db.pcs.find(pc=>pc.id===a.pcId)?.name||a.pcId} · ${a.state} · ${a.quantity} · ${a.plannedPlacementId||'Unlinked'}`,value:a.id}))" multiple chips clearable /></template></div></section>
<v-btn variant="outlined" :disabled="busy" @click="request()">Preview identification</v-btn>
<section v-if="preview" class="control-stack" aria-label="Identification review"><h3>{{preview.source}} → {{preview.target}}</h3><p>{{preview.quantity}} physical unit(s), {{preview.allocations}} allocation(s), {{preview.configurations}} configuration(s) changed. {{preview.remainingQuantity}} physical unit(s) remain on the placeholder.</p><p v-if="preview.pcs.length">PCs: {{preview.pcs.join(', ')}}</p><v-alert type="info" variant="tonal"><p v-for="warning in preview.warnings" :key="warning">{{warning}}</p></v-alert></section>
</v-card-text><v-card-actions class="dialog-footer"><v-btn :disabled="busy" @click="confirmDiscard">Cancel</v-btn><v-btn color="primary" :disabled="!preview||busy" :loading="busy" @click="request(true)">Apply identification</v-btn></v-card-actions></v-card>
</v-dialog>
</template>
