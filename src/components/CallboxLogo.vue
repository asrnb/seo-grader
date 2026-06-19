<template>
  <svg :height="height" viewBox="0 0 160 40" xmlns="http://www.w3.org/2000/svg" aria-label="Callbox logo">
    <!-- Yellow caret above the "o" -->
    <text
      x="113"
      y="14"
      font-family="Arial, Helvetica, sans-serif"
      font-size="16"
      font-weight="bold"
      fill="#EAB308"
      text-anchor="middle"
    >^</text>
    <!-- Wordmark -->
    <text
      x="4"
      y="32"
      font-family="Arial, Helvetica, sans-serif"
      font-size="26"
      font-weight="bold"
      :fill="textColor"
    >callbox</text>
  </svg>
</template>

<script setup>
import { inject, computed } from 'vue'

defineProps({
  height: {
    type: [Number, String],
    default: 32,
  },
})

const isDark = inject('isDark', { value: false })
const textColor = computed(() => isDark.value ? '#F1F5F9' : '#000000')
</script>
