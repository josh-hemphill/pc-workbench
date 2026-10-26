<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount,onMounted,nextTick} from 'vue';
import type {Database} from '../shared/types';
import type {BulkRequest} from '../shared/bulk-records';
import BulkRecordEditor from './BulkRecordEditor.vue';
const props=withDefaults(defineProps<{items:Record<string,any>[];headers:{title:string;key:string;sortable?:boolean}[];label:string;db?:Database;collection?:BulkRequest['collection'];itemValue?:string;searchable?:boolean;groupBy?:{key:string;order?:'asc'|'desc'}[]}>(),{searchable:true});
const emit=defineEmits<{reload:[];notify:[message:string]}>();
const search=ref('');
const sortBy=ref<{key:string;order?:boolean|'asc'|'desc'}[]>([]),itemsPerPage=ref(25);
const tableItems=computed(()=>props.items.filter(item=>props.headers.map(header=>String(item[header.key]??'')).join(' ').toLowerCase().includes(search.value.toLowerCase())));
const selection=ref<string[]>([]),bulkMode=ref(false),page=ref(1),request=ref<BulkRequest|null>(null);
const editor=ref<InstanceType<typeof BulkRecordEditor>|null>(null);
const key=computed(()=>props.itemValue||'id');
const hidden=computed(()=>selection.value.filter(id=>!tableItems.value.some(item=>item[key.value]===id)).length);
watch(()=>tableItems.value.map(item=>item[key.value]).join('\0'),()=>{page.value=1;});
watch(()=>props.db,db=>{if(db&&props.collection){const ids=new Set(db[props.collection].map(r=>r.id));selection.value=selection.value.filter(id=>ids.has(id));}});
function selectMatches(){selection.value=[...new Set([...selection.value,...tableItems.value.map(item=>item[key.value])])];}
function open(action:'edit'|'delete'){if(!props.collection)return;request.value=(action==='delete'?{collection:props.collection,action,ids:[...selection.value]}:{collection:props.collection,action,ids:[...selection.value],patch:{}}) as BulkRequest;}
function confirmDiscard(){return editor.value?.confirmDiscard()??true;}
function hasUnsavedChanges(){return editor.value?.hasUnsavedChanges()??false;}
function beforeUnload(e:BeforeUnloadEvent){if(hasUnsavedChanges()){e.preventDefault();e.returnValue='';}}
onMounted(()=>window.addEventListener('beforeunload',beforeUnload));onBeforeUnmount(()=>window.removeEventListener('beforeunload',beforeUnload));
function getContext(){return {search:search.value,page:page.value,bulkMode:bulkMode.value,selection:[...selection.value],sortBy:sortBy.value.map(item=>({...item})),itemsPerPage:itemsPerPage.value};}
function restoreContext(context:ReturnType<typeof getContext>){search.value=context.search;sortBy.value=(context.sortBy||[]).map(item=>({...item}));itemsPerPage.value=context.itemsPerPage||25;bulkMode.value=context.bulkMode;const ids=new Set(props.items.map(item=>item[key.value]));selection.value=context.selection.filter(id=>ids.has(id));void nextTick(()=>page.value=context.page);}
defineExpose({confirmDiscard,hasUnsavedChanges,getContext,restoreContext});
</script>
<template>
<div class="record-table" :data-table-name="label">
<v-text-field v-if="searchable!==false" :model-value="search" @update:model-value="v=>search=String(v??'')" clearable :label="`Search ${label.toLowerCase()}`" hide-details class="record-table-search" />
<v-switch v-if="collection" v-model="bulkMode" label="Bulk actions" color="primary" hide-details @update:model-value="selection=[]" />
<div v-if="bulkMode" class="bulk-toolbar">
<v-btn variant="outlined" :disabled="!tableItems.length||new Set([...selection,...tableItems.map(item=>item[key])]).size>500" @click="selectMatches">Add all {{tableItems.length}} matching records</v-btn>
<v-btn variant="text" :disabled="!selection.length" @click="selection=[]">Clear selection</v-btn>
<v-btn color="primary" :disabled="!selection.length||selection.length>500" @click="open('edit')">Edit selected</v-btn>
<v-btn v-if="collection!=='inventory'" color="error" variant="outlined" :disabled="!selection.length||selection.length>500" @click="open('delete')">Delete selected</v-btn>
<p role="status">{{selection.length}} selected · {{hidden}} hidden by filters. Header checkbox selects the current page; up to 500 records per action.</p>
</div>
<v-data-table v-model="selection" v-model:page="page" v-model:sort-by="sortBy" v-model:items-per-page="itemsPerPage" :headers="headers" :items="tableItems" :group-by="groupBy" :item-value="key" :show-select="bulkMode" select-strategy="page" :items-per-page-options="[10,25,50,100]" :mobile="false" :aria-label="label" no-data-text="No matching records.">
<template #no-data><div class="record-table-empty control-stack pa-4" role="status"><p>{{search?`No records match “${search}”.`:'No records to show.'}}</p><v-btn v-if="search" variant="outlined" @click="search=''">Clear search</v-btn></div></template>
<template #caption><caption class="sr-only">{{label}}</caption></template>
<template #item.data-table-select="{item,internalItem,index,props:checkbox,toggleSelect}"><v-checkbox-btn v-bind="{...checkbox,onClick:undefined}" @click.stop="(event:MouseEvent)=>toggleSelect(internalItem,index,event)" :aria-label="`Select ${item.c0||item.name||item[key]}`" /></template>
<template v-for="header in headers" :key="header.key" #[`item.${header.key}`]="{item}"><slot :name="header.key" :item="item">{{item[header.key]}}</slot></template>
</v-data-table>
<BulkRecordEditor v-if="db" ref="editor" :request="request" :db="db" @close="request=null" @reload="emit('reload')" @notify="message=>emit('notify',message)" @complete="selection=[]" />
</div>
</template>
