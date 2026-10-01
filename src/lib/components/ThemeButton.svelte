<script lang="ts">
    import type { ThemeMode } from '$lib/models';
    import { NEXT_THEME } from '$browser/storage';
    import IconLightMode from '~icons/material-symbols/light-mode-outline';
    import IconDarkMode from '~icons/material-symbols/dark-mode-outline';
    import IconDesktopWindows from '~icons/material-symbols/desktop-windows-outline';

    interface Props {
        mode: ThemeMode;
        onchange: (mode: ThemeMode) => void;
    }

    let { mode, onchange }: Props = $props();
</script>

<button
    class="icon-button text-subtle"
    type="button"
    title={'Theme: ' + mode + '. Click for ' + NEXT_THEME[mode]}
    aria-label={'Theme: ' + mode + '. Switch to ' + NEXT_THEME[mode]}
    onclick={() => onchange(NEXT_THEME[mode])}
>
    {#if mode === 'light'}
        <IconLightMode aria-hidden="true" />
    {:else if mode === 'dark'}
        <IconDarkMode aria-hidden="true" />
    {:else}
        <IconDesktopWindows aria-hidden="true" />
    {/if}
</button>
