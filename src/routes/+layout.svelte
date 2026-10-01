<script lang="ts">
    import type { Snippet } from 'svelte';
    import './layout.css';
    import 'm3-svelte/etc/styles.css';
    import 'm3-svelte/etc/recommended-styles.css';
    import '@fontsource-variable/google-sans-flex/opsz.css';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

{@render children()}
