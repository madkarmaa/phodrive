<script lang="ts">
    import { AppView, ConfirmKind, FileActionKind } from '$lib/models';

    import { onMount, untrack } from 'svelte';
    import type { PageData } from './$types';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import { DriveController } from '$browser/drive.svelte';
    import AppHeader from '$components/AppHeader.svelte';
    import AccountMenu from '$components/AccountMenu.svelte';
    import AccountSetup from '$components/AccountSetup.svelte';
    import ConfirmDialog from '$components/ConfirmDialog.svelte';
    import UploadSidebar from '$components/UploadSidebar.svelte';
    import UploadPanel from '$components/UploadPanel.svelte';
    import FileFilters from '$components/FileFilters.svelte';
    import FileGrid from '$components/FileGrid.svelte';
    import SettingsPanel from '$components/SettingsPanel.svelte';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();

    const drive = new DriveController(untrack(() => data.preferencesDefaults));
    const actionsDisabled = $derived(drive.busy || !!drive.fileAction);
    let view = $state<AppView>(AppView.Files);

    onMount(() => drive.initialize());

    function addAccount() {
        view = AppView.Files;
        drive.adding = true;
        drive.message = '';
    }
</script>

<svelte:head>
    <title>Phodrive - files in Google Photos</title>
    <meta
        name="description"
        content="Convert a file into a reversible BMP and upload it to Google Photos."
    />
</svelte:head>

<div
    class="grid min-h-screen grid-cols-[256px_minmax(0,1fr)] grid-rows-[64px_minmax(calc(100vh-64px),auto)] max-[800px]:grid-cols-1 max-[800px]:grid-rows-[72px_auto_1fr]"
>
    <ConfirmDialog
        bind:open={drive.confirmOpen}
        target={drive.confirmTarget}
        onconfirm={() => drive.confirmAction()}
    />

    <AppHeader
        bind:search={drive.searchTerm}
        email={drive.selectedEmail}
        theme={drive.themeMode}
        menuOpen={drive.accountMenuOpen}
        refreshing={drive.libraryLoading}
        refreshDisabled={!drive.selectedEmail || actionsDisabled || drive.libraryLoading}
        onrefresh={() => {
            void drive.refreshFiles();
        }}
        ontheme={(mode) => drive.chooseTheme(mode)}
        onmenu={() => (drive.accountMenuOpen = !drive.accountMenuOpen)}
    />

    {#if drive.themeError}
        <p
            role="alert"
            class="fixed top-16 right-18 z-20 max-w-60 rounded-[10px] border border-border bg-panel px-3.5 py-2.5 text-xs text-error max-[800px]:top-18"
        >
            {drive.themeError}
        </p>
    {/if}

    {#if drive.accountMenuOpen}
        <AccountMenu
            emails={Object.keys(drive.accounts)}
            selected={drive.selectedEmail}
            disabled={actionsDisabled}
            onclose={() => (drive.accountMenuOpen = false)}
            onselect={(email) => drive.selectAccount(email)}
            onadd={addAccount}
            onsignout={() => {
                drive.confirmTarget = { kind: ConfirmKind.Account, email: drive.selectedEmail };
                drive.confirmOpen = true;
            }}
        />
    {/if}

    <UploadSidebar
        connected={!!drive.selectedEmail}
        disabled={actionsDisabled || drive.libraryLoading}
        {view}
        onnavigate={(nextView) => (view = nextView)}
        onconnect={addAccount}
        onupload={(files) => {
            drive.adding = false;
            void drive.upload(files);
        }}
    />

    <main
        class="mr-4 mb-5 flex min-w-0 flex-col rounded-[22px] bg-panel px-7 pt-6.5 pb-12 text-text max-[800px]:mx-2 max-[800px]:mb-2 max-[800px]:px-4.5 max-[800px]:pt-5.5 max-[800px]:pb-9"
    >
        {#if drive.ready && view === AppView.Settings}
            <SettingsPanel
                refreshIntervalSeconds={drive.refreshIntervalSeconds}
                concurrentWorkers={drive.concurrentWorkers}
                theme={drive.themeMode}
                error={drive.settingsError}
                onrefreshinterval={(seconds) => drive.chooseRefreshInterval(seconds)}
                onworkers={(workers) => drive.chooseConcurrentWorkers(workers)}
                onresetrefreshinterval={() => drive.resetRefreshInterval()}
                onresetworkers={() => drive.resetConcurrentWorkers()}
            />
        {:else if drive.ready && (!drive.selectedEmail || drive.adding)}
            <div in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
                <div class="workspace-heading">
                    <h1>
                        {drive.adding && drive.selectedEmail
                            ? 'Add account'
                            : 'Connect your account'}
                    </h1>
                </div>
                <AccountSetup
                    bind:email={drive.newEmail}
                    bind:token={drive.newToken}
                    connecting={drive.connecting}
                    message={drive.message}
                    canCancel={!!drive.selectedEmail}
                    onsave={() => {
                        void drive.saveAccount();
                    }}
                    oncancel={() => {
                        drive.adding = false;
                        drive.message = '';
                    }}
                />
            </div>
        {:else if drive.ready}
            <div in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
                <div class="workspace-heading">
                    <h1 id="files-heading">
                        My files <span class="text-subtle">({drive.visibleUploads.length})</span>
                    </h1>
                </div>

                <FileFilters
                    types={drive.availableTypes}
                    bind:type={drive.typeFilter}
                    bind:days={drive.modifiedDays}
                    bind:sort={drive.fileSort}
                />
                <FileGrid
                    files={drive.visibleUploads}
                    loading={drive.libraryLoading}
                    message={drive.galleryMessage}
                    filtered={!!(drive.searchTerm || drive.typeFilter || drive.modifiedDays)}
                    hasFiles={!!drive.files.length}
                    hasMore={!!drive.nextPageToken}
                    disabled={actionsDisabled || drive.libraryLoading}
                    action={drive.fileAction}
                    ondownload={(item) => {
                        void drive.actOnFile(item, FileActionKind.Download);
                    }}
                    ondelete={(item) => {
                        drive.confirmTarget = { kind: ConfirmKind.File, item };
                        drive.confirmOpen = true;
                    }}
                    onmore={() => {
                        void drive.loadFiles(false);
                    }}
                />
            </div>
        {/if}
    </main>
</div>

<UploadPanel
    bind:open={drive.uploadPanelOpen}
    busy={drive.busy}
    jobs={drive.uploadJobs}
    retryDisabled={actionsDisabled || drive.libraryLoading || !drive.selectedEmail}
    onretry={(id) => {
        void drive.retryUpload(id);
    }}
/>
