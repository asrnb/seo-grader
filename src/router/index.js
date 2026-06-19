import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import LoginView from '../views/LoginView.vue'
import Dashboard from '../views/Dashboard.vue'
import AuthCallback from '../views/AuthCallback.vue'

const routes = [
  { path: '/', redirect: '/login' },
  { path: '/login', name: 'Login', component: LoginView, meta: { guest: true } },
  { path: '/auth/callback', name: 'AuthCallback', component: AuthCallback },
  { path: '/dashboard', name: 'Dashboard', component: Dashboard, meta: { requiresAuth: true } },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()

  // On first load, check if stored token is still valid
  if (!auth.isAuthenticated && auth.token) {
    await auth.checkAuth()
  }

  if (to.meta.requiresAuth && !auth.isAuthenticated) {
    return { name: 'Login' }
  }

  if (to.meta.guest && auth.isAuthenticated) {
    return { name: 'Dashboard' }
  }
})

export default router
