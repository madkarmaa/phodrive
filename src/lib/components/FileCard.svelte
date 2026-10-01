<script lang="ts">
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
        working: 'download' | 'delete' | null;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
    }

    let { item, disabled, working, ondownload, ondelete }: Props = $props();
</script>

<article class="min-w-0 overflow-hidden rounded-[14px] bg-card transition-shadow hover:shadow-md">
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
            <button
                class="file-action"
                type="button"
                disabled={disabled || !item.complete}
                onclick={() => ondownload(item)}
            >
                <IconDownload aria-hidden="true" class="size-4" />{working === 'download'
                    ? 'Working…'
                    : 'Download'}
            </button>
            <button class="file-action" type="button" {disabled} onclick={() => ondelete(item)}
                ><IconDelete aria-hidden="true" class="size-4" />{working === 'delete'
                    ? 'Working…'
                    : 'Delete'}</button
            >
        </div>
    </div>
</article>
