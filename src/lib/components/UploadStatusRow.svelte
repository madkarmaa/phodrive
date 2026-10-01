<script lang="ts">
    import { CircularProgress } from 'm3-svelte';
    import type { UploadJob } from '$browser/files';
    import IconDescription from '~icons/material-symbols/description';
    import IconCheckCircle from '~icons/material-symbols/check-circle';
    import IconError from '~icons/material-symbols/error-outline';
    import IconRetry from '~icons/material-symbols/replay';

    interface Props {
        job: UploadJob;
        retryDisabled: boolean;
        onretry: () => void;
    }

    let { job, retryDisabled, onretry }: Props = $props();

    const progress = $derived(job.progress);
    const processed = $derived(
        progress.completed + (progress.phase === 'uploading' ? progress.reused : 0)
    );
    const percent = $derived(progress.total ? Math.round((processed / progress.total) * 100) : 0);
    const detail = $derived.by(() => {
        if (job.status === 'queued') return 'Waiting…';
        if (job.status === 'error') return job.message;
        if (job.status === 'complete')
            return job.result?.status === 'already exists'
                ? 'Already in Google Photos'
                : 'Uploaded successfully';
        if (progress.phase === 'hashing') return `Hashing file… ${percent}%`;
        if (processed === progress.total) return 'Finishing upload…';

        return `Uploading… ${percent}%`;
    });
</script>

<li class="flex min-h-16 items-center gap-4 px-4 py-3" aria-label={job.name}>
    <IconDescription aria-hidden="true" class="size-5 shrink-0 text-primary" />
    <div class="min-w-0 flex-1">
        <p class="truncate text-sm" title={job.name}>{job.name}</p>
        <p
            class="mt-1 text-xs"
            class:text-error={job.status === 'error'}
            class:text-muted={job.status !== 'error'}
            role={job.status === 'error' ? 'alert' : 'status'}
        >
            {detail}
        </p>
    </div>
    {#if job.status === 'active'}
        <span class="shrink-0">
            <CircularProgress
                {percent}
                size={24}
                thickness={2.5}
                aria-label={progress.phase === 'hashing' ? 'Hashing progress' : 'Upload progress'}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
            />
        </span>
    {:else if job.status === 'error'}
        <IconError aria-hidden="true" class="size-6 shrink-0 text-error" />
        <button
            class="icon-button shrink-0 text-subtle disabled:cursor-default disabled:opacity-50"
            type="button"
            aria-label={`Retry ${job.name}`}
            title="Retry upload"
            disabled={retryDisabled}
            onclick={onretry}
        >
            <IconRetry aria-hidden="true" />
        </button>
    {:else if job.status === 'complete'}
        <IconCheckCircle aria-hidden="true" class="size-6 shrink-0 text-success" />
    {/if}
</li>
