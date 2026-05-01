import ArchiveApp from './ArchiveApp.svelte';

const target = document.getElementById('archive');
if (!target) {
  throw new Error('Missing #archive mount target');
}

new ArchiveApp({ target });
