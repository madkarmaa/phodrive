<script lang="ts">
    import { IconButton, List, Sheet } from 'noph-ui';
    import { UploadJobStatus } from '#lib/models';

    import { slide } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { UploadJob } from '#browser/files';
    import UploadStatusRow from '#components/UploadStatusRow.svelte';
    import IconClose from '~icons/material-symbols/close';
    import IconExpandMore from '~icons/material-symbols/expand-more';

    interface Props {
        open?: boolean;
        busy: boolean;
        jobs: readonly UploadJob[];
        retryDisabled: boolean;
        onretry: (id: number) => void;
    }

    let { open = $bindable(false), busy, jobs, retryDisabled, onretry }: Props = $props();

    let collapsed = $state(false);
    const orderedJobs = $derived(
        jobs.toSorted(
            (first, second) =>
                Number(second.status === UploadJobStatus.Error) -
                Number(first.status === UploadJobStatus.Error)
        )
    );
    const remaining = $derived(
        jobs.filter(
            (job) => job.status === UploadJobStatus.Queued || job.status === UploadJobStatus.Active
        ).length
    );
    const failures = $derived(jobs.filter((job) => job.status === UploadJobStatus.Error).length);
    const heading = $derived.by(() => {
        if (busy) return `Uploading ${remaining} ${remaining === 1 ? 'item' : 'items'}`;
        if (failures) return `${failures} ${failures === 1 ? 'upload' : 'uploads'} failed`;

        return `${jobs.length} ${jobs.length === 1 ? 'upload' : 'uploads'} complete`;
    });
</script>

<Sheet
    bind:open
    modal={false}
    handle={false}
    placement="bottom"
    aria-label="Upload status"
    class="upload-sheet"
>
    <header class="flex min-h-14 items-center gap-1 bg-surface py-1 pr-2 pl-4">
        <h2 class="mr-auto text-base font-medium" aria-live="polite">{heading}</h2>
        <IconButton
            size="s"
            aria-label={collapsed ? 'Expand upload status' : 'Minimise upload status'}
            aria-expanded={!collapsed}
            onclick={() => (collapsed = !collapsed)}
        >
            <IconExpandMore
                aria-hidden="true"
                class={['transition-transform', collapsed && 'rotate-180']}
            />
        </IconButton>
        <IconButton
            size="s"
            aria-label="Close upload status"
            title="Close upload status"
            onclick={() => (open = false)}><IconClose aria-hidden="true" /></IconButton
        >
    </header>

    {#if !collapsed}
        <div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 140 }}>
            <List class="upload-queue" aria-label="Upload queue">
                {#each orderedJobs as job (job.id)}
                    <UploadStatusRow {job} {retryDisabled} onretry={() => onretry(job.id)} />
                {/each}
            </List>
        </div>
    {/if}
</Sheet>

<style>
    :global(:root .upload-sheet.np-sheet) {
        inset: auto 24px 0 auto;
        width: 360px;
        max-width: calc(100vw - 32px);
        max-height: calc(60vh + 56px);
        border: 1px solid var(--app-border);
        --np-sheet-z-index: 30;
        --np-sheet-shape: 16px;
        --np-sheet-elevation: var(--np-elevation-3);
    }

    :global(:root .upload-sheet.np-sheet > .np-sheet-content) {
        padding: 0;
    }
    :global(:root .upload-queue.np-list) {
        padding: 0;
        margin: 0;
    }

    @media (max-width: 520px) {
        :global(:root .upload-sheet.np-sheet) {
            right: 16px;
        }
    }
</style>
