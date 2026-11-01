<script lang="ts">
    import { onMount } from 'svelte';
    import { MediaQuery } from 'svelte/reactivity';
    import { ThemeMode } from '@madkarmaa/phodrive-core/models';
    import darkLogo from '#assets/favicon.svg';
    import lightLogo from '#assets/favicon-light.svg';

    interface Props {
        theme: ThemeMode;
    }

    let { theme }: Props = $props();

    let mounted = $state(false);

    const systemDark = new MediaQuery('(prefers-color-scheme: dark)');
    const useDarkIcon = $derived(
        theme === ThemeMode.Dark || (theme === ThemeMode.Auto && systemDark.current)
    );
    const logo = $derived(mounted && useDarkIcon ? darkLogo : lightLogo);
    const favicon = $derived(mounted && systemDark.current ? darkLogo : lightLogo);

    onMount(() => {
        mounted = true;
    });
</script>

<svelte:head><link rel="icon" type="image/svg+xml" href={favicon} /></svelte:head>

<div
    class="flex items-center gap-3 text-[22px] whitespace-nowrap text-subtle max-[800px]:hidden"
    aria-label="Phodrive"
>
    <img src={logo} alt="" class="size-10 max-[520px]:size-8" />
    <span class="max-[800px]:hidden">Phodrive</span>
</div>
