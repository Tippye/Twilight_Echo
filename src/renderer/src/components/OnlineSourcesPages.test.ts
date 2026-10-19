import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const networkSources = readFileSync(new URL('./NetworkSourcesPage.vue', import.meta.url), 'utf8')
const radioPodcast = readFileSync(new URL('./RadioPodcastPage.vue', import.meta.url), 'utf8')

test('network sources separates source management from the primary music browsing flow', () => {
  assert.match(networkSources, /class="network-page-heading"/)
  assert.match(networkSources, /class="network-section-heading network-profiles-heading"/)
  assert.match(networkSources, /class="network-profile-card"/)
  assert.match(networkSources, /class="network-directory-actions"/)
  assert.match(networkSources, /class="network-library-search"/)
  // No page-level back button anymore: the title bar owns navigation back and
  // the browse layer registers its "up one directory / leave browse" handler.
  assert.doesNotMatch(networkSources, /data-te-page-back-button=/)
  assert.match(networkSources, /useBackHandler/)
  assert.match(networkSources, /@click="enterBrowse\(profile\)"/)
  assert.match(networkSources, /@click="playAllInDirectory"/)
  // Regression for issue #94: number inputs feed a number into `v-model`, so the
  // port must be normalized instead of calling string methods on it.
  assert.match(networkSources, /parseOptionalPort\(form\.value\.port\)/)
  assert.doesNotMatch(networkSources, /form\.value\.port\.trim\(\)/)
})

test('radio and podcast pages keep collections prominent and creation tools secondary', () => {
  assert.match(radioPodcast, /class="radio-workspace"/)
  assert.match(radioPodcast, /class="radio-tools"/)
  assert.match(radioPodcast, /class="station-collection"/)
  assert.match(radioPodcast, /class="podcast-subscribe-card"/)
  assert.match(radioPodcast, /class="podcast-layout"/)
  // Page back lives on the title bar; this page must not carry its own.
  assert.doesNotMatch(radioPodcast, /data-te-page-back-button=/)
  assert.match(radioPodcast, /@click="playStation\(station\.id\)"/)
  assert.match(radioPodcast, /@click="playEpisode\(selectedPodcast, episode\.guid\)"/)
})
