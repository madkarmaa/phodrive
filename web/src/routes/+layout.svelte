<script lang="ts">
    import { onMount, type Snippet } from 'svelte';
    import { APP_MOTTO, APP_NAME } from '#lib/app';
    import { removeLegacyCredentials } from '#browser/storage';
    import './theme.css';
    import './layout.css';
    import '@fontsource-variable/google-sans-flex/opsz.css';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();

    onMount(() => {
        // Blocked storage cannot hold old tokens either, so there is nothing else to do.
        removeLegacyCredentials().inspectErr(() => {});
    });
</script>

<svelte:head>
    <title>{APP_NAME} - {APP_MOTTO}</title>
</svelte:head>

{@render children()}
