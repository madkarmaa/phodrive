<script lang="ts">
    import { onMount } from 'svelte';
    import { MediaQuery } from 'svelte/reactivity';
    import type { ThemeMode } from '$lib/models';
    import { APP_NAME, APP_VERSION, APP_MOTTO, APP_REPOSITORY_URL } from '$lib/app-info';
    import darkLogo from '$assets/favicon.svg';
    import lightLogo from '$assets/favicon-light.svg';
    import IconCode from '~icons/material-symbols/code';

    interface Props {
        theme: ThemeMode;
    }

    let { theme }: Props = $props();
    let mounted = $state(false);

    const systemDark = new MediaQuery('(prefers-color-scheme: dark)');
    const useDarkIcon = $derived(theme === 'dark' || (theme === 'auto' && systemDark.current));
    const logo = $derived(mounted && useDarkIcon ? darkLogo : lightLogo);

    onMount(() => {
        mounted = true;
    });
</script>

<footer
    class="mt-auto flex flex-wrap items-center gap-3 border-t border-border pt-5 text-xs text-muted"
>
    <img src={logo} alt="" class="size-9 shrink-0" />

    <div class="grid gap-1">
        <p class="flex items-center gap-2">
            <span class="font-medium text-subtle">{APP_NAME}</span>
            <span aria-hidden="true">·</span>
            <span>v{APP_VERSION}</span>
        </p>
        <p>{APP_MOTTO}</p>
        <a
            href={APP_REPOSITORY_URL}
            class="inline-flex w-fit items-center gap-1.5 text-primary underline decoration-transparent underline-offset-2 transition-colors hover:decoration-current"
            target="_blank"
            rel="noreferrer"
        >
            <IconCode aria-hidden="true" class="size-4" />
            Source
        </a>
    </div>
</footer>
