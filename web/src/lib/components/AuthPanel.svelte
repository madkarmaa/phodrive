<script lang="ts">
    import { Button, Card, Tab, Tabs } from 'noph-ui';
    import { invalidateAll } from '$app/navigation';
    import type { SignInInput, SignUpInput } from '@madkarmaa/phodrive-core/auth';
    import { AuthForm, type AuthField } from '#lib/auth-form.svelte';
    import { APP_MOTTO, APP_NAME } from '#lib/app';
    import { signIn, signUp } from '#browser/auth';
    import AuthTextField from '#components/AuthTextField.svelte';
    import TokenHelp from '#components/TokenHelp.svelte';
    import ErrorFeedback from '#components/ErrorFeedback.svelte';
    import logo from '#assets/favicon.svg';

    interface Props {
        signupEnabled: boolean;
    }

    let { signupEnabled }: Props = $props();

    const form = new AuthForm(() => signupEnabled);
    let submitting = $state(false);
    let feedback = $state('');
    let inputs = $state<Partial<Record<AuthField, HTMLInputElement | HTMLTextAreaElement>>>({});

    function chooseMode(next: string) {
        form.choose(next === 'sign-up' ? 'sign-up' : 'sign-in');
        feedback = '';
    }

    async function send(input: SignInInput | SignUpInput) {
        submitting = true;
        feedback = '';

        const result =
            'token' in input
                ? await signUp({ email: input.email, password: input.password, token: input.token })
                : await signIn(input);

        submitting = false;

        await result.match({
            Ok: () => invalidateAll(),
            Err: async (error) => {
                feedback = error.message;
            }
        });
    }

    function submit(event: SubmitEvent) {
        event.preventDefault();

        const submitted = form.submit();
        if ('invalid' in submitted) {
            if (submitted.invalid) inputs[submitted.invalid]?.focus();
            return;
        }

        void send(submitted.input);
    }
</script>

<main class="mx-auto grid min-h-screen w-full max-w-162.5 content-center px-4 py-10">
    <div class="mb-6 flex items-center gap-3">
        <img src={logo} alt="" class="size-10" />
        <div>
            <h1 class="text-[22px] text-text">{APP_NAME}</h1>
            <p class="text-sm text-muted">{APP_MOTTO}</p>
        </div>
    </div>

    <Card type="text" variant="outlined" class="auth-card">
        <div class="p-7 max-[520px]:p-4">
            {#if signupEnabled}
                <Tabs bind:value={() => form.mode, chooseMode}>
                    <Tab value="sign-in" controls="auth-panel">Sign in</Tab>
                    <Tab value="sign-up" controls="auth-panel">Create account</Tab>
                </Tabs>
            {:else}
                <h2 class="text-xl font-medium">Sign in</h2>
            {/if}

            <div
                id="auth-panel"
                role={signupEnabled ? 'tabpanel' : undefined}
                aria-label={form.signingUp ? 'Create account' : 'Sign in'}
            >
                <p class="mt-5 text-sm leading-normal text-muted">
                    {#if form.signingUp}
                        Use your Google account email. This page encrypts the token for the server,
                        which exchanges it and stores it encrypted. No request carries the token.
                    {:else}
                        Sign in with the email and password of your Phodrive account.
                    {/if}
                </p>

                <form class="mt-7 grid gap-4.5" novalidate onsubmit={submit}>
                    <AuthTextField
                        label={form.signingUp ? 'Google account email' : 'Email'}
                        type="email"
                        bind:value={form.values.email}
                        bind:input={inputs.email}
                        issues={form.issues('email')}
                        onblur={() => (form.touched.email = true)}
                        disabled={submitting}
                        autocomplete={form.signingUp ? 'email' : 'username'}
                    />
                    <AuthTextField
                        label="Password"
                        type="password"
                        bind:value={form.values.password}
                        bind:input={inputs.password}
                        issues={form.issues('password')}
                        onblur={() => (form.touched.password = true)}
                        disabled={submitting}
                        autocomplete={form.signingUp ? 'new-password' : 'current-password'}
                    />
                    {#if form.signingUp}
                        <AuthTextField
                            label="Repeat password"
                            type="password"
                            bind:value={form.values.confirmPassword}
                            bind:input={inputs.confirmPassword}
                            issues={form.issues('confirmPassword')}
                            onblur={() => (form.touched.confirmPassword = true)}
                            disabled={submitting}
                            autocomplete="new-password"
                        />
                        <AuthTextField
                            label="OAuth2 or AAS token"
                            type="password"
                            bind:value={form.values.token}
                            bind:input={inputs.token}
                            issues={form.issues('token')}
                            onblur={() => (form.touched.token = true)}
                            disabled={submitting}
                            autocomplete="off"
                        />
                    {/if}
                    <div>
                        <Button
                            type="submit"
                            variant="filled"
                            size="s"
                            loading={submitting}
                            loadingAriaLabel={form.signingUp ? 'Creating account' : 'Signing in'}
                        >
                            {form.signingUp ? 'Create account' : 'Sign in'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    </Card>

    {#if form.signingUp}
        <TokenHelp />
    {/if}
</main>

<ErrorFeedback bind:message={feedback} />

<style>
    :global(:root .auth-card.np-card-container) {
        width: 100%;
    }
    :global(:root .auth-card.np-card-container .np-card-content) {
        margin: 0;
        gap: 0;
        width: 100%;
        min-width: 0;
    }
</style>
