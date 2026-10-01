import { useInterval, watch } from 'runed';

/** Refresh when idle, with reactive timing and component lifecycle cleanup. */
export function useAutomaticRefresh(
    seconds: () => number,
    enabled: () => boolean,
    refresh: () => Promise<void>
): void {
    let running = false;

    async function refreshWhenIdle() {
        if (running || !enabled() || seconds() === 0) return;

        running = true;

        try {
            await refresh();
        } finally {
            running = false;
        }
    }

    const interval = useInterval(() => Math.max(1, seconds()) * 1000, {
        immediate: false,
        callback: () => {
            void refreshWhenIdle();
        }
    });

    watch([seconds, enabled], ([delay, active]) => {
        if (!active || delay === 0) {
            interval.pause();
            return;
        }

        interval.resume();
    });
}
