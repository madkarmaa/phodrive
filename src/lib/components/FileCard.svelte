<script lang="ts">
    import { Card } from 'noph-ui';
    import type { FileActionKind } from '$lib/models';

    import type { FileGroup } from '$lib/files';
    import { fileType } from '$lib/files';
    import FileActions from '$components/FileActions.svelte';
    import IconDescription from '~icons/material-symbols/description';
    import IconDescriptionOutline from '~icons/material-symbols/description-outline';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
    }

    let { item, disabled, working, ondownload, ondelete }: Props = $props();
</script>

<Card type="text" variant="filled" class="file-card">
    <div class="flex h-12 min-w-0 items-center gap-3 px-3">
        <IconDescription aria-hidden="true" class="size-5 shrink-0 text-primary" />
        <h3 class="min-w-0 flex-1 truncate text-sm font-medium" title={item.name}>{item.name}</h3>
    </div>

    <div
        class="file-preview mx-2 mb-2 grid place-items-center rounded bg-preview"
        aria-hidden="true"
    >
        <div class="relative size-22 text-primary">
            <IconDescriptionOutline class="size-22" />
            <span
                class="absolute top-13 left-3 w-16 truncate rounded bg-preview text-center text-xs font-bold"
                >{fileType(item.name)}</span
            >
        </div>
    </div>

    <div class="flex justify-end px-2 pb-2">
        <FileActions {item} {disabled} {working} {ondownload} {ondelete} />
    </div>

    {#if !item.complete}
        <p class="m-0 px-3 pb-2 text-xs text-muted">
            {item.chunks.length}/{item.chunkCount ?? '?'} chunks
        </p>
    {/if}
</Card>

<style>
    :global(:root .file-card.np-card-container) {
        width: 100%;
        container-type: inline-size;
        min-width: 0;
        overflow: hidden;
        --np-filled-card-container-color: var(--app-card);
        --np-filled-card-container-shape: 12px;
    }

    :global(:root .file-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        min-width: 0;
        width: 100%;
    }
    .file-preview {
        height: calc(100cqi - 96px);
        min-height: 150px;
    }
</style>
