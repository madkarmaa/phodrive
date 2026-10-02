<script lang="ts">
    import { Button, Card, TextField } from 'noph-ui';
    import { NewAccountSchema } from '$lib/models';

    interface Props {
        email?: string;
        token?: string;
        connecting: boolean;
        canCancel: boolean;
        onsave: () => void;
        oncancel: () => void;
    }

    let {
        email = $bindable(''),
        token = $bindable(''),
        connecting,
        canCancel,
        onsave,
        oncancel
    }: Props = $props();

    let emailTouched = $state(false);
    let tokenTouched = $state(false);
    let emailInput = $state<HTMLInputElement | HTMLTextAreaElement>();
    let tokenInput = $state<HTMLInputElement | HTMLTextAreaElement>();
    const validation = $derived(
        NewAccountSchema.safeParse({ email: email.trim(), token: token.trim() })
    );
    const emailIssues = $derived(
        emailTouched && !validation.success
            ? validation.error.issues.filter((issue) => issue.path[0] === 'email')
            : undefined
    );
    const tokenIssues = $derived(
        tokenTouched && !validation.success
            ? validation.error.issues.filter((issue) => issue.path[0] === 'token')
            : undefined
    );
</script>

<div class="max-w-162.5">
    <Card type="text" variant="outlined" class="account-setup-card">
        <div class="p-7 max-[520px]:p-4">
            <h2 class="text-xl font-medium">Connect to Google Photos</h2>
            <p class="mt-2 text-sm leading-normal text-muted">
                Enter your Google email and an OAuth2 token. Phodrive exchanges it locally and saves
                only the AAS token in this browser.
            </p>

            <form
                class="mt-7 grid gap-4.5"
                novalidate
                onsubmit={(event) => {
                    event.preventDefault();
                    emailTouched = true;
                    tokenTouched = true;
                    if (!validation.success) {
                        const firstField = validation.error.issues[0]?.path[0];
                        (firstField === 'email' ? emailInput : tokenInput)?.focus();
                        return;
                    }

                    onsave();
                }}
            >
                <div class="field min-w-0">
                    <TextField
                        label="Google account email"
                        type="email"
                        bind:value={email}
                        bind:inputElement={emailInput}
                        issues={emailIssues}
                        onblur={() => (emailTouched = true)}
                        disabled={connecting}
                        autocomplete="email"
                        required
                    />
                </div>
                <div class="field min-w-0">
                    <TextField
                        label="OAuth2 or AAS token"
                        type="password"
                        bind:value={token}
                        bind:inputElement={tokenInput}
                        issues={tokenIssues}
                        onblur={() => (tokenTouched = true)}
                        disabled={connecting}
                        autocomplete="off"
                        required
                    />
                </div>
                <div class="flex flex-wrap items-center gap-2.5">
                    <Button
                        type="submit"
                        variant="filled"
                        size="s"
                        loading={connecting}
                        loadingAriaLabel="Connecting account"
                    >
                        Save account
                    </Button>
                    {#if canCancel}
                        <Button
                            type="button"
                            size="s"
                            variant="text"
                            disabled={connecting}
                            onclick={oncancel}
                        >
                            Cancel
                        </Button>
                    {/if}
                </div>
            </form>
        </div>
    </Card>

    <div class="px-1 py-7">
        <h2 class="text-xl font-medium">Get your OAuth2 token</h2>
        <ol class="mt-3.75 grid list-decimal gap-2.25 pl-5 text-sm leading-relaxed text-muted">
            <li>
                Open <Button
                    class="setup-link"
                    variant="text"
                    size="xs"
                    href="https://accounts.google.com/EmbeddedSetup"
                    target="_blank"
                    rel="noreferrer">Google Embedded Setup</Button
                > and sign in.
            </li>
            <li>
                In developer tools, open Application → Cookies →
                <code>https://accounts.google.com</code> and copy the cookie value starting with
                <code>oauth2_4/…</code>.
            </li>
            <li>
                Paste it above with your email. An existing <code>aas_et/…</code> token also works.
            </li>
        </ol>
    </div>
</div>

<style>
    :global(:root .setup-link.np-button) {
        display: inline-flex;
        height: auto;
        padding: 0;
        font: inherit;
        vertical-align: baseline;
        text-decoration: underline;
    }

    :global(:root .account-setup-card.np-card-container) {
        width: 100%;
    }
    :global(:root .account-setup-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        width: 100%;
        min-width: 0;
    }

    .field :global(.np-text-field) {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
    }

    .field :global(input) {
        box-sizing: border-box;
    }
</style>
