import App from './App.svelte';
import { initCapabilitySnapshot } from './lib/capability-snapshot';
import { loadInstallHintPref } from './lib/install-hint-pref';
import { loadAssetToggles } from './lib/asset-toggles';
import { loadRetainMode } from './lib/retain-mode';
import { loadPanelCollapse } from './lib/panel-collapse-pref';
import { initPairingToken } from './lib/pairing-token';
import { initStatusPusher } from './lib/status-pusher';
import { registerServiceWorker } from './lib/sw-register';
import { initStoragePersist } from './lib/storage-persist';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount target in index.html');
}

initCapabilitySnapshot().catch(() => {
  // Snapshot stays at EMPTY_SNAPSHOT; the app continues with Pyodide routing.
});

// Hydrate persisted user preferences at startup so every route reads the
// same value from the first render (avoids visual flips when the user
// navigates between routes that load these prefs at different times).
loadInstallHintPref().catch(() => { /* keep default */ });
loadAssetToggles().catch(() => { /* keep defaults */ });
// Without this, the Library's "Show" filter renders from the default
// retain mode until Settings (which also loads it) is visited — dropping
// mode-specific options like "Unsaved" after a fresh page load.
loadRetainMode().catch(() => { /* keep default */ });
// The Backups and Filters collapsibles read from this on first render —
// hydrating after mount would briefly flash both panels open before
// snapping shut to the user's persisted preference.
loadPanelCollapse().catch(() => { /* keep defaults */ });
// Synchronous: read the helper pairing token from the served meta tag
// (wheel-served path) or from localStorage (hosted-PWA path) before the
// first render. Falls through to 'unpaired' silently if neither path
// yields a valid token; the PairingRequiredBanner takes over from there
// when the capability snapshot reports a detected helper.
initPairingToken();
initStatusPusher();

initStoragePersist();
registerServiceWorker();

new App({ target });
