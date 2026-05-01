<script lang="ts">
  import { navigate } from '$lib/router';
</script>

<section class="route route--not-found">
  <h2>Not found</h2>
  <p>That page doesn't exist.</p>
  <button type="button" on:click={() => navigate('/')}>Go home</button>
</section>
