<script lang="ts">
    import { Button, Divider } from 'noph-ui';
    import { onMount } from 'svelte';
    import { MediaQuery } from 'svelte/reactivity';
    import { ThemeMode } from '$lib/models';
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
    const useDarkIcon = $derived(
        theme === ThemeMode.Dark || (theme === ThemeMode.Auto && systemDark.current)
    );
    const logo = $derived(mounted && useDarkIcon ? darkLogo : lightLogo);

    onMount(() => {
        mounted = true;
    });
</script>

<footer class="mt-auto text-xs text-muted">
    <Divider />
    <div class="flex flex-wrap items-center gap-3 pt-5">
        <img src={logo} alt="" class="size-9 shrink-0" />

        <div class="grid gap-1">
            <p class="flex items-center gap-2">
                <span class="font-medium text-subtle">{APP_NAME}</span>
                <span aria-hidden="true">·</span>
                <span>v{APP_VERSION}</span>
            </p>
            <p>{APP_MOTTO}</p>
            <Button
                class="footer-source"
                variant="text"
                size="xs"
                href={APP_REPOSITORY_URL}
                target="_blank"
                rel="noreferrer"
            >
                {#snippet start()}<IconCode aria-hidden="true" />{/snippet}
                Source
            </Button>
        </div>
    </div>
</footer>

<style>
    :global(:root .footer-source.np-button) {
        height: auto;
        padding: 0;
        font: inherit;
        --np-button-gap: 6px;
        --np-button-icon-size: 16px;
    }
</style>
