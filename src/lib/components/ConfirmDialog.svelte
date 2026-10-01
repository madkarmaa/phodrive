<script lang="ts">
    import { Button, Dialog } from 'm3-svelte';
    import type { ConfirmTarget } from '$browser/drive.svelte';

    interface Props {
        open?: boolean;
        target: ConfirmTarget | null;
        onconfirm: () => void;
    }

    let { open = $bindable(false), target, onconfirm }: Props = $props();
</script>

<Dialog bind:open headline={target?.kind === 'account' ? 'Sign out?' : 'Move file to trash?'}>
    {#if target?.kind === 'account'}
        Sign out of {target.email} on this browser? Files in Google Photos will stay online.
    {:else if target?.kind === 'file'}
        Move {target.item.name} and its {target.item.chunks.length}
        {target.item.chunks.length === 1 ? 'chunk' : 'chunks'} to Google Photos trash?
    {/if}

    {#snippet buttons()}
        <Button variant="text" onclick={() => (open = false)}>Cancel</Button>
        <Button variant="text" onclick={onconfirm}
            >{target?.kind === 'account' ? 'Sign out' : 'Move to trash'}</Button
        >
    {/snippet}
</Dialog>
