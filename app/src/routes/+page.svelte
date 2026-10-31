<script lang="ts">
    import type { PageData } from './$types';
    import AuthPanel from '#components/AuthPanel.svelte';
    import Drive from '#components/Drive.svelte';

    interface Props {
        data: PageData;
    }

    let { data }: Props = $props();
</script>

{#if data.user}
    {#key data.user.email}
        <Drive email={data.user.email} preferencesDefaults={data.preferencesDefaults} />
    {/key}
{:else}
    <AuthPanel signupEnabled={data.signupEnabled} />
{/if}
