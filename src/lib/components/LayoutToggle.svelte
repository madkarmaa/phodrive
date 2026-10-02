<script lang="ts">
    import { SegmentedButton } from 'noph-ui';
    import { FileLayout } from '$lib/models';
    import IconList from '~icons/material-symbols/view-list-outline';
    import IconGrid from '~icons/material-symbols/grid-view-outline';

    interface Props {
        layout: FileLayout;
    }

    let { layout = $bindable() }: Props = $props();
    const id = $props.id();
    let group: string | number | (string | number)[] | null | undefined = $derived(
        layout === FileLayout.List ? 'List' : 'Grid'
    );

    function choose(value: string | number | (string | number)[] | null | undefined) {
        if (value === 'List') layout = FileLayout.List;
        if (value === 'Grid') layout = FileLayout.Grid;
    }
</script>

{#snippet listIcon()}<IconList aria-hidden="true" />{/snippet}
{#snippet gridIcon()}<IconGrid aria-hidden="true" />{/snippet}

<SegmentedButton
    class="layout-toggle"
    name={id}
    role="radiogroup"
    aria-label="File layout"
    bind:group
    onchange={() => choose(group)}
    options={[
        { label: 'List', labelIcon: listIcon },
        { label: 'Grid', labelIcon: gridIcon }
    ]}
/>

<style>
    /* Drive's compact selector; Noph supplies selection, focus, and radio keyboard behavior. */
    :global(:root .layout-toggle.np-segmented-buttons) {
        /* Equal flex items replace Noph's inline max-content grid tracks. */
        display: flex;
        box-sizing: border-box;
        width: 110px;
        height: 32px;
        flex-shrink: 0;
        overflow: visible;
        isolation: isolate;
        --np-color-secondary-container: var(--app-selected);
        --np-color-on-secondary-container: var(--app-selected-text);
    }

    :global(:root .layout-toggle .np-segmented-button),
    :global(:root .layout-toggle .np-segmented-button:has(input:checked)) {
        box-sizing: border-box;
        flex: 1 1 50%;
        min-width: 0;
        min-height: 0;
        padding: 0 6px;
    }

    /* Round backgrounds and ripples locally without clipping the focus outline. */
    :global(:root .layout-toggle .np-segmented-button:first-child) {
        border-start-start-radius: inherit;
        border-end-start-radius: inherit;
    }

    :global(:root .layout-toggle .np-segmented-button:last-child) {
        border-start-end-radius: inherit;
        border-end-end-radius: inherit;
    }

    :global(:root .layout-toggle .np-segmented-button::after) {
        border-radius: inherit;
    }

    :global(:root .layout-toggle .np-segmented-button-icon-label),
    :global(:root .layout-toggle .check-icon-wrapper) {
        flex-shrink: 0;
    }

    :global(:root .layout-toggle .np-segmented-button-icon-label svg),
    :global(:root .layout-toggle .check-icon svg) {
        width: 18px;
        height: 18px;
    }

    :global(:root .layout-toggle .np-segmented-button:has(input:checked) .check-icon-wrapper) {
        width: 22px;
    }

    :global(:root .layout-toggle .np-segmented-button:has(input:checked) .check-icon) {
        width: 18px;
    }
</style>
