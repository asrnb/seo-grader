<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import Button from 'primevue/button'

const route = useRoute()
const error = ref(null)
const loading = ref(false)

const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001'

onMounted(() => {
  if (route.query.error) {
    error.value = route.query.error
  }
})

function signInWithGoogle() {
  loading.value = true
  window.location.href = `${apiUrl}/api/auth/google`
}
</script>

<template>
  <div class="flex items-center justify-center min-h-screen bg-gray-100">
    <div class="w-full max-w-md p-8 bg-white rounded-2xl shadow-lg text-center">
      <div class="mb-6">
        <h1 class="text-3xl font-bold text-gray-900">SEO AI Grader</h1>
        <p class="mt-2 text-sm text-gray-500">Internal tool for the Callbox SEO team</p>
      </div>

      <div v-if="error" class="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
        {{ error }}
      </div>

      <button
        :disabled="loading"
        class="w-full flex items-center justify-center gap-3 px-6 py-3 border border-gray-300 rounded-lg bg-white hover:bg-gray-50 transition text-sm font-medium text-gray-700 disabled:opacity-60 disabled:cursor-not-allowed shadow-sm"
        @click="signInWithGoogle"
      >
        <svg v-if="!loading" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" class="w-5 h-5">
          <path fill="#EA4335" d="M24 9.5c3.14 0 5.95 1.08 8.17 2.86l6.09-6.09C34.46 3.09 29.5 1 24 1 14.82 1 7.07 6.48 3.64 14.18l7.08 5.5C12.4 13.61 17.74 9.5 24 9.5z"/>
          <path fill="#4285F4" d="M46.5 24.5c0-1.64-.15-3.22-.42-4.75H24v9h12.67c-.55 2.96-2.2 5.47-4.67 7.16l7.18 5.57C43.32 37.56 46.5 31.48 46.5 24.5z"/>
          <path fill="#FBBC05" d="M10.72 28.32A14.6 14.6 0 0 1 9.5 24c0-1.5.26-2.95.72-4.32l-7.08-5.5A23.93 23.93 0 0 0 0 24c0 3.86.92 7.5 2.55 10.72l7.08-5.5c-.46-1.37-.72-2.82-.72-4.32l-.19 3.42z"/>
          <path fill="#34A853" d="M24 47c5.5 0 10.12-1.82 13.5-4.93l-7.18-5.57C28.5 38.1 26.38 38.5 24 38.5c-6.26 0-11.6-4.11-13.28-9.68l-7.08 5.5C7.07 41.52 14.82 47 24 47z"/>
        </svg>
        <i v-else class="pi pi-spin pi-spinner text-gray-500" />
        <span>{{ loading ? 'Redirecting…' : 'Sign in with Google' }}</span>
      </button>

      <p class="mt-6 text-xs text-gray-400">
        Restricted to <strong>@callboxinc.com</strong> accounts only.
      </p>
    </div>
  </div>
</template>
