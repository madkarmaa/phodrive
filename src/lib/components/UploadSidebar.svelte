<script lang="ts">
    import { ExtendedFab, NavigationDrawer, NavigationDrawerItem } from 'noph-ui';
    import { AppView } from '$lib/models';
    import IconAdd from '~icons/material-symbols/add';
    import IconHome from '~icons/material-symbols/home-outline';
    import IconSettings from '~icons/material-symbols/settings-outline';

    interface Props {
        connected: boolean;
        disabled: boolean;
        view: AppView;
        onnavigate: (view: AppView) => void;
        onupload: (files: File[]) => void;
        onconnect: () => void;
    }

    let { connected, disabled, view, onnavigate, onupload, onconnect }: Props = $props();

    let picker: HTMLInputElement;
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

    <NavigationDrawer class="drive-navigation" aria-label="Main">
        <NavigationDrawerItem
            label="My files"
            aria-label="My files"
            selected={view === AppView.Files}
            aria-current={view === AppView.Files ? 'page' : undefined}
            onclick={() => onnavigate(AppView.Files)}
        >
            {#snippet icon()}<IconHome aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>
        <NavigationDrawerItem
            label="Settings"
            aria-label="Settings"
            selected={view === AppView.Settings}
            aria-current={view === AppView.Settings ? 'page' : undefined}
            onclick={() => onnavigate(AppView.Settings)}
        >
            {#snippet icon()}<IconSettings aria-hidden="true" class="size-5 shrink-0" />{/snippet}
        </NavigationDrawerItem>
    </NavigationDrawer>
</aside>

<style>
    .upload-sidebar {
        container: mobile-navigation / inline-size;
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
            display: flex;
            flex-wrap: nowrap;
            align-items: center;
            gap: 12px;
            padding-bottom: 16px;
        }

        :global(:root .upload-button.np-extended-fab) {
            height: 46px;
            min-width: 100px;
            margin: 0;
            flex-shrink: 0;
        }
        :global(:root .drive-navigation.np-navigation-drawer-container) {
            width: auto;
        }
        :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer) {
            flex-direction: row;
        }
        :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer-item) {
            width: auto;
            padding-inline: 13px;
            flex-shrink: 0;
        }

        @container mobile-navigation (max-width: 360px) {
            :global(:root .upload-button.np-extended-fab) {
                width: 46px;
                min-width: 46px;
                padding: 0;
                gap: 0;
                justify-content: center;
            }

            :global(:root .upload-button.np-extended-fab .np-fab-label),
            :global(
                :root
                    .drive-navigation
                    .np-navigation-drawer-item:not([aria-current='page'])
                    .np-navigation-drawer-item-label
            ) {
                display: none;
            }

            :global(
                :root
                    .drive-navigation.np-navigation-drawer-container
                    .np-navigation-drawer-item:not([aria-current='page'])
            ) {
                width: 44px;
                padding: 0;
                justify-content: center;
                gap: 0;
            }
        }
    }

    @media (max-width: 520px) {
        :global(:root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer-item) {
            gap: 8px;
        }
        :global(
            :root .drive-navigation.np-navigation-drawer-container .np-navigation-drawer-item-label
        ) {
            font-size: 13px;
        }
    }
</style>
