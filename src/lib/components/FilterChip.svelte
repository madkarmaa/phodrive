<script lang="ts" generics="Value extends string">
    import type { Snippet } from 'svelte';
    import { Select } from 'noph-ui';

    interface Props {
        label: string;
        ariaLabel: string;
        value: Value;
        options: readonly { value: Value; label: string }[];
        icon: Snippet;
        class?: string;
    }

    let {
        label,
        ariaLabel,
        value = $bindable(),
        options,
        icon,
        class: className = ''
    }: Props = $props();
    const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? '');

    // Narrow the library's untyped binding against the application's typed options.
    function selectValue(candidate: unknown) {
        const selected = options.find((option) => option.value === candidate);
        if (!selected) return;

        value = selected.value;
    }
</script>

<div class={['filter-chip', className]} title={`${label}: ${selectedLabel}`}>
    <Select
        aria-label={ariaLabel}
        options={[...options]}
        bind:value={() => value, selectValue}
        clampMenuWidth
    >
        {#snippet start()}
            <span class="filter-label" aria-hidden="true">{label}</span>
            <span class="filter-icon" aria-hidden="true">{@render icon()}</span>
        {/snippet}
    </Select>
</div>

<style>
    .filter-chip {
        flex-shrink: 0;
        min-width: 0;
    }
    .filter-icon {
        display: none;
    }
    .filter-label {
        font-size: 13px;
    }
    .filter-chip :global(.np-text-field) {
        width: 100%;
        min-width: 0;
        --np-select-min-width: 0px;
        --np-outlined-select-text-field-container-shape: 8px;
    }
    .filter-chip :global(.field) {
        min-height: 32px;
        height: 32px;
        font-size: 13px;
    }
    .filter-chip :global(.start) {
        margin-inline: 10px 12px;
    }
    .filter-chip :global(.np-text-field .content .input) {
        display: flex;
        align-items: center;
        box-sizing: border-box;
        height: 32px;
        font-size: 13px;
        padding: 0;
    }
    .filter-chip :global(.end) {
        margin-inline: 4px 6px;
    }

    @media (max-width: 520px) {
        .filter-chip {
            width: 44px;
        }
        .filter-icon {
            display: grid;
            place-items: center;
        }
        .filter-label {
            display: none;
        }
        .filter-chip :global(.field) {
            height: 44px;
            min-height: 44px;
        }
        .filter-chip :global(.start) {
            margin: auto;
        }
        .filter-chip :global(.middle),
        .filter-chip :global(.end) {
            display: none;
        }
    }
</style>
