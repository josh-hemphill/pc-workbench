<script setup lang="ts">
import type {Component} from '../shared/types';
defineProps<{component:Component;value:string}>();
const emit=defineEmits<{ 'update:value':[value:string] }>();
</script>
<template>
<v-text-field :model-value="value" :aria-label="`PCPartPicker URL for ${component.name}`" placeholder="https://pcpartpicker.com/product/…" @update:model-value="v=>emit('update:value',String(v||''))" />
</template>
