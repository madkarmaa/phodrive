<script lang="ts">
    import { Button } from 'noph-ui';
</script>

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
        <li>Paste it above. An existing <code>aas_et/…</code> token also works.</li>
    </ol>
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
</style>
