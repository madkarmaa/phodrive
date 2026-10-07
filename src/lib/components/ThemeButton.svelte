<script lang="ts">
    import { IconButton } from 'noph-ui';
    import { ThemeMode } from '#lib/models';
    import { NEXT_THEME } from '#browser/storage';
    import IconLightMode from '~icons/material-symbols/light-mode-outline';
    import IconDarkMode from '~icons/material-symbols/dark-mode-outline';
    import IconDesktopWindows from '~icons/material-symbols/desktop-windows-outline';

    interface Props {
        mode: ThemeMode;
        onchange: (mode: ThemeMode) => void;
    }

    let { mode, onchange }: Props = $props();
</script>

<IconButton
    size="s"
    title={'Theme: ' + mode + '. Click for ' + NEXT_THEME[mode]}
    aria-label={'Theme: ' + mode + '. Switch to ' + NEXT_THEME[mode]}
    onclick={() => onchange(NEXT_THEME[mode])}
>
    {#if mode === ThemeMode.Light}
        <IconLightMode aria-hidden="true" />
    {:else if mode === ThemeMode.Dark}
        <IconDarkMode aria-hidden="true" />
    {:else}
        <IconDesktopWindows aria-hidden="true" />
    {/if}
</IconButton>
