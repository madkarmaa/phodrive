<script lang="ts">
    import { FileActionKind } from '@madkarmaa/phodrive-core/models';
    import { fade } from 'svelte/transition';
    import { prefersReducedMotion } from 'svelte/motion';
    import type { DriveController } from '#browser/drive/index.svelte';
    import FileDrop from '#components/FileDrop.svelte';
    import FileFilters from '#components/FileFilters.svelte';
    import FileGrid from '#components/FileGrid.svelte';
    import LayoutToggle from '#components/LayoutToggle.svelte';

    interface Props {
        drive: DriveController;
        /** An upload or file action is running. */
        working: boolean;
        onupload: (files: File[]) => void;
    }

    let { drive, working, onupload }: Props = $props();

    const { library, settings } = $derived(drive);
    const disabled = $derived(working || library.loading);
    const filtered = $derived(!!(library.searchTerm || library.typeFilter || library.modifiedDays));
</script>

<div class="flex flex-1 flex-col" in:fade={{ duration: prefersReducedMotion.current ? 0 : 160 }}>
    <div class="workspace-heading">
        <h1 id="files-heading">
            My files <span class="text-subtle">({library.visibleFiles.length})</span>
        </h1>
        <LayoutToggle bind:layout={settings.fileLayout} />
    </div>

    <FileFilters
        types={library.availableTypes}
        bind:type={library.typeFilter}
        bind:days={library.modifiedDays}
        bind:sort={settings.fileSort}
    />
    <FileDrop disabled={disabled || drive.confirmOpen || drive.accountMenuOpen} {onupload}>
        <FileGrid
            files={library.visibleFiles}
            layout={settings.fileLayout}
            bind:sort={settings.fileSort}
            loading={library.loading}
            loadFailed={library.loadFailed}
            {filtered}
            hasFiles={!!library.files.length}
            hasMore={!!library.nextPageToken}
            {disabled}
            action={drive.fileAction}
            ondownload={(item) => {
                void drive.actOnFile(item, FileActionKind.Download);
            }}
            ondelete={(item) => {
                drive.confirmTarget = item;
                drive.confirmOpen = true;
            }}
            onmore={() => {
                void library.load(false);
            }}
        />
    </FileDrop>
</div>
