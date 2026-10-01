<script lang="ts">
    interface Props {
        email: string;
        small?: boolean;
    }

    let { email, small = false }: Props = $props();
</script>

<span
    aria-hidden="true"
    class="grid shrink-0 place-items-center rounded-full bg-avatar text-avatar-text"
    class:size-8={small}
    class:text-[15px]={small}
    class:size-11={!small}
    class:text-xl={!small}
>
    {email.slice(0, 1).toUpperCase() || 'P'}
</span>
