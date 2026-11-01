<script lang="ts" generics="Value extends string">
    import { Menu, MenuItem } from 'noph-ui';
    import IconCheck from '~icons/material-symbols/check';

    interface Props {
        id: string;
        anchor: HTMLElement | undefined;
        ariaLabel: string;
        value: Value;
        options: readonly { value: Value; label: string }[];
        open: boolean;
        onchoose: (option: Value) => void;
    }

    let { id, anchor, ariaLabel, value, options, open = $bindable(), onchoose }: Props = $props();

    let menuElement = $state<HTMLDivElement>();
    let menu = $state<ReturnType<typeof Menu>>();

    export function show() {
        menu?.show();
    }

    export function close() {
        menu?.close();
    }

    /** Focus the selected option, or the first one when nothing is selected. */
    export function focusSelection() {
        const selected = menuElement?.querySelector<HTMLElement>('[aria-current="true"]');
        const first = menuElement?.querySelector<HTMLElement>('[role="menuitem"]');
        (selected ?? first)?.focus();
    }
</script>

<Menu
    {id}
    {anchor}
    bind:this={menu}
    bind:element={menuElement}
    bind:open
    coverAnchor={false}
    class="filter-menu"
    aria-label={ariaLabel}
    ontoggle={(event) => {
        if (event.newState === 'open') focusSelection();
    }}
>
    {#each options as option (option.value)}
        <MenuItem
            aria-current={option.value === value ? 'true' : undefined}
            onclick={() => onchoose(option.value)}
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

<style>
    :global(.filter-chip .filter-menu) {
        position-anchor: --filter-chip;
        min-width: 210px;
        max-width: min(320px, calc(100vw - 24px));
        --np-menu-container-color: var(--app-panel);
        --np-menu-container-shape: 8px;
        --np-menu-position-area: bottom span-right;
        --np-menu-justify-self: start;
    }

    :global(.filter-chip .filter-menu .np-item) {
        --np-item-container-height: 40px;
        padding-block: 8px;
    }

    :global(.filter-chip .filter-menu .np-item-headline) {
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
