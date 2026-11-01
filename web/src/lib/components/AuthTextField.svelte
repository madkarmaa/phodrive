<script lang="ts">
    import { TextField } from 'noph-ui';
    import type { ComponentProps } from 'svelte';

    type TextFieldProps = ComponentProps<typeof TextField>;

    interface Props {
        label: string;
        type: 'email' | 'password';
        value: string;
        input?: HTMLInputElement | HTMLTextAreaElement;
        issues: TextFieldProps['issues'];
        disabled: boolean;
        autocomplete: TextFieldProps['autocomplete'];
        onblur: () => void;
    }

    let {
        label,
        type,
        value = $bindable(),
        input = $bindable(),
        issues,
        disabled,
        autocomplete,
        onblur
    }: Props = $props();
</script>

<div class="field min-w-0">
    <TextField
        {label}
        {type}
        bind:value
        bind:inputElement={input}
        {issues}
        {onblur}
        {disabled}
        {autocomplete}
        required
    />
</div>

<style>
    .field :global(.np-text-field) {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
    }

    .field :global(input) {
        box-sizing: border-box;
    }
</style>
