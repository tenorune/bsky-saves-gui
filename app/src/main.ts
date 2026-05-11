import App from './App.svelte';
import { initCapabilitySnapshot } from './lib/capability-snapshot';
import { loadInstallHintPref } from './lib/install-hint-pref';
import { loadAssetToggles } from './lib/asset-toggles';
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

initStoragePersist();
registerServiceWorker();

new App({ target });
