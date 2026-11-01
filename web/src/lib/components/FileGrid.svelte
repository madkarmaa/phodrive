<script lang="ts">
    import { Button } from 'noph-ui';
    import { FileLayout, FileSort } from '@madkarmaa/phodrive-core/models';
    import type { FileGroup, FileAction } from '@madkarmaa/phodrive-core/files';
    import FileCardGrid from '#components/FileCardGrid.svelte';
    import FileGridStatus from '#components/FileGridStatus.svelte';
    import FileList from '#components/FileList.svelte';

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
    {#if !files.length}
        <FileGridStatus {loading} {loadFailed} filteredOut={filtered && hasFiles} />
    {:else if layout === FileLayout.List}
        <FileList {files} bind:sort {disabled} {action} {ondownload} {ondelete} />
    {:else}
        <FileCardGrid {files} {disabled} {action} {ondownload} {ondelete} />
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
