import { defineStore } from 'pinia'
import { ref } from 'vue'
import {
  fetchTotalTraffic,
  fetchTrafficBySource,
  fetchNewVsReturning,
  fetchTrafficBySourceOverTime,
  fetchTrafficFromUS,
  fetchTrafficDrivers,
  fetchImpressions,
  fetchKeywordRankings,
  fetchDomainRating,
  fetchSiteHealth,
  fetchSiteAuditIssues,
  fetchTrafficUSBySource,
  fetchTrafficUSBySourceOverTime,
  fetchBacklinks,
  fetchBacklinksHistory,
  fetchGscCoverage,
  fetchGscMobile,
  fetchGscStructuredData,
} from '../services/metricsApi'

export const useMetricsStore = defineStore('metrics', () => {
  const totalTraffic = ref(null)
  const trafficBySource = ref(null)
  const trafficFromUS = ref(null)
  const trafficDrivers = ref(null)
  const impressions = ref(null)
  const domainRating = ref(null)
  const siteHealth = ref(null)
  const keywordRankings = ref(null)
  const siteAuditIssues = ref(null)
  const trafficUSBySource = ref(null)
  const newVsReturning = ref(null)
  const trafficBySourceOverTime = ref(null)
  const trafficUSBySourceOverTime = ref(null)
  const backlinks = ref(null)
  const backlinksHistory = ref(null)
  const gscCoverage = ref(null)
  const gscMobile = ref(null)
  const gscStructuredData = ref(null)

  const loading = ref({
    totalTraffic: false,
    trafficBySource: false,
    newVsReturning: false,
    trafficBySourceOverTime: false,
    trafficFromUS: false,
    trafficDrivers: false,
    impressions: false,
    keywordRankings: false,
    domainRating: false,
    siteHealth: false,
    siteAuditIssues: false,
    trafficUSBySource: false,
    trafficUSBySourceOverTime: false,
    backlinks: false,
    backlinksHistory: false,
    gscCoverage: false,
    gscMobile: false,
    gscStructuredData: false,
  })

  const errors = ref({
    totalTraffic: null,
    trafficBySource: null,
    newVsReturning: null,
    trafficBySourceOverTime: null,
    trafficFromUS: null,
    trafficDrivers: null,
    impressions: null,
    keywordRankings: null,
    domainRating: null,
    siteHealth: null,
    siteAuditIssues: null,
    trafficUSBySource: null,
    trafficUSBySourceOverTime: null,
    backlinks: null,
    backlinksHistory: null,
    gscCoverage: null,
    gscMobile: null,
    gscStructuredData: null,
  })

  async function loadTotalTraffic(propertyId, startDate, endDate) {
    loading.value.totalTraffic = true
    errors.value.totalTraffic = null
    try {
      totalTraffic.value = await fetchTotalTraffic(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.totalTraffic = err.message
    } finally {
      loading.value.totalTraffic = false
    }
  }

  async function loadTrafficBySource(propertyId, startDate, endDate) {
    loading.value.trafficBySource = true
    errors.value.trafficBySource = null
    try {
      trafficBySource.value = await fetchTrafficBySource(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficBySource = err.message
    } finally {
      loading.value.trafficBySource = false
    }
  }

  async function loadNewVsReturning(propertyId, startDate, endDate) {
    loading.value.newVsReturning = true
    errors.value.newVsReturning = null
    try {
      newVsReturning.value = await fetchNewVsReturning(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.newVsReturning = err.message
    } finally {
      loading.value.newVsReturning = false
    }
  }

  async function loadTrafficBySourceOverTime(propertyId, startDate, endDate) {
    loading.value.trafficBySourceOverTime = true
    errors.value.trafficBySourceOverTime = null
    try {
      trafficBySourceOverTime.value = await fetchTrafficBySourceOverTime(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficBySourceOverTime = err.message
    } finally {
      loading.value.trafficBySourceOverTime = false
    }
  }

  async function loadTrafficFromUS(propertyId, startDate, endDate) {
    loading.value.trafficFromUS = true
    errors.value.trafficFromUS = null
    try {
      trafficFromUS.value = await fetchTrafficFromUS(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficFromUS = err.message
    } finally {
      loading.value.trafficFromUS = false
    }
  }

  async function loadTrafficDrivers(propertyId, startDate, endDate) {
    loading.value.trafficDrivers = true
    errors.value.trafficDrivers = null
    try {
      trafficDrivers.value = await fetchTrafficDrivers(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficDrivers = err.message
    } finally {
      loading.value.trafficDrivers = false
    }
  }

  async function loadImpressions(siteUrl, startDate, endDate) {
    loading.value.impressions = true
    errors.value.impressions = null
    try {
      impressions.value = await fetchImpressions(siteUrl, startDate, endDate)
    } catch (err) {
      errors.value.impressions = err.message
    } finally {
      loading.value.impressions = false
    }
  }

  async function loadKeywordRankings(siteUrl, startDate, endDate) {
    loading.value.keywordRankings = true
    errors.value.keywordRankings = null
    try {
      keywordRankings.value = await fetchKeywordRankings(siteUrl, startDate, endDate)
    } catch (err) {
      errors.value.keywordRankings = err.message
    } finally {
      loading.value.keywordRankings = false
    }
  }

  async function loadDomainRating(target, date) {
    loading.value.domainRating = true
    errors.value.domainRating = null
    try {
      domainRating.value = await fetchDomainRating(target, date)
    } catch (err) {
      errors.value.domainRating = err.message
    } finally {
      loading.value.domainRating = false
    }
  }

  async function loadSiteHealth(target) {
    loading.value.siteHealth = true
    errors.value.siteHealth = null
    try {
      siteHealth.value = await fetchSiteHealth(target)
    } catch (err) {
      errors.value.siteHealth = err.message
    } finally {
      loading.value.siteHealth = false
    }
  }

  async function loadSiteAuditIssues(target) {
    loading.value.siteAuditIssues = true
    errors.value.siteAuditIssues = null
    try {
      siteAuditIssues.value = await fetchSiteAuditIssues(target)
    } catch (err) {
      errors.value.siteAuditIssues = err.message
    } finally {
      loading.value.siteAuditIssues = false
    }
  }

  async function loadTrafficUSBySource(propertyId, startDate, endDate) {
    loading.value.trafficUSBySource = true
    errors.value.trafficUSBySource = null
    try {
      trafficUSBySource.value = await fetchTrafficUSBySource(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficUSBySource = err.message
    } finally {
      loading.value.trafficUSBySource = false
    }
  }

  async function loadTrafficUSBySourceOverTime(propertyId, startDate, endDate) {
    loading.value.trafficUSBySourceOverTime = true
    errors.value.trafficUSBySourceOverTime = null
    try {
      trafficUSBySourceOverTime.value = await fetchTrafficUSBySourceOverTime(propertyId, startDate, endDate)
    } catch (err) {
      errors.value.trafficUSBySourceOverTime = err.message
    } finally {
      loading.value.trafficUSBySourceOverTime = false
    }
  }

  async function loadBacklinks(target) {
    loading.value.backlinks = true
    errors.value.backlinks = null
    try {
      backlinks.value = await fetchBacklinks(target)
    } catch (err) {
      errors.value.backlinks = err.message
    } finally {
      loading.value.backlinks = false
    }
  }

  async function loadBacklinksHistory(target, weeks = 10) {
    loading.value.backlinksHistory = true
    errors.value.backlinksHistory = null
    try {
      backlinksHistory.value = await fetchBacklinksHistory(target, weeks)
    } catch (err) {
      errors.value.backlinksHistory = err.message
    } finally {
      loading.value.backlinksHistory = false
    }
  }

  async function loadGscCoverage(siteUrl) {
    loading.value.gscCoverage = true
    errors.value.gscCoverage = null
    try {
      gscCoverage.value = await fetchGscCoverage(siteUrl)
    } catch (err) {
      errors.value.gscCoverage = err.message
    } finally {
      loading.value.gscCoverage = false
    }
  }

  async function loadGscMobile(siteUrl, startDate, endDate) {
    loading.value.gscMobile = true
    errors.value.gscMobile = null
    try {
      gscMobile.value = await fetchGscMobile(siteUrl, startDate, endDate)
    } catch (err) {
      errors.value.gscMobile = err.message
    } finally {
      loading.value.gscMobile = false
    }
  }

  async function loadGscStructuredData(siteUrl, startDate, endDate) {
    loading.value.gscStructuredData = true
    errors.value.gscStructuredData = null
    try {
      gscStructuredData.value = await fetchGscStructuredData(siteUrl, startDate, endDate)
    } catch (err) {
      errors.value.gscStructuredData = err.message
    } finally {
      loading.value.gscStructuredData = false
    }
  }

  function loadAll(propertyId, siteUrl, startDate, endDate, ahrefsTarget) {
    const promises = []
    if (propertyId) {
      promises.push(loadTotalTraffic(propertyId, startDate, endDate))
      promises.push(loadTrafficBySource(propertyId, startDate, endDate))
      promises.push(loadTrafficBySourceOverTime(propertyId, startDate, endDate))
      promises.push(loadTrafficFromUS(propertyId, startDate, endDate))
      promises.push(loadTrafficDrivers(propertyId, startDate, endDate))
      promises.push(loadTrafficUSBySource(propertyId, startDate, endDate))
      promises.push(loadTrafficUSBySourceOverTime(propertyId, startDate, endDate))
    }
    if (siteUrl) {
      promises.push(loadImpressions(siteUrl, startDate, endDate))
      promises.push(loadKeywordRankings(siteUrl, startDate, endDate))
      promises.push(loadGscCoverage(siteUrl))
      promises.push(loadGscMobile(siteUrl, startDate, endDate))
      promises.push(loadGscStructuredData(siteUrl, startDate, endDate))
    }
    if (ahrefsTarget) {
      promises.push(loadDomainRating(ahrefsTarget, endDate))
      promises.push(loadSiteHealth(ahrefsTarget))
      promises.push(loadSiteAuditIssues(ahrefsTarget))
      promises.push(loadBacklinks(ahrefsTarget))
      // loadBacklinksHistory removed from auto-fetch — costs 500 API units (10 weeks x 50 units each)
      // Call manually via refreshBacklinksHistory() only when needed
    }
    return Promise.allSettled(promises)
  }

  return {
    totalTraffic,
    trafficBySource,
    newVsReturning,
    trafficBySourceOverTime,
    trafficFromUS,
    trafficDrivers,
    impressions,
    keywordRankings,
    domainRating,
    siteHealth,
    siteAuditIssues,
    trafficUSBySource,
    trafficUSBySourceOverTime,
    backlinks,
    backlinksHistory,
    gscCoverage,
    gscMobile,
    gscStructuredData,
    loading,
    errors,
    loadTotalTraffic,
    loadTrafficBySource,
    loadNewVsReturning,
    loadTrafficBySourceOverTime,
    loadTrafficFromUS,
    loadTrafficDrivers,
    loadImpressions,
    loadKeywordRankings,
    loadDomainRating,
    loadSiteHealth,
    loadSiteAuditIssues,
    loadTrafficUSBySource,
    loadTrafficUSBySourceOverTime,
    loadBacklinks,
    loadBacklinksHistory,
    loadGscCoverage,
    loadGscMobile,
    loadGscStructuredData,
    loadAll,
  }
})
