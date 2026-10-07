<script lang="ts">
    import { Button, IconButton } from 'noph-ui';
    import { FileActionKind } from '$lib/models';
    import type { FileGroup } from '$lib/files';
    import IconDownload from '~icons/material-symbols/download';
    import IconDelete from '~icons/material-symbols/delete-outline';

    interface Props {
        item: FileGroup;
        disabled: boolean;
        working: FileActionKind | null;
        compact?: boolean;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
    }

    let { item, disabled, working, compact = false, ondownload, ondelete }: Props = $props();
</script>

<div class="file-actions flex shrink-0 items-center">
    {#if compact}
        <IconButton
            size="xs"
            title={`Download ${item.name}`}
            disabled={disabled || !item.complete}
            loading={working === FileActionKind.Download}
            loadingAriaLabel={`Downloading ${item.name}`}
            onclick={() => ondownload(item)}><IconDownload aria-hidden="true" /></IconButton
        >
        <IconButton
            size="xs"
            title={`Delete ${item.name}`}
            {disabled}
            loading={working === FileActionKind.Delete}
            loadingAriaLabel={`Deleting ${item.name}`}
            onclick={() => ondelete(item)}><IconDelete aria-hidden="true" /></IconButton
        >
    {:else}
        <Button
            variant="text"
            size="xs"
            disabled={disabled || !item.complete}
            loading={working === FileActionKind.Download}
            loadingAriaLabel={`Downloading ${item.name}`}
            onclick={() => ondownload(item)}
        >
            {#snippet start()}<IconDownload aria-hidden="true" />{/snippet}
            Download
        </Button>
        <Button
            variant="text"
            size="xs"
            {disabled}
            loading={working === FileActionKind.Delete}
            loadingAriaLabel={`Deleting ${item.name}`}
            onclick={() => ondelete(item)}
        >
            {#snippet start()}<IconDelete aria-hidden="true" />{/snippet}
            Delete
        </Button>
    {/if}
</div>

<style>
    .file-actions :global(.np-button) {
        font-size: 12px;
        --np-button-padding: 7px;
        --np-button-gap: 4px;
        --np-button-icon-size: 16px;
    }
</style>
