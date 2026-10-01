<script lang="ts">
    import { AppView } from '$lib/models';
    import IconAdd from '~icons/material-symbols/add';
    import IconHome from '~icons/material-symbols/home-outline';
    import IconSettings from '~icons/material-symbols/settings-outline';

    interface Props {
        connected: boolean;
        disabled: boolean;
        view: AppView;
        onnavigate: (view: AppView) => void;
        onupload: (files: File[]) => void;
        onconnect: () => void;
    }

    let { connected, disabled, view, onnavigate, onupload, onconnect }: Props = $props();

    let picker: HTMLInputElement;
</script>

<aside
    class="min-w-0 px-4 pt-2 pb-8 max-[800px]:flex max-[800px]:flex-wrap max-[800px]:items-center max-[800px]:gap-3 max-[800px]:pb-4"
    aria-label="Navigation and accounts"
>
    <button
        class="mb-5.5 flex h-14 min-w-27.5 items-center gap-4 rounded-[18px] border border-border bg-panel px-4.5 text-[15px] font-medium text-text shadow-sm transition-shadow hover:shadow-md disabled:cursor-default disabled:opacity-50 max-[800px]:m-0 max-[800px]:h-11.5 max-[800px]:min-w-25 max-[800px]:rounded-[14px]"
        type="button"
        {disabled}
        onclick={() => (connected ? picker.click() : onconnect())}
    >
        <IconAdd aria-hidden="true" class="size-6" />Upload
    </button>

    <input
        bind:this={picker}
        type="file"
        multiple
        class="sr-only"
        aria-label="Upload files"
        onchange={(event) => {
            const files = Array.from(event.currentTarget.files ?? []);
            event.currentTarget.value = '';

            if (!files.length) return;

            onupload(files);
        }}
    />

    <nav class="grid gap-1 max-[800px]:flex" aria-label="Main">
        <button
            class={[
                'flex h-10 w-full cursor-pointer items-center gap-4 rounded-[22px] border-0 pr-4.5 pl-6 text-left text-sm font-semibold transition-colors max-[800px]:w-auto max-[800px]:px-3.25 max-[520px]:gap-2 max-[520px]:text-[13px]',
                view === AppView.Files
                    ? 'bg-selected text-selected-text'
                    : 'bg-transparent text-subtle hover:bg-hover'
            ]}
            type="button"
            aria-current={view === AppView.Files ? 'page' : undefined}
            onclick={() => onnavigate(AppView.Files)}
        >
            <IconHome aria-hidden="true" class="size-5 shrink-0" />My files
        </button>
        <button
            class={[
                'flex h-10 w-full cursor-pointer items-center gap-4 rounded-[22px] border-0 pr-4.5 pl-6 text-left text-sm font-semibold transition-colors max-[800px]:w-auto max-[800px]:px-3.25 max-[520px]:gap-2 max-[520px]:text-[13px]',
                view === AppView.Settings
                    ? 'bg-selected text-selected-text'
                    : 'bg-transparent text-subtle hover:bg-hover'
            ]}
            type="button"
            aria-current={view === AppView.Settings ? 'page' : undefined}
            onclick={() => onnavigate(AppView.Settings)}
        >
            <IconSettings aria-hidden="true" class="size-5 shrink-0" />Settings
        </button>
    </nav>
</aside>
