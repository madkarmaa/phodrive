<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import { GoogleTokenSchema } from '#lib/auth';
    import TokenHelp from '#components/TokenHelp.svelte';

    interface Props {
        email: string;
        replacing: boolean;
        onreplace: (token: string) => Promise<boolean>;
    }

    let { email, replacing, onreplace }: Props = $props();

    let token = $state('');
    let touched = $state(false);
    let showHelp = $state(false);
    let input = $state<HTMLInputElement | HTMLTextAreaElement>();
    const validation = $derived(GoogleTokenSchema.safeParse({ token: token.trim() }));
    const issues = $derived(touched && !validation.success ? validation.error.issues : undefined);
</script>

<form
    class="grid gap-3"
    novalidate
    onsubmit={async (event) => {
        event.preventDefault();
        touched = true;
        if (!validation.success) {
            input?.focus();
            return;
        }

        const replaced = await onreplace(validation.data.token);
        if (!replaced) return;

        token = '';
        touched = false;
    }}
>
    <div>
        <h2 class="text-base font-medium">Google token</h2>
        <p id="token-description" class="mt-1 text-sm leading-relaxed text-muted">
            Replace the stored token for {email} if Google stops accepting it. The server validates and
            encrypts the new token; it is never sent back to this browser.
        </p>
    </div>

    <div class="flex flex-wrap items-end gap-3 max-[520px]:gap-2">
        <div class="settings-field max-w-96 min-w-0 flex-1">
            <TextField
                label="New OAuth2 or AAS token"
                name="token"
                type="password"
                bind:value={token}
                bind:inputElement={input}
                {issues}
                onblur={() => (touched = true)}
                disabled={replacing}
                autocomplete="off"
                required
                aria-describedby="token-description"
            />
        </div>
        <Button
            type="submit"
            variant="tonal"
            loading={replacing}
            loadingAriaLabel="Replacing Google token">Replace</Button
        >
        <Button type="button" variant="text" onclick={() => (showHelp = !showHelp)}>
            {showHelp ? 'Hide steps' : 'How to get a token'}
        </Button>
    </div>

    {#if showHelp}
        <TokenHelp />
    {/if}
</form>

<style>
    .settings-field :global(.np-text-field) {
        width: 100%;
        min-width: 0;
    }
</style>
