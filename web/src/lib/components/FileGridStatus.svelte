<script lang="ts">
    import { LoadingIndicator } from 'noph-ui';
    import EmptyFiles from '#components/EmptyFiles.svelte';

    interface Props {
        loading: boolean;
        loadFailed: boolean;
        /** Files exist, but the search or filters hide all of them. */
        filteredOut: boolean;
    }

    let { loading, loadFailed, filteredOut }: Props = $props();
</script>

<div class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted">
    {#if loading}
        <LoadingIndicator aria-label="Loading Google Photos files" />
    {:else if loadFailed}
        <p>Use Refresh to try loading your files again.</p>
    {:else if filteredOut}
        <p>No files match your search or filters.</p>
    {:else}
        <EmptyFiles />
    {/if}
</div>
