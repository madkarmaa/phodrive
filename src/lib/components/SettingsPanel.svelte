<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import { untrack } from 'svelte';
    import { watch } from 'runed';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import AppFooter from '$components/AppFooter.svelte';
    import {
        MAX_REFRESH_INTERVAL_SECONDS,
        MAX_CONCURRENT_WORKERS,
        type ThemeMode
    } from '$lib/models';

    interface Props {
        refreshIntervalSeconds: number;
        concurrentWorkers: number;
        theme: ThemeMode;
        error: string;
        onrefreshinterval: (seconds: number) => void;
        onworkers: (workers: number) => void;
        onresetrefreshinterval: () => void;
        onresetworkers: () => void;
    }

    let {
        refreshIntervalSeconds,
        concurrentWorkers,
        theme,
        error,
        onrefreshinterval,
        onworkers,
        onresetrefreshinterval,
        onresetworkers
    }: Props = $props();

    let refreshDraft = $state<string | number | null>(untrack(() => refreshIntervalSeconds));
    let workersDraft = $state<string | number | null>(untrack(() => concurrentWorkers));

    watch(
        () => refreshIntervalSeconds,
        (seconds) => {
            refreshDraft = seconds;
        }
    );

    watch(
        () => concurrentWorkers,
        (workers) => {
            workersDraft = workers;
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
            onsubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('refreshInterval');

                if (typeof value !== 'string') return;

                onrefreshinterval(Number(value));
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
                        min="0"
                        max={MAX_REFRESH_INTERVAL_SECONDS}
                        step="1"
                        required
                        aria-describedby="refresh-description"
                    />
                </div>
                <Button type="submit" variant="tonal" aria-label="Save refresh interval"
                    >Save</Button
                >
                <Button
                    type="button"
                    variant="outlined"
                    aria-label="Reset refresh interval"
                    onclick={() => {
                        onresetrefreshinterval();
                        refreshDraft = refreshIntervalSeconds;
                    }}>Reset</Button
                >
            </div>
        </form>

        <form
            class="grid gap-3"
            onsubmit={(event) => {
                event.preventDefault();
                const value = new FormData(event.currentTarget).get('workers');

                if (typeof value !== 'string') return;

                onworkers(Number(value));
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
                        min="1"
                        max={MAX_CONCURRENT_WORKERS}
                        step="1"
                        required
                        aria-describedby="workers-description"
                    />
                </div>
                <Button type="submit" variant="tonal" aria-label="Save concurrent workers"
                    >Save</Button
                >
                <Button
                    type="button"
                    variant="outlined"
                    aria-label="Reset concurrent workers"
                    onclick={() => {
                        onresetworkers();
                        workersDraft = concurrentWorkers;
                    }}>Reset</Button
                >
            </div>
        </form>

        {#if error}
            <p role="alert" class="text-sm text-error">{error}</p>
        {/if}
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
