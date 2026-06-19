import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const token = ref(localStorage.getItem('auth_token') || null)

  const isAuthenticated = computed(() => !!token.value && !!user.value)

  async function checkAuth() {
    const stored = localStorage.getItem('auth_token')
    if (!stored) {
      user.value = null
      token.value = null
      return false
    }

    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        headers: { Authorization: `Bearer ${stored}` },
      })

      if (res.status === 401) {
        // Token invalid or Google session expired — clear and redirect to login
        logout()
        return false
      }

      if (!res.ok) throw new Error('Auth check failed')

      user.value = await res.json()
      token.value = stored
      return true
    } catch {
      logout()
      return false
    }
  }

  function login(newToken) {
    token.value = newToken
    localStorage.setItem('auth_token', newToken)
  }

  async function logout() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
      })
    } catch {
      // Server logout is best-effort
    }
    token.value = null
    user.value = null
    localStorage.removeItem('auth_token')
  }

  return { user, token, isAuthenticated, login, logout, checkAuth }
})
