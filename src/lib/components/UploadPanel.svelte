<script lang="ts">
    import { fly, slide } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { UploadJob } from '$browser/files';
    import UploadStatusRow from '$components/UploadStatusRow.svelte';
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
            (first, second) => Number(second.status === 'error') - Number(first.status === 'error')
        )
    );
    const remaining = $derived(
        jobs.filter((job) => job.status === 'queued' || job.status === 'active').length
    );
    const failures = $derived(jobs.filter((job) => job.status === 'error').length);
    const heading = $derived.by(() => {
        if (busy) return `Uploading ${remaining} ${remaining === 1 ? 'item' : 'items'}`;
        if (failures) return `${failures} ${failures === 1 ? 'upload' : 'uploads'} failed`;

        return `${jobs.length} ${jobs.length === 1 ? 'upload' : 'uploads'} complete`;
    });
</script>

{#if open}
    <section
        aria-label="Upload status"
        class="fixed right-6 bottom-0 z-30 w-90 max-w-[calc(100vw-32px)] overflow-hidden rounded-t-2xl border border-border bg-panel text-text shadow-xl max-[520px]:right-4"
        transition:fly={{ y: 16, duration: prefersReducedMotion.current ? 0 : 180 }}
    >
        <header class="flex min-h-14 items-center gap-1 bg-surface py-1 pr-2 pl-4">
            <h2 class="mr-auto text-base font-medium" aria-live="polite">{heading}</h2>
            <button
                class="icon-button shrink-0 text-subtle"
                type="button"
                aria-label={collapsed ? 'Expand upload status' : 'Minimise upload status'}
                aria-expanded={!collapsed}
                onclick={() => (collapsed = !collapsed)}
            >
                <IconExpandMore
                    aria-hidden="true"
                    class={['transition-transform', collapsed && 'rotate-180']}
                />
            </button>
            <button
                class="icon-button shrink-0 text-subtle"
                type="button"
                aria-label="Close upload status"
                title={busy ? 'Hide status; upload continues' : 'Close'}
                onclick={() => (open = false)}><IconClose aria-hidden="true" /></button
            >
        </header>

        {#if !collapsed}
            <div transition:slide={{ duration: prefersReducedMotion.current ? 0 : 140 }}>
                <ul class="max-h-[min(24rem,60vh)] overflow-y-auto" aria-label="Upload queue">
                    {#each orderedJobs as job (job.id)}
                        <UploadStatusRow {job} {retryDisabled} onretry={() => onretry(job.id)} />
                    {/each}
                </ul>
            </div>
        {/if}
    </section>
{/if}
