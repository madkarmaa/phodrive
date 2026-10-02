<script lang="ts">
    import { ConfirmKind } from '$lib/models';
    import { Button, Dialog } from 'noph-ui';
    import type { ConfirmTarget } from '$browser/drive.svelte';

    interface Props {
        open?: boolean;
        target: ConfirmTarget | null;
        onconfirm: () => void;
    }

    let { open = $bindable(false), target, onconfirm }: Props = $props();
    let cancelButton = $state<HTMLElement>();
</script>

<Dialog
    style="transition-property: opacity"
    bind:open
    aria-label={target?.kind === ConfirmKind.Account ? 'Sign out?' : 'Move file to trash?'}
    headline={target?.kind === ConfirmKind.Account ? 'Sign out?' : 'Move file to trash?'}
    ontoggle={(event) => {
        if (event.newState === 'open') cancelButton?.focus();
    }}
>
    {#if target?.kind === ConfirmKind.Account}
        Sign out of {target.email} on this browser? Files in Google Photos will stay online.
    {:else if target?.kind === ConfirmKind.File}
        Move {target.item.name} and its {target.item.chunks.length}
        {target.item.chunks.length === 1 ? 'chunk' : 'chunks'} to Google Photos trash?
    {/if}

    {#snippet actions()}
        <Button bind:element={cancelButton} autofocus variant="text" onclick={() => (open = false)}>
            Cancel
        </Button>
        <Button variant="text" onclick={onconfirm}>
            {target?.kind === ConfirmKind.Account ? 'Sign out' : 'Move to trash'}
        </Button>
    {/snippet}
</Dialog>
