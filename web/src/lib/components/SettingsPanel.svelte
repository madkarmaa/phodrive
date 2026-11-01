<script lang="ts">
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import AppFooter from '#components/AppFooter.svelte';
    import GoogleTokenForm from '#components/GoogleTokenForm.svelte';
    import NumberSettingForm from '#components/NumberSettingForm.svelte';
    import {
        MAX_REFRESH_INTERVAL_SECONDS,
        MAX_CONCURRENT_WORKERS,
        RefreshIntervalSchema,
        ConcurrentWorkersSchema,
        ProcessingMode,
        type PreferencesDefaults,
        type ThemeMode
    } from '@madkarmaa/phodrive-core/models';

    interface Props {
        email: string;
        processing: ProcessingMode;
        replacingToken: boolean;
        onreplacetoken: (token: string) => Promise<boolean>;
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
        email,
        processing,
        replacingToken,
        onreplacetoken,
        refreshIntervalSeconds,
        concurrentWorkers,
        defaults,
        theme,
        onrefreshinterval,
        onworkers,
        onresetrefreshinterval,
        onresetworkers
    }: Props = $props();
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
        <GoogleTokenForm {email} replacing={replacingToken} onreplace={onreplacetoken} />

        <NumberSettingForm
            setting="refresh interval"
            heading="Automatic refresh"
            description="Check for files uploaded from another instance. Set the interval to 0 to turn automatic refresh off."
            label="Refresh interval (seconds)"
            name="refreshInterval"
            min={0}
            max={MAX_REFRESH_INTERVAL_SECONDS}
            schema={RefreshIntervalSchema}
            value={refreshIntervalSeconds}
            defaultValue={defaults.refreshIntervalSeconds}
            onsave={onrefreshinterval}
            onreset={onresetrefreshinterval}
        />

        <NumberSettingForm
            setting="concurrent workers"
            heading="Concurrent workers"
            description="Upload or delete up to this many chunks at once across your selected files. More workers use more memory. Changes apply to the next operation."
            label="Concurrent workers"
            name="workers"
            min={1}
            max={MAX_CONCURRENT_WORKERS}
            schema={ConcurrentWorkersSchema}
            value={concurrentWorkers}
            defaultValue={defaults.concurrentWorkers}
            onsave={onworkers}
            onreset={onresetworkers}
        />

        <div class="grid gap-1">
            <h2 class="text-base font-medium">File processing</h2>
            <p class="text-sm leading-relaxed text-muted">
                {#if processing === ProcessingMode.Browser}
                    This browser hashes, splits, and encodes files before uploading them, and
                    verifies and rebuilds them when downloading.
                {:else}
                    The server hashes, splits, and encodes uploaded files, and verifies and rebuilds
                    them for downloads.
                {/if}
                The server's administrator chooses this with <code>PHODRIVE_PROCESSING</code>.
            </p>
        </div>
    </div>

    <AppFooter {theme} />
</section>
