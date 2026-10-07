<script lang="ts">
    import { Card } from 'noph-ui';
    import { ElementRect } from 'runed';
    import type { Snippet } from 'svelte';
    import { MediaQuery } from 'svelte/reactivity';
    import { droppedFiles } from '$browser/files/drop';
    import IconUpload from '~icons/material-symbols/cloud-upload';
    import IconFolder from '~icons/material-symbols/folder-outline';

    interface Props {
        disabled: boolean;
        onupload: (files: File[]) => void;
        children?: Snippet;
    }

    let { disabled, onupload, children }: Props = $props();

    const DESKTOP_DROP_QUERY = '(width > 800px) and (hover: hover) and (pointer: fine)';
    const desktop = new MediaQuery(DESKTOP_DROP_QUERY, false);
    let dragging = $state(false);
    let overFiles = $state(false);
    let zone = $state<HTMLDivElement>();
    let dragDepth = 0;
    const fileRect = new ElementRect(() => zone);

    $effect(() => {
        if (!desktop.current || disabled) resetDrag();
    });

    function resetDrag() {
        dragging = false;
        overFiles = false;
        dragDepth = 0;
    }

    function isFileDrag(event: DragEvent): boolean {
        return desktop.current && !!event.dataTransfer?.types.includes('Files');
    }

    function isOverFiles(target: EventTarget | null): boolean {
        return target instanceof Node && !!zone?.contains(target);
    }

    function enterDrag(event: DragEvent) {
        if (!isFileDrag(event)) return;

        event.preventDefault();
        if (disabled) return;

        dragDepth += 1;
        dragging = true;
        overFiles = isOverFiles(event.target);
    }

    function overDrag(event: DragEvent) {
        if (!isFileDrag(event) || !event.dataTransfer) return;

        event.preventDefault();
        overFiles = isOverFiles(event.target);
        event.dataTransfer.dropEffect = disabled || !overFiles ? 'none' : 'copy';
        if (!disabled) dragging = true;
    }

    function leaveDrag(event: DragEvent) {
        if (!isFileDrag(event)) return;

        dragDepth = Math.max(0, dragDepth - 1);
        if (!dragDepth) {
            resetDrag();
            return;
        }

        if (event.relatedTarget) overFiles = isOverFiles(event.relatedTarget);
    }

    function dropFiles(event: DragEvent) {
        resetDrag();
        if (!isFileDrag(event) || !event.dataTransfer) return;

        event.preventDefault();
        if (disabled || !isOverFiles(event.target)) return;

        const files = droppedFiles(event.dataTransfer);
        if (!files.length) return;

        onupload(files);
    }
</script>

<svelte:window
    ondragenter={enterDrag}
    ondragover={overDrag}
    ondragleave={leaveDrag}
    ondrop={dropFiles}
    ondragend={resetDrag}
    onblur={resetDrag}
    onkeydown={(event) => {
        if (event.key === 'Escape') resetDrag();
    }}
/>

{#if children}
    <div class="file-drop" bind:this={zone}>
        {@render children()}

        {#if desktop.current && !disabled && dragging && overFiles}
            <div class="drop-highlight" aria-hidden="true"></div>
        {/if}
    </div>
{/if}

{#if desktop.current && !disabled && dragging}
    <div class="upload-prompt" role="status" style:left={`${fileRect.left + fileRect.width / 2}px`}>
        <IconUpload aria-hidden="true" class="size-18 text-primary" />
        <Card type="text" variant="filled">
            <div
                class="grid min-w-60 justify-items-center gap-2 text-sm text-(--np-color-on-primary)"
            >
                <span>Drop files to upload them to</span>
                <span class="flex items-center gap-2">
                    <IconFolder aria-hidden="true" class="size-4.5" />
                    My files
                </span>
            </div>
        </Card>
    </div>
{/if}

<style>
    .file-drop {
        display: flex;
        flex-direction: column;
        position: relative;
        flex: 1;
        min-height: 0;
    }

    .drop-highlight {
        position: absolute;
        inset: 0;
        z-index: 20;
        border: 2px solid color-mix(in srgb, var(--np-color-primary) 65%, transparent);
        border-radius: 16px;
        background: color-mix(in srgb, var(--np-color-primary) 12%, transparent);
        pointer-events: none;
    }

    .upload-prompt {
        position: fixed;
        bottom: 32px;
        z-index: 40;
        display: grid;
        justify-items: center;
        gap: 4px;
        transform: translateX(-50%);
        pointer-events: none;
        --np-filled-card-container-shape: 100px;
        --np-filled-card-container-color: var(--np-color-primary);
    }

    @media (width > 800px) and (hover: hover) and (pointer: fine) {
        .file-drop {
            margin: 0 -28px -48px;
            padding: 0 28px 48px;
        }
    }
</style>
