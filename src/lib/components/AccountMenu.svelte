<script lang="ts">
    import { IconButton, Item, Menu, MenuItem } from 'noph-ui';
    import Avatar from '$components/Avatar.svelte';
    import IconAdd from '~icons/material-symbols/add';
    import IconClose from '~icons/material-symbols/close';
    import IconLogout from '~icons/material-symbols/logout';

    interface Props {
        open?: boolean;
        anchor?: HTMLElement;
        emails: string[];
        selected: string;
        disabled: boolean;
        onselect: (email: string) => void;
        onadd: () => void;
        onsignout: () => void;
    }

    let {
        open = $bindable(false),
        anchor,
        emails,
        selected,
        disabled,
        onselect,
        onadd,
        onsignout
    }: Props = $props();
    let menu = $state<HTMLDivElement>();

    function closeMenu() {
        open = false;
        anchor?.focus();
    }
</script>

<Menu
    id="account-menu"
    bind:open
    bind:element={menu}
    {anchor}
    coverAnchor={false}
    aria-label="Accounts"
    class="account-menu"
    ontoggle={(event) => {
        if (event.newState === 'open') menu?.querySelector<HTMLButtonElement>('button')?.focus();
    }}
>
    <IconButton class="account-close" size="xs" aria-label="Close account menu" onclick={closeMenu}>
        <IconClose aria-hidden="true" />
    </IconButton>

    <div class="account-list overflow-hidden rounded-[28px] bg-panel">
        {#if selected}
            <Item class="current-account" supportingText="Current account">
                {#snippet start()}<Avatar email={selected} />{/snippet}
                <strong class="block truncate text-base font-medium">{selected}</strong>
            </Item>
        {/if}

        {#each emails.filter((email) => email !== selected) as email (email)}
            <MenuItem
                class="account-row"
                {disabled}
                onclick={() => {
                    onselect(email);
                    closeMenu();
                }}
            >
                {#snippet start()}<Avatar {email} small />{/snippet}
                <span class="block min-w-0 truncate">{email}</span>
            </MenuItem>
        {/each}

        <MenuItem
            class="account-row"
            {disabled}
            onclick={() => {
                onadd();
                closeMenu();
            }}
        >
            {#snippet start()}<IconAdd class="size-5.5 text-primary" aria-hidden="true" />{/snippet}
            Add another account
        </MenuItem>

        {#if selected}
            <MenuItem
                class="account-row"
                {disabled}
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
        {/if}
    </div>

    <p class="mx-2 mt-4 text-center text-xs text-muted">
        Only saved accounts in this browser are shown here.
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
        min-height: 82px;
        padding: 10px 18px;
    }
    :global(:root .account-list .account-row) {
        min-height: 58px;
        border-top: 2px solid var(--app-menu);
        padding: 10px 18px;
    }

    @media (max-width: 800px) {
        :global(:root .account-menu.np-menu-container[popover]) {
            top: 72px;
        }
    }
</style>
