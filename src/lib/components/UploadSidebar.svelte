<script lang="ts">
    import { ExtendedFab, Fab, IconButton, NavigationDrawer, NavigationDrawerItem } from 'noph-ui';
    import { MediaQuery } from 'svelte/reactivity';
    import { AppView } from '$lib/models';
    import IconAdd from '~icons/material-symbols/add';
    import IconHome from '~icons/material-symbols/home-outline';
    import IconSettings from '~icons/material-symbols/settings-outline';
    import IconClose from '~icons/material-symbols/close';

    interface Props {
        open?: boolean;
        connected: boolean;
        disabled: boolean;
        view: AppView;
        onnavigate: (view: AppView) => void;
        onupload: (files: File[]) => void;
        onconnect: () => void;
    }

    let {
        open = $bindable(false),
        connected,
        disabled,
        view,
        onnavigate,
        onupload,
        onconnect
    }: Props = $props();

    let picker: HTMLInputElement;
    const mobile = new MediaQuery('(width < 800px)');

    $effect(() => {
        if (!mobile.current) open = false;
    });

    function navigate(nextView: AppView) {
        open = false;
        onnavigate(nextView);
    }
</script>

<aside class="upload-sidebar min-w-0 px-4 pt-2 pb-8" aria-label="Navigation and accounts">
    <ExtendedFab
        class="upload-button"
        label="Upload"
        aria-label="Upload"
        variant="secondary-container"
        {disabled}
        onclick={() => (connected ? picker.click() : onconnect())}
    >
        {#snippet icon()}<IconAdd aria-hidden="true" class="size-6" />{/snippet}
    </ExtendedFab>

    <input
        bind:this={picker}
        type="file"
        multiple
        class="sr-only"
        aria-label="Upload files"
        onchange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';

            if (!files.length) return;

            onupload(files);
        }}
    />

    <NavigationDrawer
        id="main-navigation"
        class={mobile.current ? 'mobile-navigation' : 'drive-navigation'}
        aria-label="Main"
        modal={mobile.current}
        backdrop
        bind:open
    >
        {#if mobile.current}
            <div class="mb-4 flex items-center justify-between gap-4 pl-4">
                <span class="text-xl text-text">Phodrive</span>
                <IconButton title="Close navigation" onclick={() => (open = false)}>
                    <IconClose aria-hidden="true" />
                </IconButton>
            </div>
        {/if}
        <NavigationDrawerItem
            label="My files"
            aria-label="My files"
            selected={view === AppView.Files}
            aria-current={view === AppView.Files ? 'page' : undefined}
            onclick={() => navigate(AppView.Files)}
        >
            {#snippet icon()}<IconHome aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>
        <NavigationDrawerItem
            label="Settings"
            aria-label="Settings"
            selected={view === AppView.Settings}
            aria-current={view === AppView.Settings ? 'page' : undefined}
            onclick={() => navigate(AppView.Settings)}
        >
            {#snippet icon()}<IconSettings aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>
    </NavigationDrawer>

    <div class="mobile-upload">
        <Fab
            label="Upload"
            variant="secondary-container"
            shape="square"
            {disabled}
            onclick={() => (connected ? picker.click() : onconnect())}
        >
            {#snippet icon()}<IconAdd aria-hidden="true" class="size-6" />{/snippet}
        </Fab>
    </div>
</aside>

<style>
    .mobile-upload {
        display: none;
    }

    :global(.mobile-navigation) {
        --np-navigation-drawer-width: min(320px, calc(100vw - 56px));
        --np-navigation-drawer-padding: max(16px, env(safe-area-inset-top, 0px)) 12px 24px;
        --np-color-secondary-container: var(--app-selected);
        --np-color-on-secondary-container: var(--app-selected-text);
    }

    :global(:root .upload-button.np-extended-fab) {
        height: 56px;
        min-width: 110px;
        margin-bottom: 22px;
        border: 1px solid var(--app-border);
        --np-fab-container-color: var(--app-panel);
        --np-fab-icon-color: var(--app-text);
        --np-fab-shape: 18px;
        --np-fab-elevation: var(--np-elevation-1);
    }

    :global(:root .drive-navigation.np-navigation-drawer-container) {
        width: 100%;
        --np-navigation-drawer-width: 100%;
        --np-navigation-drawer-height: auto;
        --np-navigation-drawer-padding: 0;
        --np-navigation-drawer-background: transparent;
        --np-color-secondary-container: var(--app-selected);
        --np-color-on-secondary-container: var(--app-selected-text);
    }

    :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer) {
        gap: 4px;
    }
    :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer-item) {
        height: 40px;
        width: 100%;
        padding: 0 18px 0 24px;
        gap: 16px;
    }

    @media (width < 800px) {
        .upload-sidebar {
            display: contents;
        }

        :global(:root .upload-button.np-extended-fab) {
            display: none;
        }

        .mobile-upload {
            display: block;
            position: fixed;
            right: calc(16px + env(safe-area-inset-right, 0px));
            bottom: calc(16px + env(safe-area-inset-bottom, 0px));
            z-index: 20;
        }
    }
</style>
