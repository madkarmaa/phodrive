<script lang="ts">
    import FilterChip from '#components/FilterChip.svelte';
    import { Button } from 'noph-ui';
    import { DEFAULT_FILE_SORT, FileSort } from '#lib/models';

    interface Props {
        types: string[];
        type?: string;
        days?: string;
        sort?: FileSort;
    }

    let {
        types,
        type = $bindable(''),
        days = $bindable(''),
        sort = $bindable(DEFAULT_FILE_SORT)
    }: Props = $props();

    const availableTypes = $derived(type && !types.includes(type) ? [...types, type] : types);

    const typeOptions = $derived([
        { value: '', label: 'All' },
        ...availableTypes.map((value) => ({ value, label: value }))
    ]);

    const MODIFIED_OPTIONS = [
        { value: '', label: 'Any time' },
        { value: '7', label: 'Last 7 days' },
        { value: '30', label: 'Last 30 days' },
        { value: '365', label: 'Last year' }
    ];

    const SORT_OPTIONS: readonly { value: FileSort; label: string }[] = [
        { value: FileSort.NameAscending, label: 'Name A–Z' },
        { value: FileSort.NameDescending, label: 'Name Z–A' },
        { value: FileSort.ModifiedDescending, label: 'Newest first' },
        { value: FileSort.ModifiedAscending, label: 'Oldest first' }
    ];
</script>

<div class="flex min-h-13.5 flex-wrap items-start gap-2 pt-1 pb-3" aria-label="File filters">
    <FilterChip
        label="Type"
        ariaLabel="Filter by file type"
        defaultValue=""
        options={typeOptions}
        bind:value={type}
    />
    <FilterChip
        label="Modified"
        ariaLabel="Filter by modified date"
        defaultValue=""
        options={MODIFIED_OPTIONS}
        bind:value={days}
    />
    <FilterChip
        label="Sort"
        ariaLabel="Sort files"
        defaultValue={DEFAULT_FILE_SORT}
        resetOnReselect={false}
        options={SORT_OPTIONS}
        bind:value={sort}
    />
    {#if type || days}
        <Button
            variant="text"
            size="xs"
            onclick={() => {
                type = '';
                days = '';
            }}>Clear filters</Button
        >
    {/if}
</div>
