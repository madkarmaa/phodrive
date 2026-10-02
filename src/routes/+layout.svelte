<script lang="ts">
    import type { Snippet } from 'svelte';
    import './theme.css';
    import './layout.css';
    import '@fontsource-variable/google-sans-flex/opsz.css';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

{@render children()}
