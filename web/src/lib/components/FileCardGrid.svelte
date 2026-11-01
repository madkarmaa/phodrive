<script lang="ts">
    import { fade } from 'svelte/transition';
    import { flip } from 'svelte/animate';
    import { prefersReducedMotion } from 'svelte/motion';
    import { fileKey, type FileAction, type FileGroup } from '@madkarmaa/phodrive-core/files';
    import FileCard from '#components/FileCard.svelte';

    interface Props {
        files: FileGroup[];
        disabled: boolean;
        action: FileAction | null;
        ondownload: (item: FileGroup) => void;
        ondelete: (item: FileGroup) => void;
    }

    let { files, disabled, action, ondownload, ondelete }: Props = $props();

    const flipDuration = $derived(prefersReducedMotion.current ? 0 : 180);
    const fadeDuration = $derived(prefersReducedMotion.current ? 0 : 150);
</script>

<ul class="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-4 p-0">
    {#each files as item (fileKey(item))}
        <li
            class="min-w-0"
            animate:flip={{ duration: flipDuration }}
            transition:fade={{ duration: fadeDuration }}
        >
            <FileCard
                {item}
                {disabled}
                working={action?.fileId === item.fileId ? action.kind : null}
                {ondownload}
                {ondelete}
            />
        </li>
    {/each}
</ul>
