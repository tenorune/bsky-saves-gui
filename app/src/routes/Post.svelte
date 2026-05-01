<script lang="ts">
  import { currentRoute } from '$lib/router';
</script>

<section class="route route--post">
  <h2>Post</h2>
  <p>rkey: {$currentRoute.params.rkey ?? '(none)'}</p>
  <p>Focus view will be implemented in Plan 3.</p>
</section>
