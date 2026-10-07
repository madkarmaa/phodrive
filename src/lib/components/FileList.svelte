<script lang="ts">
    import { Button } from 'noph-ui';
    import prettyBytes from 'pretty-bytes';
    import { FileSort } from '$lib/models';
    import { fileKey, type FileGroup, type FileAction } from '$lib/files';
    import LocalizedDate from '$components/LocalizedDate.svelte';
    import FileActions from '$components/FileActions.svelte';
    import IconDescription from '~icons/material-symbols/description';
    import IconArrowUp from '~icons/material-symbols/arrow-upward';
    import IconArrowDown from '~icons/material-symbols/arrow-downward';

    interface Props {
        files: FileGroup[];
        sort: FileSort;
        disabled: boolean;
        action: FileAction | null;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
    }

    let { files, sort = $bindable(), disabled, action, ondownload, ondelete }: Props = $props();
    const nameSort = $derived(sort === FileSort.NameAscending || sort === FileSort.NameDescending);
    const ascending = $derived(
        sort === FileSort.NameAscending || sort === FileSort.ModifiedAscending
    );
</script>

<table class="file-list" aria-labelledby="files-heading">
    <thead>
        <tr>
            <th
                scope="col"
                aria-sort={nameSort ? (ascending ? 'ascending' : 'descending') : 'none'}
            >
                <Button
                    class="column-sort"
                    size="xs"
                    variant="text"
                    onclick={() =>
                        (sort =
                            sort === FileSort.NameAscending
                                ? FileSort.NameDescending
                                : FileSort.NameAscending)}
                >
                    Name
                    {#snippet end()}
                        {#if nameSort}
                            {#if ascending}<IconArrowUp aria-hidden="true" />{:else}<IconArrowDown
                                    aria-hidden="true"
                                />{/if}
                        {/if}
                    {/snippet}
                </Button>
            </th>
            <th
                scope="col"
                class="date-column"
                aria-sort={!nameSort ? (ascending ? 'ascending' : 'descending') : 'none'}
            >
                <Button
                    class="column-sort"
                    size="xs"
                    variant="text"
                    onclick={() =>
                        (sort =
                            sort === FileSort.ModifiedDescending
                                ? FileSort.ModifiedAscending
                                : FileSort.ModifiedDescending)}
                >
                    Date modified
                    {#snippet end()}
                        {#if !nameSort}
                            {#if ascending}<IconArrowUp aria-hidden="true" />{:else}<IconArrowDown
                                    aria-hidden="true"
                                />{/if}
                        {/if}
                    {/snippet}
                </Button>
            </th>
            <th scope="col" class="size-column">File size</th>
            <th scope="col" class="actions-column"><span class="sr-only">Actions</span></th>
        </tr>
    </thead>
    <tbody>
        {#each files as item (fileKey(item))}
            <tr>
                <td>
                    <div class="file-name">
                        <IconDescription aria-hidden="true" class="size-5 shrink-0 text-primary" />
                        <div class="min-w-0">
                            <span class="block truncate font-medium" title={item.name}
                                >{item.name}</span
                            >
                            {#if !item.complete}
                                <span class="text-xs text-muted"
                                    >{item.chunks.length}/{item.chunkCount ?? '?'} chunks</span
                                >
                            {:else}
                                <span class="mobile-date text-xs text-muted"
                                    ><LocalizedDate timestamp={item.at} /></span
                                >
                            {/if}
                        </div>
                    </div>
                </td>
                <td class="date-column"><LocalizedDate timestamp={item.at} /></td>
                <td class="size-column">
                    {#if item.complete}
                        {prettyBytes(item.chunks.reduce((sum, chunk) => sum + chunk.size, 0))}
                    {:else}<span aria-label="File size unavailable until all chunks are loaded"
                            >—</span
                        >{/if}
                </td>
                <td class="actions-column">
                    <FileActions
                        {item}
                        {disabled}
                        compact
                        working={action?.fileId === item.fileId ? action.kind : null}
                        {ondownload}
                        {ondelete}
                    />
                </td>
            </tr>
        {/each}
    </tbody>
</table>

<style>
    .file-list {
        width: 100%;
        table-layout: fixed;
        border-collapse: collapse;
        margin-top: 12px;
        font-size: 14px;
    }

    th,
    td {
        height: 48px;
        border-bottom: 1px solid var(--np-color-outline-variant);
        padding: 4px 12px;
        text-align: start;
        vertical-align: middle;
    }

    th {
        font-weight: 500;
    }

    td:not(:first-child) {
        color: var(--np-color-on-surface-variant);
    }

    tbody tr:hover,
    tbody tr:focus-within {
        background: var(--np-color-surface-container);
    }

    .file-name {
        display: flex;
        align-items: center;
        gap: 16px;
        min-width: 0;
    }

    .date-column {
        width: 180px;
    }
    .size-column {
        width: 100px;
        white-space: nowrap;
    }
    .actions-column {
        width: 72px;
        padding-inline: 4px;
    }
    .mobile-date {
        display: none;
    }

    .file-list :global(.column-sort) {
        --np-button-padding: 12px;
        --np-button-gap: 4px;
        --np-button-icon-size: 18px;
        --np-text-button-label-text-color: var(--np-color-on-surface);
        margin-inline: -12px;
        font-size: 14px;
    }

    @media (width < 800px) {
        .date-column {
            display: none;
        }
        .mobile-date {
            display: block;
        }
        .size-column {
            width: 76px;
        }
        th,
        td {
            padding-inline: 4px;
        }
        .file-name {
            gap: 8px;
        }
        tbody td {
            height: 56px;
        }
    }
</style>
