<script lang="ts">
    import { browser } from '$app/environment';

    interface Props {
        timestamp: number;
    }

    let { timestamp }: Props = $props();
    let languages = $state.raw<readonly string[] | undefined>(
        browser ? navigator.languages : undefined
    );
    const formatter = $derived(new Intl.DateTimeFormat(languages));
    const date = $derived(new Date(timestamp));
    const validDate = $derived(Number.isFinite(date.getTime()));
</script>

<svelte:window onlanguagechange={() => (languages = navigator.languages)} />

<time datetime={validDate ? date.toISOString() : undefined}>
    {validDate ? formatter.format(date) : 'Invalid date'}
</time>
