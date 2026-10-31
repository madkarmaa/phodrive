<script lang="ts">
    import type { FileGroup } from '@madkarmaa/phodrive-core/files';
    import { Button, Dialog } from 'noph-ui';

    interface Props {
        open?: boolean;
        target: FileGroup | null;
        onconfirm: () => void;
    }

    let { open = $bindable(false), target, onconfirm }: Props = $props();
    let cancelButton = $state<HTMLElement>();
</script>

<Dialog
    style="transition-property: opacity"
    bind:open
    aria-label="Move file to trash?"
    headline="Move file to trash?"
    ontoggle={(event) => {
        if (event.newState === 'open') cancelButton?.focus();
    }}
>
    {#if target}
        Move {target.name} and its {target.chunks.length}
        {target.chunks.length === 1 ? 'chunk' : 'chunks'} to Google Photos trash?
    {/if}

    {#snippet actions()}
        <Button bind:element={cancelButton} autofocus variant="text" onclick={() => (open = false)}>
            Cancel
        </Button>
        <Button variant="text" onclick={onconfirm}>Move to trash</Button>
    {/snippet}
</Dialog>
