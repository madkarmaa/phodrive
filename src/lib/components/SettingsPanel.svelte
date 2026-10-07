<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import { untrack } from 'svelte';
    import { watch } from 'runed';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import AppFooter from '#components/AppFooter.svelte';
    import {
        MAX_REFRESH_INTERVAL_SECONDS,
        MAX_CONCURRENT_WORKERS,
        RefreshIntervalSchema,
        ConcurrentWorkersSchema,
        type PreferencesDefaults,
        type ThemeMode
    } from '#lib/models';

    interface Props {
        refreshIntervalSeconds: number;
        concurrentWorkers: number;
        defaults: PreferencesDefaults;
        theme: ThemeMode;
        onrefreshinterval: (seconds: number) => void;
        onworkers: (workers: number) => void;
        onresetrefreshinterval: () => void;
        onresetworkers: () => void;
    }

    let {
        refreshIntervalSeconds,
        concurrentWorkers,
        defaults,
        theme,
        onrefreshinterval,
        onworkers,
        onresetrefreshinterval,
        onresetworkers
    }: Props = $props();

    let refreshDraft = $state<string | number | null>(untrack(() => refreshIntervalSeconds));
    let workersDraft = $state<string | number | null>(untrack(() => concurrentWorkers));
    let refreshTouched = $state(false);
    let workersTouched = $state(false);
    let refreshInput = $state<HTMLInputElement | HTMLTextAreaElement>();
    let workersInput = $state<HTMLInputElement | HTMLTextAreaElement>();
    const refreshValidation = $derived(
        RefreshIntervalSchema.safeParse(
            refreshDraft === '' || refreshDraft === null ? undefined : Number(refreshDraft),
            { error: () => `Enter a whole number from 0 to ${MAX_REFRESH_INTERVAL_SECONDS}.` }
        )
    );
    const workersValidation = $derived(
        ConcurrentWorkersSchema.safeParse(
            workersDraft === '' || workersDraft === null ? undefined : Number(workersDraft),
            { error: () => `Enter a whole number from 1 to ${MAX_CONCURRENT_WORKERS}.` }
        )
    );
    const refreshIssues = $derived(
        refreshTouched && !refreshValidation.success ? refreshValidation.error.issues : undefined
    );
    const workersIssues = $derived(
        workersTouched && !workersValidation.success ? workersValidation.error.issues : undefined
    );
    const refreshSaveDisabled = $derived(
        !refreshValidation.success || refreshValidation.data === refreshIntervalSeconds
    );
    const workersSaveDisabled = $derived(
        !workersValidation.success || workersValidation.data === concurrentWorkers
    );
    const refreshResetDisabled = $derived(
        refreshValidation.success && refreshValidation.data === defaults.refreshIntervalSeconds
    );
    const workersResetDisabled = $derived(
        workersValidation.success && workersValidation.data === defaults.concurrentWorkers
    );

    watch(
        () => refreshIntervalSeconds,
        (seconds) => {
            refreshDraft = seconds;
            refreshTouched = false;
        }
    );

    watch(
        () => concurrentWorkers,
        (workers) => {
            workersDraft = workers;
            workersTouched = false;
        }
    );
</script>

<section
    class="flex flex-1 flex-col"
    aria-labelledby="settings-heading"
    in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}
>
    <div class="workspace-heading">
        <h1 id="settings-heading">Settings</h1>
    </div>

    <div class="mt-4 grid max-w-180 gap-8 pb-16">
        <form
            class="grid gap-3"
            novalidate
            onsubmit={(event) => {
                event.preventDefault();
                refreshTouched = true;
                if (!refreshValidation.success) {
                    refreshInput?.focus();
                    return;
                }

                if (refreshSaveDisabled) return;

                onrefreshinterval(refreshValidation.data);
            }}
        >
            <div>
                <h2 class="text-base font-medium">Automatic refresh</h2>
                <p id="refresh-description" class="mt-1 text-sm leading-relaxed text-muted">
                    Check for files uploaded from another instance. Set the interval to 0 to turn
                    automatic refresh off.
                </p>
            </div>

            <div class="flex flex-wrap items-end gap-3 max-[520px]:gap-2">
                <div class="settings-field max-w-52 min-w-0 flex-1">
                    <TextField
                        label="Refresh interval (seconds)"
                        name="refreshInterval"
                        type="number"
                        bind:value={refreshDraft}
                        bind:inputElement={refreshInput}
                        issues={refreshIssues}
                        onblur={() => (refreshTouched = true)}
                        min="0"
                        max={MAX_REFRESH_INTERVAL_SECONDS}
                        step="1"
                        required
                        aria-describedby="refresh-description"
                    />
                </div>
                <Button
                    type="submit"
                    variant="tonal"
                    aria-label="Save refresh interval"
                    disabled={refreshSaveDisabled}>Save</Button
                >
                <Button
                    type="button"
                    variant="outlined"
                    aria-label="Reset refresh interval"
                    disabled={refreshResetDisabled}
                    onclick={() => {
                        onresetrefreshinterval();
                        refreshDraft = refreshIntervalSeconds;
                        refreshTouched = false;
                    }}>Reset</Button
                >
            </div>
        </form>

        <form
            class="grid gap-3"
            novalidate
            onsubmit={(event) => {
                event.preventDefault();
                workersTouched = true;
                if (!workersValidation.success) {
                    workersInput?.focus();
                    return;
                }

                if (workersSaveDisabled) return;

                onworkers(workersValidation.data);
            }}
        >
            <div>
                <h2 class="text-base font-medium">Concurrent workers</h2>
                <p id="workers-description" class="mt-1 text-sm leading-relaxed text-muted">
                    Upload or delete up to this many chunks at once across your selected files. More
                    workers use more memory. Changes apply to the next operation.
                </p>
            </div>

            <div class="flex flex-wrap items-end gap-3 max-[520px]:gap-2">
                <div class="settings-field max-w-52 min-w-0 flex-1">
                    <TextField
                        label="Concurrent workers"
                        name="workers"
                        type="number"
                        bind:value={workersDraft}
                        bind:inputElement={workersInput}
                        issues={workersIssues}
                        onblur={() => (workersTouched = true)}
                        min="1"
                        max={MAX_CONCURRENT_WORKERS}
                        step="1"
                        required
                        aria-describedby="workers-description"
                    />
                </div>
                <Button
                    type="submit"
                    variant="tonal"
                    aria-label="Save concurrent workers"
                    disabled={workersSaveDisabled}>Save</Button
                >
                <Button
                    type="button"
                    variant="outlined"
                    aria-label="Reset concurrent workers"
                    disabled={workersResetDisabled}
                    onclick={() => {
                        onresetworkers();
                        workersDraft = concurrentWorkers;
                        workersTouched = false;
                    }}
                >
                    Reset
                </Button>
            </div>
        </form>
    </div>

    <AppFooter {theme} />
</section>

<style>
    .settings-field :global(.np-text-field) {
        width: 100%;
        min-width: 0;
    }
    .settings-field :global(.field) {
        min-width: 0;
    }
</style>
