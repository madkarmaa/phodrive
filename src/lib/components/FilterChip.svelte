<script lang="ts" generics="Value extends string">
    import { Button, Menu, MenuItem } from 'noph-ui';
    import IconArrow from '~icons/material-symbols/arrow-drop-down';
    import IconCheck from '~icons/material-symbols/check';
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
    let menuElement = $state<HTMLDivElement>();
    let menu = $state<ReturnType<typeof Menu>>();

    function selectValue(selected: Value) {
        value = selected;
        menu?.close();
        anchor?.focus();
    }

    function focusSelection() {
        const selected = menuElement?.querySelector<HTMLElement>('[aria-current="true"]');
        const first = menuElement?.querySelector<HTMLElement>('[role="menuitem"]');
        (selected ?? first)?.focus();
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
        onkeydown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;

            event.preventDefault();
            if (open) {
                focusSelection();
                return;
            }
            menu?.show();
        }}
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

    <Menu
        {id}
        {anchor}
        bind:this={menu}
        bind:element={menuElement}
        bind:open
        coverAnchor={false}
        class="filter-menu"
        aria-label={ariaLabel}
        onkeydown={(event) => {
            if (event.key !== 'Escape') return;

            event.preventDefault();
            menu?.close();
            anchor?.focus();
        }}
        ontoggle={(event) => {
            if (event.newState === 'open') focusSelection();
        }}
    >
        {#each options as option (option.value)}
            <MenuItem
                aria-current={option.value === value ? 'true' : undefined}
                onclick={() =>
                    selectValue(
                        resetOnReselect && option.value === value ? defaultValue : option.value
                    )}
            >
                {#snippet start()}
                    <span class="option-check" aria-hidden="true">
                        {#if option.value === value}<IconCheck />{/if}
                    </span>
                {/snippet}
                {option.label}
            </MenuItem>
        {/each}
    </Menu>
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

    .filter-chip :global(.filter-menu) {
        position-anchor: --filter-chip;
        min-width: 210px;
        max-width: min(320px, calc(100vw - 24px));
        --np-menu-container-color: var(--app-panel);
        --np-menu-container-shape: 8px;
        --np-menu-position-area: bottom span-right;
        --np-menu-justify-self: start;
    }

    .filter-chip :global(.filter-menu .np-item) {
        min-height: 40px;
        padding-block: 8px;
    }

    .filter-chip :global(.filter-menu .np-item-headline) {
        font-size: 14px;
        line-height: 24px;
    }

    .option-check {
        display: grid;
        place-items: center;
        width: 20px;
        height: 20px;
    }

    .option-check :global(svg) {
        width: 20px;
        height: 20px;
    }
</style>
