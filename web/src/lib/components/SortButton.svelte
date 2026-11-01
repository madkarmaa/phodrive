<script lang="ts">
    import { Button } from 'noph-ui';
    import IconArrowUp from '~icons/material-symbols/arrow-upward';
    import IconArrowDown from '~icons/material-symbols/arrow-downward';

    interface Props {
        label: string;
        /** The list is sorted by this column, so the arrow shows its direction. */
        active: boolean;
        ascending: boolean;
        onclick: () => void;
    }

    let { label, active, ascending, onclick }: Props = $props();
</script>

<Button class="column-sort" size="xs" variant="text" {onclick}>
    {label}
    {#snippet end()}
        {#if active && ascending}
            <IconArrowUp aria-hidden="true" />
        {:else if active}
            <IconArrowDown aria-hidden="true" />
        {/if}
    {/snippet}
</Button>
