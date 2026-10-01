<script lang="ts">
    import type { Snippet } from 'svelte';
    import 'noph-ui/defaultTheme';
    import './layout.css';
    import '@fontsource-variable/google-sans-flex/opsz.css';

    interface Props {
        children: Snippet;
    }

    let { children }: Props = $props();
</script>

{@render children()}
