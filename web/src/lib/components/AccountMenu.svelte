<script lang="ts">
    import { IconButton, Item, Menu, MenuItem } from 'noph-ui';
    import Avatar from '#components/Avatar.svelte';
    import IconClose from '~icons/material-symbols/close';
    import IconLogout from '~icons/material-symbols/logout';

    interface Props {
        open?: boolean;
        anchor?: HTMLElement;
        email: string;
        disabled: boolean;
        signingOut: boolean;
        onsignout: () => void;
    }

    let {
        open = $bindable(false),
        anchor,
        email,
        disabled,
        signingOut,
        onsignout
    }: Props = $props();
    let menuElement = $state<HTMLDivElement>();
    let menu = $state<ReturnType<typeof Menu>>();

    function closeMenu() {
        menu?.close();
        anchor?.focus();
    }
</script>

<Menu
    id="account-menu"
    bind:open
    bind:element={menuElement}
    bind:this={menu}
    {anchor}
    coverAnchor={false}
    aria-label="Account"
    class="account-menu"
    ontoggle={(event) => {
        if (event.newState === 'open')
            menuElement?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    }}
>
    <IconButton
        class="account-close"
        size="xs"
        role="menuitem"
        title="Close account menu"
        onclick={closeMenu}
    >
        <IconClose aria-hidden="true" />
    </IconButton>

    <div class="account-list overflow-hidden rounded-[28px] bg-panel">
        <Item class="current-account" supportingText="Signed in">
            {#snippet start()}<Avatar {email} />{/snippet}
            <strong class="block truncate text-base font-medium">{email}</strong>
        </Item>

        <MenuItem
            class="account-row"
            disabled={disabled || signingOut}
            onclick={() => {
                onsignout();
                closeMenu();
            }}
        >
            {#snippet start()}
                <IconLogout class="size-5.5 text-primary" aria-hidden="true" />
            {/snippet}
            Sign out
        </MenuItem>
    </div>

    <p class="mx-2 mt-4 text-center text-xs text-muted">
        To use another Google account, sign out and sign in with its Phodrive account.
    </p>
</Menu>

<style>
    :global(:root .account-menu.np-menu-container[popover]) {
        position: fixed;
        position-anchor: --account-button;
        position-area: none;
        position-try-fallbacks: none;
        inset: 64px 16px auto auto;
        margin: 0;
        width: min(400px, calc(100vw - 32px));
        max-height: calc(100dvh - 80px);
        border: 1px solid var(--app-border);
        --np-menu-container-shape: 28px;
    }

    :global(:root .account-menu.np-menu-container > .np-menu) {
        padding: 52px 16px 20px;
    }

    :global(:root .account-close.np-icon-button) {
        position: absolute;
        top: 12px;
        right: 20px;
    }

    :global(:root .account-list .np-item-text) {
        min-width: 0;
    }
    :global(:root .account-list .current-account) {
        --np-item-container-height: 82px;
        padding: 10px 18px;
    }
    :global(:root .account-list .account-row) {
        --np-item-container-height: 58px;
        border-top: 2px solid var(--app-menu);
        padding: 10px 18px;
    }

    @media (max-width: 800px) {
        :global(:root .account-menu.np-menu-container[popover]) {
            top: 72px;
        }
    }
</style>
