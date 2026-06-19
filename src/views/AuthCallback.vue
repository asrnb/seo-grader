<script setup>
import { onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  const token = route.query.token
  if (token) {
    auth.login(token)
    await auth.checkAuth()
    router.replace('/dashboard')
  } else {
    router.replace('/login')
  }
})
</script>

<template>
  <div class="flex items-center justify-center min-h-screen">
    <p class="text-gray-500">Signing you in…</p>
  </div>
</template>
