<script lang="ts">
    import { Snackbar } from 'noph-ui';
    import IconClose from '~icons/material-symbols/close';

    let { message = $bindable('') }: { message?: string } = $props();
</script>

<Snackbar
    class="error-feedback"
    label={message}
    timeout={0}
    bind:open={
        () => !!message,
        (open) => {
            if (!open) message = '';
        }
    }
    iconAriaLabel="Dismiss theme error"
>
    {#snippet icon()}<IconClose aria-hidden="true" />{/snippet}
</Snackbar>

<style>
    :global(:root .error-feedback.np-snackbar[popover]) {
        inset: 64px 72px auto auto;
        margin: 0;
        min-width: 0;
        max-width: min(320px, calc(100vw - 32px));
        --np-snackbar-container-color: var(--app-panel);
        --np-snackbar-text-color: var(--np-color-error);
        --np-snackbar-container-shape: 10px;
    }

    :global(:root .error-feedback.np-snackbar .np-snackbar-label) {
        text-wrap: wrap;
    }

    @media (max-width: 800px) {
        :global(:root .error-feedback.np-snackbar[popover]) {
            top: 72px;
            right: 16px;
        }
    }
</style>
