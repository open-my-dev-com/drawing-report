<script setup lang="ts">
import { createSlipKit, type SlipFile } from '@omdc-slipkit/core';
import { SlipDesigner, SlipViewer } from '@omdc-slipkit/vue';
import { template } from '../template.mjs';

const slipkit = createSlipKit({ locale: 'en' });
const src = JSON.stringify(template);
const onSlipChange = (file: SlipFile): void => {
  console.log(file.kind);
};
</script>

<template>
  <SlipDesigner :src="src" :slipkit="slipkit" @slip-change="onSlipChange" />
  <SlipViewer :src="src" :slipkit="slipkit" />
</template>
