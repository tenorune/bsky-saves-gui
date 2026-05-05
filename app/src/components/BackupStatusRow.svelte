<script lang="ts">
  import BackupRow from './BackupRow.svelte';

  export let inventory: unknown;
</script>

<BackupRow domain="images" {inventory} mode="library" />
<BackupRow domain="articles" {inventory} mode="library" />
