<script setup lang="ts">
import {onMounted,onUnmounted,ref} from 'vue';
import {mountEditor} from '../../universal/editor-ui.js';
import {fromTikTools} from '../../universal/index.js';
import {createWidgetRuntime} from '../shared/widget-runtime.ts';
defineProps<{locale:string}>();
const root=ref<HTMLDivElement>();
let editor:ReturnType<typeof mountEditor>|undefined;
let runtime:ReturnType<typeof createWidgetRuntime>|undefined;
onMounted(()=>{
 if(!root.value)return;
 editor=mountEditor(root.value,{locale:root.value.lang,subscribe(fn){
  runtime=createWidgetRuntime({onEnvelope(envelope){const event=fromTikTools(envelope);if(event)fn(event);}});
  runtime.start();return ()=>runtime?.stop();
 }});
});
onUnmounted(()=>editor?.dispose());
</script>
<template><div ref="root" :lang="locale" /></template>
