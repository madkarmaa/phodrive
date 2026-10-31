<script lang="ts">
    import {
        AppView,
        FileActionKind,
        type PreferencesDefaults
    } from '@madkarmaa/phodrive-core/models';
    import { onMount, untrack } from 'svelte';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { DriveController } from '#browser/drive/index.svelte';
    import AppHeader from '#components/AppHeader.svelte';
    import AccountMenu from '#components/AccountMenu.svelte';
    import ConfirmDialog from '#components/ConfirmDialog.svelte';
    import UploadSidebar from '#components/UploadSidebar.svelte';
    import UploadPanel from '#components/UploadPanel.svelte';
    import FileFilters from '#components/FileFilters.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';
    import SettingsPanel from '#components/SettingsPanel.svelte';
    import ErrorFeedback from '#components/ErrorFeedback.svelte';
    import FileDrop from '#components/FileDrop.svelte';

    interface Props {
        email: string;
        preferencesDefaults: PreferencesDefaults;
    }

    let { email, preferencesDefaults }: Props = $props();

    const drive = new DriveController(
        untrack(() => email),
        untrack(() => preferencesDefaults)
    );
    const actionsDisabled = $derived(drive.busy || !!drive.fileAction);
    let view = $state<AppView>(AppView.Files);
    let navigationOpen = $state(false);
    let accountButton = $state<HTMLElement>();

    onMount(() => {
        drive.initialize();
        void drive.library.load();
    });

    function upload(files: File[]) {
        void drive.upload(files);
    }
</script>

{#if !drive.ready || view !== AppView.Files}
    <FileDrop disabled={true} onupload={upload} />
{/if}

<div
    class="grid min-h-screen grid-cols-[256px_minmax(0,1fr)] grid-rows-[64px_minmax(calc(100vh-64px),auto)] max-[800px]:grid-cols-1 max-[800px]:grid-rows-[72px_minmax(calc(100vh-72px),auto)]"
>
    <ConfirmDialog
        bind:open={drive.confirmOpen}
        target={drive.confirmTarget}
        onconfirm={() => drive.confirmAction()}
    />

    <AppHeader
        bind:search={drive.library.searchTerm}
        email={drive.email}
        theme={drive.settings.themeMode}
        menuOpen={drive.accountMenuOpen}
        {navigationOpen}
        onnavigation={() => (navigationOpen = true)}
        refreshing={drive.library.loading}
        refreshDisabled={actionsDisabled || drive.library.loading}
        onrefresh={() => {
            void drive.library.refresh();
        }}
        ontheme={(mode) => drive.settings.chooseTheme(mode)}
        bind:accountButton
    />

    <ErrorFeedback bind:message={drive.feedbackMessage} />

    <AccountMenu
        bind:open={drive.accountMenuOpen}
        anchor={accountButton}
        email={drive.email}
        disabled={actionsDisabled}
        signingOut={drive.signingOut}
        onsignout={() => {
            void drive.signOut();
        }}
    />

    <UploadSidebar
        bind:open={navigationOpen}
        disabled={actionsDisabled || drive.library.loading}
        {view}
        onnavigate={(nextView) => (view = nextView)}
        onupload={upload}
    />

    <main
        class="mr-4 mb-5 flex min-w-0 flex-col rounded-[22px] bg-panel px-7 pt-6.5 pb-12 text-text max-[800px]:mx-2 max-[800px]:mb-2 max-[800px]:px-4.5 max-[800px]:pt-5.5 max-[800px]:pb-[calc(96px+env(safe-area-inset-bottom,0px))]"
    >
        {#if drive.ready && view === AppView.Settings}
            <SettingsPanel
                email={drive.email}
                replacingToken={drive.replacingToken}
                onreplacetoken={(token) => drive.replaceToken(token)}
                defaults={preferencesDefaults}
                refreshIntervalSeconds={drive.settings.refreshIntervalSeconds}
                concurrentWorkers={drive.settings.concurrentWorkers}
                theme={drive.settings.themeMode}
                onrefreshinterval={(seconds) => drive.settings.chooseRefreshInterval(seconds)}
                onworkers={(workers) => drive.settings.chooseConcurrentWorkers(workers)}
                onresetrefreshinterval={() => drive.settings.resetRefreshInterval()}
                onresetworkers={() => drive.settings.resetConcurrentWorkers()}
            />
        {:else if drive.ready}
            <div
                class="flex flex-1 flex-col"
                in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}
            >
                <div class="workspace-heading">
                    <h1 id="files-heading">
                        My files <span class="text-subtle"
                            >({drive.library.visibleFiles.length})</span
                        >
                    </h1>
                    <LayoutToggle bind:layout={drive.settings.fileLayout} />
                </div>

                <FileFilters
                    types={drive.library.availableTypes}
                    bind:type={drive.library.typeFilter}
                    bind:days={drive.library.modifiedDays}
                    bind:sort={drive.settings.fileSort}
                />
                <FileDrop
                    disabled={actionsDisabled ||
                        drive.library.loading ||
                        drive.confirmOpen ||
                        drive.accountMenuOpen}
                    onupload={upload}
                >
                    <FileGrid
                        files={drive.library.visibleFiles}
                        layout={drive.settings.fileLayout}
                        bind:sort={drive.settings.fileSort}
                        loading={drive.library.loading}
                        loadFailed={drive.library.loadFailed}
                        filtered={!!(
                            drive.library.searchTerm ||
                            drive.library.typeFilter ||
                            drive.library.modifiedDays
                        )}
                        hasFiles={!!drive.library.files.length}
                        hasMore={!!drive.library.nextPageToken}
                        disabled={actionsDisabled || drive.library.loading}
                        action={drive.fileAction}
                        ondownload={(item) => {
                            void drive.actOnFile(item, FileActionKind.Download);
                        }}
                        ondelete={(item) => {
                            drive.confirmTarget = item;
                            drive.confirmOpen = true;
                        }}
                        onmore={() => {
                            void drive.library.load(false);
                        }}
                    />
                </FileDrop>
            </div>
        {/if}
    </main>
</div>

<UploadPanel
    bind:open={drive.uploadPanelOpen}
    busy={drive.busy}
    jobs={drive.uploadJobs}
    retryDisabled={actionsDisabled || drive.library.loading}
    onretry={(id) => {
        void drive.retryUpload(id);
    }}
/>
