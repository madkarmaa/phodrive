<script lang="ts">
    import { fly } from 'svelte/transition';
    import { onMount } from 'svelte';
    import { onClickOutside } from 'runed';
    import { prefersReducedMotion } from 'svelte/motion';
    import Avatar from '$components/Avatar.svelte';
    import IconAdd from '~icons/material-symbols/add';
    import IconClose from '~icons/material-symbols/close';
    import IconLogout from '~icons/material-symbols/logout';

    interface Props {
        emails: string[];
        selected: string;
        disabled: boolean;
        onclose: () => void;
        onselect: (email: string) => void;
        onadd: () => void;
        onsignout: () => void;
    }

    let { emails, selected, disabled, onclose, onselect, onadd, onsignout }: Props = $props();

    let menu = $state<HTMLDivElement>();

    function closeMenu() {
        if (menu?.contains(document.activeElement)) {
            document.querySelector<HTMLButtonElement>('[aria-controls="account-menu"]')?.focus();
        }

        onclose();
    }

    onMount(() => menu?.querySelector<HTMLButtonElement>('button')?.focus());

    onClickOutside(
        () => menu,
        (event) => {
            const target = event.target;
            if (target instanceof Element && target.closest('[aria-controls="account-menu"]'))
                return;

            closeMenu();
        }
    );
</script>

<svelte:window
    onkeydown={(event) => {
        if (event.key === 'Escape') closeMenu();
    }}
/>

<div
    id="account-menu"
    bind:this={menu}
    class="fixed inset-x-4 top-16 z-20 ml-auto box-border max-h-[calc(100dvh-5rem)] max-w-100 overflow-y-auto overscroll-contain rounded-[28px] border border-border bg-menu px-4 pt-13 pb-5 text-text shadow-lg max-[800px]:top-18"
    role="dialog"
    aria-label="Accounts"
    transition:fly={{ y: -8, duration: prefersReducedMotion.current ? 0 : 160 }}
>
    <button
        class="icon-button absolute top-3 right-5 size-8 text-subtle"
        type="button"
        aria-label="Close account menu"
        onclick={closeMenu}><IconClose aria-hidden="true" /></button
    >

    <div class="overflow-hidden rounded-[28px] bg-panel">
        {#if selected}
            <div class="flex min-h-20.5 items-center gap-4 px-4.5 py-2.5">
                <Avatar email={selected} />
                <div class="min-w-0">
                    <strong class="block truncate text-base font-medium">{selected}</strong>
                    <small class="mt-0.5 block text-xs text-muted">Current account</small>
                </div>
            </div>
        {/if}

        {#each emails.filter((email) => email !== selected) as email (email)}
            <button
                class="account-row"
                type="button"
                {disabled}
                onclick={() => {
                    onselect(email);
                    closeMenu();
                }}
            >
                <span class="mx-1.5"><Avatar {email} small /></span>
                <span class="min-w-0 truncate">{email}</span>
            </button>
        {/each}

        <button
            class="account-row"
            type="button"
            {disabled}
            onclick={() => {
                onadd();
                closeMenu();
            }}
        >
            <span
                class="mx-1.5 grid size-8 shrink-0 place-items-center rounded-full bg-search text-primary"
                ><IconAdd class="size-5.5" aria-hidden="true" /></span
            >
            Add another account
        </button>

        {#if selected}
            <button
                class="account-row"
                type="button"
                {disabled}
                onclick={() => {
                    onsignout();
                    closeMenu();
                }}
            >
                <span
                    class="mx-1.5 grid size-8 shrink-0 place-items-center rounded-full bg-search text-primary"
                    ><IconLogout class="size-5.5" aria-hidden="true" /></span
                >
                Sign out
            </button>
        {/if}
    </div>

    <p class="mx-2 mt-4 text-center text-xs text-muted">
        Only saved accounts in this browser are shown here.
    </p>
</div>
