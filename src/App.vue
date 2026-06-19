<script setup>
import { ref, provide, watch } from 'vue'
import { RouterView, useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'


const auth = useAuthStore()
const router = useRouter()

// Dark mode
const isDark = ref(localStorage.getItem('darkMode') === 'true')

function toggleDark() {
  isDark.value = !isDark.value
  localStorage.setItem('darkMode', isDark.value)
}

watch(isDark, (val) => {
  document.documentElement.classList.toggle('dark', val)
}, { immediate: true })

provide('isDark', isDark)

async function handleLogout() {
  await auth.logout()
  router.push('/login')
}
</script>

<template>
  <!-- Authenticated layout with header -->
  <div v-if="auth.isAuthenticated" class="flex flex-col h-screen bg-[#F8FAFC] dark:bg-[#0F172A]">
    <header class="bg-white dark:bg-[#1E293B] border-b border-[#E5E7EB] dark:border-[#334155] flex items-center justify-between px-3 sm:px-6 shrink-0 sticky top-0 z-50" style="height: 56px;">
      <div class="flex items-center gap-3">
        <span class="font-semibold text-slate-800 dark:text-[#F1F5F9] text-base">SEO & AI Grader</span>
      </div>
      <div class="flex items-center gap-2 sm:gap-3">
        <!-- Dark mode toggle -->
        <button
          class="p-2 rounded-lg text-[#64748B] hover:bg-[#F1F5F9] dark:hover:bg-[#334155] transition-colors"
          @click="toggleDark"
          :title="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        >
          <i v-if="isDark" class="pi pi-sun text-lg" />
          <i v-else class="pi pi-moon text-lg" />
        </button>
        <div v-if="auth.user" class="flex items-center gap-2">
          <img
            v-if="auth.user.picture"
            :src="auth.user.picture"
            :alt="auth.user.name"
            class="w-8 h-8 rounded-full"
            referrerpolicy="no-referrer"
          />
          <span class="hidden sm:block text-sm text-[#64748B] dark:text-[#94A3B8]">{{ auth.user.name || auth.user.email }}</span>
        </div>
        <button
          class="flex items-center gap-2 px-3 py-1.5 text-sm text-[#64748B] rounded-lg hover:bg-[#F1F5F9] dark:hover:bg-[#334155] hover:text-[#1E293B] dark:hover:text-[#F1F5F9] transition-colors"
          @click="handleLogout"
        >
          <i class="pi pi-sign-out" />
          <span class="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>

    <main class="flex-1 overflow-auto">
      <RouterView />
    </main>
  </div>

  <!-- Guest layout (login, callback) — no header -->
  <RouterView v-else />
</template>
