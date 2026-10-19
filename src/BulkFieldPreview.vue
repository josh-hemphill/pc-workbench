<script setup lang="ts">
import type {BulkFieldChange} from '../shared/bulk-records';
defineProps<{changes:BulkFieldChange[];side:'before'|'after'}>();
const summary=(value:unknown)=>Array.isArray(value)?`${value.length} entries`:'Details';
const text=(value:unknown)=>value===undefined?'Unknown':value===''?'Empty':typeof value==='object'?JSON.stringify(value,null,2):String(value);
</script>
<template><dl class="bulk-preview-values"><div v-for="change in changes" :key="change.path"><dt>{{change.label}}<span v-if="side==='after'&&!change.changed" class="form-hint"> · unchanged</span></dt><dd><details v-if="change[side]!==null&&typeof change[side]==='object'"><summary>{{summary(change[side])}}</summary><pre>{{text(change[side])}}</pre></details><template v-else>{{text(change[side])}}</template></dd></div></dl></template>
<style scoped>.bulk-preview-values{margin:8px 0;min-width:160px}.bulk-preview-values>div+div{margin-top:12px}dt{font-weight:600}dd{margin:3px 0;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:260px;overflow:auto;font-size:.85rem}summary{cursor:pointer}</style>
