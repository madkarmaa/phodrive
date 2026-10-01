<script lang="ts">
    import { onMount } from 'svelte';
    import { MediaQuery } from 'svelte/reactivity';
    import type { ThemeMode } from '$lib/models';
    import ThemeButton from '$components/ThemeButton.svelte';
    import darkLogo from '$assets/favicon.svg';
    import lightLogo from '$assets/favicon-light.svg';
    import IconSearch from '~icons/material-symbols/search';
    import IconRefresh from '~icons/material-symbols/refresh';

    interface Props {
        search?: string;
        email: string;
        theme: ThemeMode;
        menuOpen: boolean;
        refreshing: boolean;
        refreshDisabled: boolean;
        onrefresh: () => void;
        ontheme: (mode: ThemeMode) => void;
        onmenu: () => void;
    }

    let {
        search = $bindable(''),
        email,
        theme,
        menuOpen,
        refreshing,
        refreshDisabled,
        onrefresh,
        ontheme,
        onmenu
    }: Props = $props();

    let mounted = $state(false);

    const systemDark = new MediaQuery('(prefers-color-scheme: dark)');
    const useDarkIcon = $derived(theme === 'dark' || (theme === 'auto' && systemDark.current));
    const logo = $derived(mounted && useDarkIcon ? darkLogo : lightLogo);
    const favicon = $derived(mounted && systemDark.current ? darkLogo : lightLogo);

    onMount(() => {
        mounted = true;
    });
</script>

<svelte:head><link rel="icon" type="image/svg+xml" href={favicon} /></svelte:head>

<header
    class="col-span-full grid h-16 grid-cols-[256px_minmax(240px,720px)_1fr] items-center gap-4 px-6 max-[800px]:h-18 max-[800px]:grid-cols-[auto_minmax(120px,1fr)_auto] max-[800px]:gap-3 max-[800px]:px-4 max-[520px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[520px]:gap-2"
>
    <div
        class="flex items-center gap-3 text-[22px] whitespace-nowrap text-subtle"
        aria-label="Phodrive"
    >
        <img src={logo} alt="" class="size-10 max-[520px]:size-8" />
        <span class="max-[800px]:hidden">Phodrive</span>
    </div>

    <label
        class="flex h-12 items-center gap-4 rounded-[28px] bg-search px-5 focus-within:bg-panel focus-within:shadow-sm max-[800px]:h-11 max-[800px]:px-3.5 max-[520px]:gap-2"
    >
        <IconSearch aria-hidden="true" class="size-6 shrink-0 text-subtle" />
        <input
            type="search"
            aria-label="Search files"
            placeholder="Search in Phodrive"
            bind:value={search}
            disabled={!email}
            class="w-full min-w-0 border-0 bg-transparent p-0 text-text outline-none placeholder:text-subtle focus:ring-0 max-[800px]:text-sm max-[520px]:placeholder:text-transparent"
        />
    </label>

    <div class="flex items-center gap-2 justify-self-end">
        <button
            class="icon-button shrink-0 text-subtle disabled:cursor-default disabled:opacity-50"
            type="button"
            aria-label="Refresh files"
            title="Refresh files"
            disabled={refreshDisabled}
            onclick={onrefresh}
        >
            <IconRefresh aria-hidden="true" class={refreshing ? 'motion-safe:animate-spin' : ''} />
        </button>
        <ThemeButton mode={theme} onchange={ontheme} />
        <button
            class="grid size-10 cursor-pointer place-items-center rounded-full border-0 bg-avatar font-medium text-avatar-text transition-shadow hover:ring-4 hover:ring-hover"
            type="button"
            title={email || 'No account connected'}
            aria-label="Manage accounts"
            aria-haspopup="dialog"
            aria-controls="account-menu"
            aria-expanded={menuOpen}
            onclick={onmenu}
        >
            {email.slice(0, 1).toUpperCase() || 'P'}
        </button>
    </div>
</header>
