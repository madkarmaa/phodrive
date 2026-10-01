<script lang="ts" generics="Value extends string">
    import type { Snippet } from 'svelte';

    interface Props {
        label: string;
        ariaLabel: string;
        value: Value;
        options: readonly { value: Value; label: string }[];
        icon: Snippet;
        class?: string;
    }

    let {
        label,
        ariaLabel,
        value = $bindable(),
        options,
        icon,
        class: className = ''
    }: Props = $props();

    const selectedLabel = $derived(options.find((option) => option.value === value)?.label ?? '');
</script>

<label
    class={['filter-chip', className, 'max-[520px]:size-11']}
    title={`${label}: ${selectedLabel}`}
>
    <span
        class="pointer-events-none absolute inset-y-0 right-7 left-2.5 flex items-center gap-3 max-[520px]:hidden"
        aria-hidden="true"
    >
        <span class="shrink-0">{label}</span>
        <span class="min-w-0 truncate text-subtle">{selectedLabel}</span>
    </span>
    <span
        class="pointer-events-none absolute inset-0 grid place-items-center min-[520px]:hidden"
        aria-hidden="true"
    >
        {@render icon()}
    </span>
    <select class="px-2.5 max-[520px]:bg-none max-[520px]:p-0" aria-label={ariaLabel} bind:value>
        {#each options as option}
            <option value={option.value}>{option.label}</option>
        {/each}
    </select>
</label>
