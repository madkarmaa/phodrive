<script lang="ts">
    import { IconButton } from 'noph-ui';
    import IconRefresh from '~icons/material-symbols/refresh';

    interface Props {
        refreshing: boolean;
        disabled: boolean;
        onrefresh: () => void;
    }

    let { refreshing, disabled, onrefresh }: Props = $props();
</script>

<span class="refresh-control" role="group" aria-label="Refresh files" aria-busy={refreshing}>
    <IconButton
        size="s"
        title={refreshing ? 'Refreshing files' : 'Refresh files'}
        disabled={disabled || refreshing}
        onclick={onrefresh}
    >
        <span class="refresh-icon" class:refreshing aria-hidden="true">
            <IconRefresh />
        </span>
    </IconButton>
</span>

<style>
    .refresh-control,
    .refresh-icon {
        display: inline-flex;
    }

    @media (prefers-reduced-motion: no-preference) {
        .refresh-icon.refreshing {
            animation: refresh-spin 1s linear infinite;
        }
    }

    @keyframes refresh-spin {
        to {
            transform: rotate(360deg);
        }
    }
</style>
