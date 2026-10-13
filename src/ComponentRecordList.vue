<script setup lang="ts">
import {computed,ref,watch} from 'vue';
const props=defineProps<{label:string;items:{id:string;summary:string}[];modelValue:number}>();
const emit=defineEmits<{'update:modelValue':[value:number]}>();
const search=ref(''),page=ref(1),size=8;
const matches=computed(()=>props.items.map((item,index)=>({...item,index})).filter(item=>`${item.id} ${item.summary}`.toLowerCase().includes(search.value.toLowerCase())));
const pages=computed(()=>Math.max(1,Math.ceil(matches.value.length/size)));
const visible=computed(()=>matches.value.slice((page.value-1)*size,page.value*size));
watch(search,()=>page.value=1);
watch(()=>props.modelValue,index=>{const found=matches.value.findIndex(item=>item.index===index);if(found>=0)page.value=Math.floor(found/size)+1;},{immediate:true});
watch(pages,count=>page.value=Math.min(page.value,count));
</script>
<template>
 <div class="component-record-layout">
  <aside class="component-record-list"><v-text-field :model-value="search" @update:model-value="v=>search=String(v??'')" :label="`Search ${label.toLowerCase()}`" clearable hide-details density="compact" /><p class="form-hint my-2">{{matches.length}} / {{items.length}} records</p><v-list :aria-label="label" density="compact"><v-list-item v-for="item in visible" :key="item.index" :active="item.index===modelValue" :title="item.id||'Unnamed record'" :subtitle="item.summary" @click="emit('update:modelValue',item.index)" /></v-list><v-pagination v-if="pages>1" v-model="page" :length="pages" :total-visible="3" density="compact" :aria-label="`${label} pages`" /></aside>
  <div class="component-record-detail control-stack"><slot v-if="modelValue>=0&&modelValue<items.length" /><p v-else class="form-hint">Add a record or select one from the list to edit its details.</p></div>
 </div>
</template>
