<script lang="ts">
    import { Button, LoadingIndicator } from 'noph-ui';
    import { FileLayout, FileSort } from '$lib/models';
    import { fade } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { FileGroup, FileAction } from '$lib/files';
    import { fileKey } from '$lib/files';
    import FileCard from '$components/FileCard.svelte';
    import FileList from '$components/FileList.svelte';
    import EmptyFiles from '$components/EmptyFiles.svelte';

    interface Props {
        files: FileGroup[];
        layout: FileLayout;
        sort: FileSort;
        loading: boolean;
        loadFailed: boolean;
        filtered: boolean;
        hasFiles: boolean;
        hasMore: boolean;
        disabled: boolean;
        action: FileAction | null;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
        onmore: () => void;
    }

    let {
        files,
        layout,
        sort = $bindable(),
        loading,
        loadFailed,
        filtered,
        hasFiles,
        hasMore,
        disabled,
        action,
        ondownload,
        ondelete,
        onmore
    }: Props = $props();
</script>

<section class="flex min-h-0 flex-1 flex-col" aria-labelledby="files-heading">
    {#if files.length}
        {#if layout === FileLayout.List}
            <FileList {files} bind:sort {disabled} {action} {ondownload} {ondelete} />
        {:else}
            <ul
                class="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0"
            >
                {#each files as item (fileKey(item))}
                    <li
                        class="min-w-0"
                        animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
                        transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
                    >
                        <FileCard
                            {item}
                            {disabled}
                            working={action?.fileId === item.fileId ? action.kind : null}
                            {ondownload}
                            {ondelete}
                        />
                    </li>
                {/each}
            </ul>
        {/if}
    {:else}
        <div
            class="grid min-h-90 flex-1 place-items-center px-6 py-12 text-center text-sm text-muted"
        >
            {#if loading}
                <LoadingIndicator aria-label="Loading Google Photos files" />
            {:else if loadFailed}
                <p>Use Refresh to try loading your files again.</p>
            {:else if filtered && hasFiles}
                <p>No files match your search or filters.</p>
            {:else}
                <EmptyFiles />
            {/if}
        </div>
    {/if}

    {#if hasMore}
        <div class="mt-6 flex justify-center">
            <Button
                variant="outlined"
                {loading}
                loadingAriaLabel="Loading more files"
                {disabled}
                onclick={onmore}
            >
                Load more
            </Button>
        </div>
    {/if}
</section>
