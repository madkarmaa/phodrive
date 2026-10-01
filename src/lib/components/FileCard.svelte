<script lang="ts">
    import { Button, Card } from 'noph-ui';
    import { FileActionKind } from '$lib/models';

    import type { FileGroup } from '$lib/file-groups';
    import { fileType } from '$lib/file-groups';
    import LocalizedDate from '$components/LocalizedDate.svelte';
    import IconDescription from '~icons/material-symbols/description';
    import IconDescriptionOutline from '~icons/material-symbols/description-outline';
    import IconDownload from '~icons/material-symbols/download';
    import IconDelete from '~icons/material-symbols/delete-outline';

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
    <div class="flex h-12 min-w-0 items-center gap-3.5 px-5">
        <IconDescription aria-hidden="true" class="size-5.5 shrink-0 text-primary" />
        <h3 class="min-w-0 truncate text-[15px] font-medium" title={item.name}>{item.name}</h3>
    </div>

    <div class="mx-2.5 grid h-55 place-items-center rounded-md bg-preview" aria-hidden="true">
        <div class="relative size-22 text-primary">
            <IconDescriptionOutline class="size-22" />
            <span
                class="absolute top-13 left-3 w-16 truncate rounded bg-preview text-center text-xs font-bold"
                >{fileType(item.name)}</span
            >
        </div>
    </div>

    <div class="flex min-h-12 items-center justify-between gap-1 px-3 py-1 text-xs text-muted">
        <span>
            {#if item.complete}
                <LocalizedDate timestamp={item.at} />
            {:else}
                {item.chunks.length}/{item.chunkCount ?? '?'} chunks
            {/if}
        </span>
        <div class="flex items-center">
            <Button
                variant="text"
                size="xs"
                disabled={disabled || !item.complete}
                onclick={() => ondownload(item)}
            >
                {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
                {working === FileActionKind.Download ? 'Working…' : 'Download'}
            </Button>
            <Button variant="text" size="xs" {disabled} onclick={() => ondelete(item)}>
                {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
                {working === FileActionKind.Delete ? 'Working…' : 'Delete'}
            </Button>
        </div>
    </div>
</Card>

<style>
    :global(:root .file-card.np-card-container) {
        width: 100%;
        min-width: 0;
        overflow: hidden;
        --np-filled-card-container-color: var(--app-card);
        --np-filled-card-container-shape: 14px;
    }

    :global(:root .file-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        min-width: 0;
        width: 100%;
    }
    :global(:root .file-card.np-card-container .np-button) {
        font-size: 12px;
        --np-button-padding: 7px;
        --np-button-gap: 4px;
        --np-button-icon-size: 16px;
    }
</style>
