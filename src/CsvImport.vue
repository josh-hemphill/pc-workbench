<script setup lang="ts">
import {computed,ref,watch} from 'vue';
import RecordTable from './RecordTable.vue';
const props=defineProps<{revision:string}>();
const emit=defineEmits<{reload:[];notify:[message:string];busy:[value:boolean]}>();
const collection=ref('components'),file=ref<File|null>(null),busy=ref(false),error=ref('');
type Preview={valid:boolean;revision:string;token:string;error:string;rows:{id:string;name:string;status:string;fields:string;before:unknown;after:unknown;error:string}[]};
const preview=ref<Preview|null>(null),csv=ref('');
watch([collection,file],()=>{preview.value=null;csv.value='';error.value='';});
const stale=computed(()=>!!preview.value&&preview.value.revision!==props.revision);
const counts=computed(()=>['Add','Update','Unchanged','Conflict'].map(status=>({status,count:preview.value?.rows.filter(row=>row.status===status).length||0})));
const changes=computed(()=>preview.value?.rows.some(row=>row.status==='Add'||row.status==='Update'));
async function request(route:string,body:unknown,revision?:string){const response=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(revision?{'If-Match':revision}:{})},body:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw Error(data.error||'Import request failed.');return data;}
async function run(action:()=>Promise<void>){if(busy.value)return;busy.value=true;emit('busy',true);error.value='';try{await action();}catch(e){error.value=e instanceof Error?e.message:String(e);}finally{busy.value=false;emit('busy',false);}}
function inspect(){void run(async()=>{preview.value=null;if(!file.value)return;if(file.value.size>8*1024*1024)throw Error('CSV files must be under 8 MiB.');csv.value=await file.value.text();preview.value=await request('/api/import/preview',{collection:collection.value,csv:csv.value});});}
function apply(){void run(async()=>{if(!preview.value?.valid||stale.value)return;const result=await request('/api/import/apply',{collection:collection.value,csv:csv.value,token:preview.value.token},preview.value.revision);preview.value=null;file.value=null;emit('reload');emit('notify',`Imported ${result.imported} changed records; ${result.unchanged} unchanged.`);});}
</script>
<template>
<section class="panel data-section"><h2>Import CSV</h2><p>Preview additions, updates and conflicts before applying the whole file. Records absent from the file are kept.</p>
<v-select v-model="collection" label="Collection" :items="['components','systems','requirementsSets','configurations','installationLocations','pcs','inventory']" :disabled="busy" class="mb-5" />
<v-file-input v-model="file" label="Choose CSV file" accept=".csv,text/csv" :disabled="busy" />
<v-btn variant="outlined" :disabled="!file||busy" :loading="busy" @click="inspect">Preview CSV changes</v-btn>
<v-alert v-if="error||preview?.error" type="error" role="alert" class="my-4">{{error||preview?.error}} No records were imported.</v-alert>
<template v-if="preview"><p role="status" class="my-4"><span v-for="count in counts" :key="count.status" class="category-tag mr-2">{{count.status}}: {{count.count}}</span></p>
<v-alert v-if="stale" type="warning" class="mb-4">The workspace changed. Preview this file again before applying it.</v-alert>
<RecordTable label="CSV change preview" :headers="[{title:'Record',key:'name'},{title:'Change',key:'status'},{title:'Changed fields',key:'fields'},{title:'Details',key:'details',sortable:false}]" :items="preview.rows.map(row=>({...row,details:''}))">
<template #details="{item}"><p v-if="item.error">{{item.error}}</p><details v-else-if="item.status!=='Unchanged'"><summary>Before and after</summary><h3>Before</h3><pre class="snapshot-json" tabindex="0">{{JSON.stringify(item.before,null,2)}}</pre><h3>After</h3><pre class="snapshot-json" tabindex="0">{{JSON.stringify(item.after,null,2)}}</pre></details></template>
</RecordTable><v-btn color="primary" class="mt-4" :disabled="!preview.valid||stale||!changes||busy" @click="apply">Apply reviewed import</v-btn></template>
<small class="import-order">For workspace transfers, import components and systems, then requirements sets and configurations, then locations, PCs and inventory. Existing audit histories are protected.</small>
</section>
</template>
