<script lang="ts">
    import { AppBar, IconButton, Search } from 'noph-ui';
    import type { ThemeMode } from '@madkarmaa/phodrive-core/models';
    import AppLogo from '#components/AppLogo.svelte';
    import RefreshButton from '#components/RefreshButton.svelte';
    import ThemeButton from '#components/ThemeButton.svelte';
    import IconMenu from '~icons/material-symbols/menu';
    import IconPerson from '~icons/material-symbols/person';

    interface Props {
        search?: string;
        email: string;
        theme: ThemeMode;
        menuOpen: boolean;
        navigationOpen: boolean;
        onnavigation: () => void;
        refreshing: boolean;
        refreshDisabled: boolean;
        onrefresh: () => void;
        ontheme: (mode: ThemeMode) => void;
        accountButton?: HTMLElement;
    }

    let {
        search: searchTerm = $bindable(''),
        email,
        theme,
        menuOpen,
        navigationOpen,
        onnavigation,
        refreshing,
        refreshDisabled,
        onrefresh,
        ontheme,
        accountButton = $bindable()
    }: Props = $props();
</script>

<AppBar variant="search" class="shell-header col-span-full">
    {#snippet leading()}
        <div class="min-[800px]:hidden">
            <IconButton
                title="Open navigation"
                aria-controls="main-navigation"
                aria-expanded={navigationOpen}
                aria-haspopup="dialog"
                onclick={onnavigation}
            >
                <IconMenu aria-hidden="true" />
            </IconButton>
        </div>
        <AppLogo {theme} />
    {/snippet}

    {#snippet search()}
        <Search
            class="drive-search"
            label="Search files"
            placeholder="Search in Phodrive"
            bind:value={searchTerm}
            inputAttributes={{ disabled: !email }}
        />
    {/snippet}

    {#snippet trailing()}
        <RefreshButton {refreshing} disabled={refreshDisabled} {onrefresh} />
        <ThemeButton mode={theme} onchange={ontheme} />
        <IconButton
            id="account-button"
            class="profile-button"
            size="s"
            variant="filled"
            bind:element={accountButton}
            title="Account"
            aria-label="Account"
            aria-haspopup="menu"
            aria-controls="account-menu"
            aria-expanded={menuOpen}
            command="toggle-popover"
            commandfor="account-menu"
        >
            {#if email}
                <span>{email.slice(0, 1).toUpperCase()}</span>
            {:else}
                <IconPerson aria-hidden="true" />
            {/if}
        </IconButton>
    {/snippet}
</AppBar>

<style>
    :global(:root .shell-header.np-app-bar) {
        position: static;
        height: 64px;
        --np-app-bar-container-color: var(--np-color-surface);
    }

    :global(:root .shell-header.np-app-bar .np-app-bar-row) {
        display: grid;
        grid-template-columns: 256px minmax(240px, 720px) 1fr;
        gap: 16px;
        padding-inline: 24px;
    }

    :global(:root .shell-header.np-app-bar .np-app-bar-leading),
    :global(:root .shell-header.np-app-bar .np-app-bar-search-field) {
        min-width: 0;
        width: 100%;
        margin: 0;
    }

    :global(:root .shell-header.np-app-bar .np-app-bar-trailing) {
        justify-self: end;
        gap: 8px;
    }

    :global(:root .profile-button) {
        anchor-name: --account-button;
    }

    :global(:root .drive-search.np-search) {
        --_bar-height: 48px;
        --np-search-container-color: var(--app-search);
        --np-search-pane-margin: 0px;
        --np-search-view-margin: 0px;
    }

    @media (width < 800px) {
        :global(:root .shell-header.np-app-bar) {
            height: 72px;
        }
        :global(:root .shell-header.np-app-bar .np-app-bar-row) {
            min-height: 72px;
            grid-template-columns: auto minmax(120px, 1fr) auto;
            gap: 12px;
            padding-inline: 16px;
        }
        :global(:root .drive-search.np-search) {
            --_bar-height: 44px;
        }
        :global(:root .drive-search.np-search .np-search-input) {
            font-size: 14px;
        }

        :global(:root .shell-header.np-app-bar:has(.drive-search:focus-within) .np-app-bar-row) {
            grid-template-columns: minmax(0, 1fr);
            gap: 0;
        }

        :global(:root .shell-header.np-app-bar:has(.drive-search:focus-within) .np-app-bar-leading),
        :global(
            :root .shell-header.np-app-bar:has(.drive-search:focus-within) .np-app-bar-trailing
        ) {
            display: none;
        }

        :global(:root .drive-search.np-search:focus-within) {
            --np-search-width: 100%;
        }

        :global(
            :root .shell-header.np-app-bar:has(.drive-search:focus-within) .np-app-bar-search-field
        ) {
            padding-inline: 0;
        }
    }

    @media (max-width: 520px) {
        :global(:root .shell-header.np-app-bar .np-app-bar-row) {
            grid-template-columns: auto minmax(0, 1fr) auto;
            gap: 8px;
        }
        :global(:root .drive-search.np-search .np-search-input::placeholder) {
            color: transparent;
        }
        :global(:root .drive-search.np-search:focus-within .np-search-input::placeholder) {
            color: var(--np-color-on-surface-variant);
        }
    }
</style>
