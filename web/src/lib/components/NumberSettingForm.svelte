<script lang="ts">
    import { Button, TextField } from 'noph-ui';
    import { untrack } from 'svelte';
    import { watch } from 'runed';
    import type { z } from 'zod';

    interface Props {
        /** Names the field and its save and reset buttons, such as "refresh interval". */
        setting: string;
        heading: string;
        description: string;
        label: string;
        name: string;
        min: number;
        max: number;
        schema: z.ZodType<number>;
        value: number;
        defaultValue: number;
        onsave: (value: number) => void;
        onreset: () => void;
    }

    let {
        setting,
        heading,
        description,
        label,
        name,
        min,
        max,
        schema,
        value,
        defaultValue,
        onsave,
        onreset
    }: Props = $props();

    const descriptionId = $derived(`${name}-description`);

    let draft = $state<string | number | null>(untrack(() => value));
    let touched = $state(false);
    let input = $state<HTMLInputElement | HTMLTextAreaElement>();
    const validation = $derived(
        schema.safeParse(draft === '' || draft === null ? undefined : Number(draft), {
            error: () => `Enter a whole number from ${min} to ${max}.`
        })
    );
    const issues = $derived(touched && !validation.success ? validation.error.issues : undefined);
    const saveDisabled = $derived(!validation.success || validation.data === value);
    const resetDisabled = $derived(validation.success && validation.data === defaultValue);

    watch(
        () => value,
        (saved) => {
            draft = saved;
            touched = false;
        }
    );

    function submit(event: SubmitEvent) {
        event.preventDefault();
        touched = true;
        if (!validation.success) {
            input?.focus();
            return;
        }

        if (saveDisabled) return;

        onsave(validation.data);
    }

    function reset() {
        onreset();
        draft = value;
        touched = false;
    }
</script>

<form class="grid gap-3" novalidate onsubmit={submit}>
    <div>
        <h2 class="text-base font-medium">{heading}</h2>
        <p id={descriptionId} class="mt-1 text-sm leading-relaxed text-muted">{description}</p>
    </div>

    <div class="flex flex-wrap items-end gap-3 max-[520px]:gap-2">
        <div class="setting-field max-w-52 min-w-0 flex-1">
            <TextField
                {label}
                {name}
                type="number"
                bind:value={draft}
                bind:inputElement={input}
                {issues}
                onblur={() => (touched = true)}
                {min}
                {max}
                step="1"
                required
                aria-describedby={descriptionId}
            />
        </div>
        <Button type="submit" variant="tonal" aria-label={`Save ${setting}`} disabled={saveDisabled}
            >Save</Button
        >
        <Button
            type="button"
            variant="outlined"
            aria-label={`Reset ${setting}`}
            disabled={resetDisabled}
            onclick={reset}>Reset</Button
        >
    </div>
</form>

<style>
    .setting-field :global(.np-text-field) {
        width: 100%;
        min-width: 0;
    }
    .setting-field :global(.field) {
        min-width: 0;
    }
</style>
