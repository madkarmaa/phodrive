<script lang="ts" generics="Value extends string">
    import { Button } from 'noph-ui';
    import FilterMenu from '#components/FilterMenu.svelte';
    import IconArrow from '~icons/material-symbols/arrow-drop-down';
    import IconClose from '~icons/material-symbols/close';

    interface Props {
        label: string;
        ariaLabel: string;
        value: Value;
        defaultValue: Value;
        resetOnReselect?: boolean;
        options: readonly { value: Value; label: string }[];
    }

    let {
        label,
        ariaLabel,
        value = $bindable(),
        defaultValue,
        resetOnReselect = true,
        options
    }: Props = $props();
    const id = $props.id();
    const active = $derived(value !== defaultValue);
    const selectedLabel = $derived(
        options.find((option) => option.value === value)?.label ?? label
    );
    let open = $state(false);
    let anchor = $state<HTMLElement>();
    let menu = $state<FilterMenu<Value>>();

    function selectValue(selected: Value) {
        value = selected;
        menu?.close();
        anchor?.focus();
    }

    /** Choosing the current value again clears the filter, unless it must stay selected. */
    function choose(option: Value) {
        selectValue(resetOnReselect && option === value ? defaultValue : option);
    }

    /** Arrow keys open the menu, or move focus into it when it is already open. */
    function openWithArrows(event: KeyboardEvent) {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

        event.preventDefault();
        if (open) menu?.focusSelection();
        else menu?.show();
    }
</script>

<div class="filter-chip" class:active role="group" aria-label={label}>
    <Button
        class="filter-trigger"
        variant={active ? 'tonal' : 'outlined'}
        size="xs"
        shape="square"
        type="button"
        bind:element={anchor}
        aria-label={active ? `${ariaLabel}: ${selectedLabel}` : ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        command="toggle-popover"
        commandfor={id}
        onkeydown={openWithArrows}
    >
        {active ? selectedLabel : label}
        {#snippet end()}<IconArrow aria-hidden="true" />{/snippet}
    </Button>

    {#if active}
        <Button
            class="filter-clear"
            variant="tonal"
            size="xs"
            shape="square"
            type="button"
            aria-label={`Clear ${label.toLowerCase()}`}
            onclick={() => selectValue(defaultValue)}
        >
            {#snippet start()}<IconClose aria-hidden="true" />{/snippet}
        </Button>
    {/if}

    <FilterMenu
        bind:this={menu}
        bind:open
        {id}
        {anchor}
        {ariaLabel}
        {value}
        {options}
        onchoose={choose}
    />
</div>

<style>
    .filter-chip {
        display: inline-flex;
        max-width: 100%;
        min-width: 0;
        flex-shrink: 0;
        anchor-scope: --filter-chip;
        --np-button-shape: 8px;
        --np-button-gap: 8px;
        --np-button-icon-size: 24px;
        --np-outlined-button-outline-color: var(--np-color-outline);
        --np-outlined-button-label-text-color: var(--np-color-on-surface-variant);
        --np-tonal-button-container-color: var(--app-selected);
        --np-tonal-button-label-text-color: var(--app-selected-text);
    }

    .filter-chip :global(.filter-trigger) {
        anchor-name: --filter-chip;
        min-width: 0;
        max-width: 100%;
        height: 32px;
        padding-inline: 16px 8px;
        font-size: 14px;
        line-height: 16px;
        border-radius: 8px;
        box-shadow: none;
    }

    .filter-chip.active :global(.filter-trigger.np-button) {
        border-start-end-radius: 0;
        border-end-end-radius: 0;
    }

    .filter-chip :global(.filter-clear.np-button) {
        flex-shrink: 0;
        width: 32px;
        height: 32px;
        padding: 4px;
        margin-inline-start: 1px;
        border-radius: 0;
        border-start-end-radius: 8px;
        border-end-end-radius: 8px;
        box-shadow: none;
    }
</style>
