<script lang="ts">
    import type { Snippet } from 'svelte';
    import { APP_MOTTO, APP_NAME } from '$lib/app-info';
    import './theme.css';
    import './layout.css';
    import '@fontsource-variable/google-sans-flex/opsz.css';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

<svelte:head>
    <title>{APP_NAME} - {APP_MOTTO}</title>
</svelte:head>

{@render children()}
