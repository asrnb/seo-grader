// Redirect raw IP access to nip.io to ensure consistent localStorage origin
if (window.location.hostname === 'REDACTED_HOST') {
  window.location.replace(
    window.location.href.replace('REDACTED_HOST', 'REDACTED_HOST.nip.io')
  )
}

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Aura from '@primeuix/themes/aura'
import router from './router'
import App from './App.vue'
import { MotionPlugin } from '@vueuse/motion'
import './style.css'

import * as echarts from 'echarts/core'
import { use } from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { BarChart, LineChart, PieChart, GaugeChart, MapChart, FunnelChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GeoComponent,
  VisualMapComponent,
} from 'echarts/components'
import VChart from 'vue-echarts'
import world from './assets/world.json'

use([
  CanvasRenderer,
  BarChart,
  LineChart,
  PieChart,
  GaugeChart,
  MapChart,
  FunnelChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  TitleComponent,
  GeoComponent,
  VisualMapComponent,
])

echarts.registerMap('world', world)

const app = createApp(App)

app.component('VChart', VChart)

app.use(createPinia())
app.use(router)
app.use(MotionPlugin)
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: {
      darkModeSelector: '.dark',
    },
  },
})

app.mount('#app')
