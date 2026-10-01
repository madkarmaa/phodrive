<script lang="ts">
    import { Button } from 'm3-svelte';
    import { fade } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { FileGroup, FileAction } from '$lib/file-groups';
    import FileCard from '$components/FileCard.svelte';
    import IconFolderOpen from '~icons/material-symbols/folder-open-outline';

    interface Props {
        files: FileGroup[];
        loading: boolean;
        message: string;
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
        loading,
        message,
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

<section aria-labelledby="files-heading">
    {#if message}<p role="alert" class="my-3.5 text-sm text-error">{message}</p>{/if}

    {#if files.length}
        <ul
            class="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-5 p-0 max-[520px]:grid-cols-1"
        >
            {#each files as item (item.email + ':' + item.fileHash)}
                <li
                    class="min-w-0"
                    animate:flip={{ duration: prefersReducedMotion.current ? 0 : 180 }}
                    transition:fade={{ duration: prefersReducedMotion.current ? 0 : 150 }}
                >
                    <FileCard
                        {item}
                        {disabled}
                        working={action?.fileHash === item.fileHash ? action.kind : null}
                        {ondownload}
                        {ondelete}
                    />
                </li>
            {/each}
        </ul>
    {:else}
        <div class="grid justify-items-center gap-3 px-6 py-22.5 text-center text-sm text-muted">
            {#if loading}
                <p>Loading Google Photos files…</p>
            {:else if message}
                <p>Use Refresh to try loading your files again.</p>
            {:else if filtered && hasFiles}
                <p>No files match your search or filters.</p>
            {:else}
                <IconFolderOpen aria-hidden="true" class="size-12" />
                <h3 class="text-lg text-text">No files yet</h3>
                <p>Choose Upload to add your first file.</p>
            {/if}
        </div>
    {/if}

    {#if hasMore}
        <div class="mt-6 flex justify-center">
            <Button variant="outlined" disabled={loading || disabled} onclick={onmore}
                >{loading ? 'Loading…' : 'Load more'}</Button
            >
        </div>
    {/if}
</section>
