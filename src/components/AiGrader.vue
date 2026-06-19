<script setup>
import { ref, watch, onMounted, computed } from 'vue'
import { fetchGraderScore } from '../services/metricsApi'
import Card from 'primevue/card'
import Button from 'primevue/button'
import Skeleton from 'primevue/skeleton'
import Tag from 'primevue/tag'

const props = defineProps({
  siteHealth: { type: Number, default: 0 },
  domainRating: { type: Number, default: 0 },
  usTrafficPercent: { type: Number, default: 0 },
  impressionsCtr: { type: Number, default: 0 },
  totalSessions: { type: Number, default: 0 },
  keywordsInTop10: { type: Number, default: 0 },
  autoRun: { type: Boolean, default: false },
})

const loading = ref(false)
const error = ref('')
const result = ref(null)
const revealed = ref(false)

const gradeColors = {
  A: { bg: 'bg-green-100 dark:bg-green-900/40', text: 'text-green-600 dark:text-green-400', border: 'border-green-500' },
  B: { bg: 'bg-blue-100 dark:bg-blue-900/40', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500' },
  C: { bg: 'bg-yellow-100 dark:bg-yellow-900/40', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500' },
  D: { bg: 'bg-orange-100 dark:bg-orange-900/40', text: 'text-orange-600 dark:text-orange-400', border: 'border-orange-500' },
  F: { bg: 'bg-red-100 dark:bg-red-900/40', text: 'text-red-600 dark:text-red-400', border: 'border-red-500' },
}

function statusSeverity(status) {
  if (status === 'pass') return 'success'
  if (status === 'warning') return 'warn'
  return 'danger'
}

function statusLabel(status) {
  return status.toUpperCase()
}

function scoreBarWidth(m) {
  const val = parseFloat(m.value)
  const thresh = parseFloat(m.threshold)
  if (!thresh) return '0%'
  return `${Math.min(100, (val / thresh) * 100)}%`
}

async function calculate() {
  loading.value = true
  error.value = ''
  revealed.value = false
  try {
    result.value = await fetchGraderScore({
      siteHealth: props.siteHealth,
      domainRating: props.domainRating,
      usTrafficPercent: props.usTrafficPercent,
      impressionsCtr: props.impressionsCtr,
      totalSessions: props.totalSessions,
      keywordsInTop10: props.keywordsInTop10,
    })
    setTimeout(() => { revealed.value = true }, 50)
  } catch (err) {
    error.value = err.message || 'Failed to calculate grade'
  } finally {
    loading.value = false
  }
}

watch(() => props.autoRun, (val) => {
  if (val) calculate()
})

onMounted(() => {
  if (props.autoRun) calculate()
})

defineExpose({ calculate })
</script>

<template>
  <Card class="!shadow-sm !border !border-[#E2E8F0] dark:!border-[#334155] !border-l-4 !border-l-[#2563EB] dark:!bg-[#1E293B]">
    <template #title>
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-2 text-base font-semibold text-[#1E293B] dark:text-[#F1F5F9]">
          <i class="pi pi-sparkles text-[#2563EB]" />
          AI SEO Grader
          <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">AI Powered</span>
        </div>
        <Button
          label="Recalculate"
          icon="pi pi-refresh"
          :loading="loading"
          @click="calculate"
          severity="secondary"
          size="small"
          outlined
        />
      </div>
    </template>
    <template #content>
      <!-- Loading State -->
      <div v-if="loading" class="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <div class="flex flex-col items-center gap-2">
          <Skeleton width="120px" height="120px" borderRadius="16px" />
          <Skeleton width="80px" height="20px" />
          <Skeleton width="160px" height="16px" />
        </div>
        <div class="space-y-3">
          <Skeleton v-for="i in 6" :key="i" width="100%" height="44px" />
        </div>
      </div>

      <!-- Error State -->
      <div v-else-if="error" class="text-red-500 text-sm">{{ error }}</div>

      <!-- Result State -->
      <div v-else-if="result" class="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
        <!-- Grade Display -->
        <div class="flex flex-col items-center justify-center gap-1">
          <div
            :class="[
              'grade-letter-box w-28 h-28 rounded-2xl flex items-center justify-center border-2',
              gradeColors[result.grade]?.bg,
              gradeColors[result.grade]?.border,
              revealed ? 'grade-revealed' : 'grade-hidden',
            ]"
          >
            <span
              :class="['text-6xl font-black', gradeColors[result.grade]?.text]"
            >
              {{ result.grade }}
            </span>
          </div>
          <div
            :class="['text-lg font-bold mt-1 text-[#1E293B] dark:text-[#F1F5F9] grade-score', revealed ? 'grade-revealed' : 'grade-hidden']"
          >
            {{ result.score }} / {{ result.maxScore }}
          </div>
          <div
            :class="['text-sm text-center text-[#64748B] dark:text-[#94A3B8] max-w-[200px] grade-summary', revealed ? 'grade-revealed' : 'grade-hidden']"
          >
            {{ result.summary }}
          </div>
        </div>

        <!-- Metric Rows -->
        <div class="space-y-2">
          <div
            v-for="(m, i) in result.metrics"
            :key="m.name"
            v-motion
            :initial="{ opacity: 0, x: 20 }"
            :enter="{ opacity: 1, x: 0, transition: { duration: 300, delay: i * 80 } }"
            class="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-[#F8FAFC] dark:bg-[#0F172A]/50"
          >
            <div class="flex-1 min-w-0">
              <div class="font-medium text-sm text-[#1E293B] dark:text-[#F1F5F9]">{{ m.name }}</div>
              <div class="text-xs text-[#64748B] dark:text-[#94A3B8]">Threshold: {{ m.threshold }}</div>
            </div>
            <div class="text-sm font-semibold text-[#1E293B] dark:text-[#F1F5F9] w-16 text-right">
              {{ m.value }}
            </div>
            <Tag :value="statusLabel(m.status)" :severity="statusSeverity(m.status)" class="w-24 justify-center" />
            <!-- Score bar -->
            <div class="w-20 h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div
                :class="[
                  'h-full rounded-full score-bar',
                  m.status === 'pass' ? 'bg-green-500' : m.status === 'warning' ? 'bg-yellow-500' : 'bg-red-500',
                ]"
                :style="{ width: revealed ? scoreBarWidth(m) : '0%', transitionDelay: `${200 + i * 80}ms` }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Empty State -->
      <div v-else class="text-center text-[#64748B] dark:text-[#94A3B8] text-sm py-4">
        Click <strong>Recalculate</strong> or load dashboard data to generate your SEO grade.
      </div>
    </template>
  </Card>
</template>

<style scoped>
/* Grade letter spring-like scale animation */
.grade-letter-box {
  transition: transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1), opacity 0.4s ease;
}
.grade-hidden.grade-letter-box {
  opacity: 0;
  transform: scale(0);
}
.grade-revealed.grade-letter-box {
  opacity: 1;
  transform: scale(1);
}

/* Score text fade */
.grade-score {
  transition: opacity 0.4s ease 0.2s, transform 0.4s ease 0.2s;
}
.grade-hidden.grade-score {
  opacity: 0;
  transform: translateY(10px);
}
.grade-revealed.grade-score {
  opacity: 1;
  transform: translateY(0);
}

/* Summary fade */
.grade-summary {
  transition: opacity 0.4s ease 0.3s;
}
.grade-hidden.grade-summary {
  opacity: 0;
}
.grade-revealed.grade-summary {
  opacity: 1;
}

/* Score bar width animation */
.score-bar {
  transition: width 0.6s ease;
}
</style>
