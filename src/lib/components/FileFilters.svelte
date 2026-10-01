<script lang="ts">
    import FilterChip from '$components/FilterChip.svelte';
    import { DEFAULT_FILE_SORT, FileSort } from '$lib/models';
    import IconType from '~icons/material-symbols/category-outline';
    import IconModified from '~icons/material-symbols/schedule';
    import IconSort from '~icons/material-symbols/sort';

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

<div class="flex min-h-13.5 flex-wrap gap-2 pt-1 pb-3" aria-label="File filters">
    <FilterChip
        label="Type"
        ariaLabel="Filter by file type"
        class="w-36"
        options={typeOptions}
        bind:value={type}
    >
        {#snippet icon()}<IconType class="size-5.5" />{/snippet}
    </FilterChip>
    <FilterChip
        label="Modified"
        ariaLabel="Filter by modified date"
        class="w-54"
        options={MODIFIED_OPTIONS}
        bind:value={days}
    >
        {#snippet icon()}<IconModified class="size-5.5" />{/snippet}
    </FilterChip>
    <FilterChip
        label="Sort"
        ariaLabel="Sort files"
        class="w-50"
        options={SORT_OPTIONS}
        bind:value={sort}
    >
        {#snippet icon()}<IconSort class="size-5.5" />{/snippet}
    </FilterChip>
</div>
