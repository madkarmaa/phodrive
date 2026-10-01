<script lang="ts">
    import { Button, Card, TextField } from 'm3-svelte';

    interface Props {
        email?: string;
        token?: string;
        connecting: boolean;
        message: string;
        canCancel: boolean;
        onsave: () => void;
        oncancel: () => void;
    }

    let {
        email = $bindable(''),
        token = $bindable(''),
        connecting,
        message,
        canCancel,
        onsave,
        oncancel
    }: Props = $props();
</script>

<div class="max-w-162.5">
    <Card variant="outlined">
        <div class="p-7 max-[520px]:p-4">
            <h2 class="text-xl font-medium">Connect to Google Photos</h2>
            <p class="mt-2 text-sm leading-normal text-muted">
                Enter your Google email and an OAuth2 token. Phodrive exchanges it locally and saves
                only the AAS token in this browser.
            </p>

            <form
                class="mt-7 grid gap-4.5"
                onsubmit={(event) => {
                    event.preventDefault();
                    onsave();
                }}
            >
                <div class="field min-w-0">
                    <TextField
                        label="Google account email"
                        type="email"
                        bind:value={email}
                        autocomplete="email"
                        required
                    />
                </div>
                <div class="field min-w-0">
                    <TextField
                        label="OAuth2 or AAS token"
                        type="password"
                        bind:value={token}
                        autocomplete="off"
                        required
                    />
                </div>
                <div class="flex flex-wrap items-center gap-2.5">
                    <Button type="submit" size="m" disabled={connecting}
                        >{connecting ? 'Connecting…' : 'Save account'}</Button
                    >
                    {#if canCancel}<Button
                            size="m"
                            variant="text"
                            disabled={connecting}
                            onclick={oncancel}>Cancel</Button
                        >{/if}
                </div>
            </form>

            {#if message}<p role="alert" class="mt-3.5 text-sm text-error">{message}</p>{/if}
        </div>
    </Card>

    <div class="px-1 py-7">
        <h2 class="text-xl font-medium">Get your OAuth2 token</h2>
        <ol class="mt-3.75 grid list-decimal gap-2.25 pl-5 text-sm leading-relaxed text-muted">
            <li>
                Open <a
                    class="text-primary underline"
                    href="https://accounts.google.com/EmbeddedSetup"
                    target="_blank"
                    rel="noreferrer">Google Embedded Setup</a
                > and sign in.
            </li>
            <li>Copy the one-time <code>oauth2_4/…</code> token from developer tools.</li>
            <li>
                Paste it above with your email. An existing <code>aas_et/…</code> token also works.
            </li>
        </ol>
    </div>
</div>

<style>
    .field :global(.m3-container) {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
    }

    .field :global(input) {
        box-sizing: border-box;
    }
</style>
