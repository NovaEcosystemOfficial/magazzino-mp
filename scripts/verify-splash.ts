import assert from 'node:assert/strict'
import { SPLASH_SEEN_STORAGE_KEY } from '../src/splash/splashPreference.ts'

assert.equal(SPLASH_SEEN_STORAGE_KEY, 'magazzino-mp-splash-seen')
assert.ok(!SPLASH_SEEN_STORAGE_KEY.includes('indexeddb'))
assert.ok(!SPLASH_SEEN_STORAGE_KEY.includes('articles'))

console.log('SPLASH_PREFERENCE_CHECKS_OK')
