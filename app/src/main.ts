import App from './App.svelte';
import { initCapabilitySnapshot } from './lib/capability-snapshot';

const target = document.getElementById('app');
if (!target) {
  throw new Error('Missing #app mount target in index.html');
}

initCapabilitySnapshot().catch(() => {
  // Snapshot stays at EMPTY_SNAPSHOT; the app continues with Pyodide routing.
});

new App({ target });
