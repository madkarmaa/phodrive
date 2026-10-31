<script lang="ts">
    import { Button, Card, Tab, Tabs, TextField } from 'noph-ui';
    import { invalidateAll } from '$app/navigation';
    import {
        SignInSchema,
        type SignInInput,
        type SignUpInput
    } from '@madkarmaa/phodrive-core/auth';
    import { SignUpFormSchema } from '#lib/auth';
    import { APP_MOTTO, APP_NAME } from '#lib/app';
    import { signIn, signUp } from '#browser/auth';
    import TokenHelp from '#components/TokenHelp.svelte';
    import ErrorFeedback from '#components/ErrorFeedback.svelte';
    import logo from '#assets/favicon.svg';

    interface Props {
        signupEnabled: boolean;
    }

    let { signupEnabled }: Props = $props();

    type Mode = 'sign-in' | 'sign-up';
    type Field = 'email' | 'password' | 'confirmPassword' | 'token';
    const FIELDS: readonly Field[] = ['email', 'password', 'confirmPassword', 'token'];
    const UNTOUCHED: Record<Field, boolean> = {
        email: false,
        password: false,
        confirmPassword: false,
        token: false
    };

    let mode = $state<Mode>('sign-in');
    let email = $state('');
    let password = $state('');
    let confirmPassword = $state('');
    let token = $state('');
    let submitting = $state(false);
    let feedback = $state('');
    let touched = $state<Record<Field, boolean>>({ ...UNTOUCHED });
    let inputs = $state<Partial<Record<Field, HTMLInputElement | HTMLTextAreaElement>>>({});

    const signingUp = $derived(mode === 'sign-up' && signupEnabled);
    const validation = $derived(
        signingUp
            ? SignUpFormSchema.safeParse({
                  email: email.trim(),
                  password,
                  confirmPassword,
                  token: token.trim()
              })
            : SignInSchema.safeParse({ email: email.trim(), password })
    );

    function issues(field: Field) {
        if (!touched[field] || validation.success) return undefined;

        return validation.error.issues.filter((issue) => issue.path[0] === field);
    }

    function chooseMode(next: Mode) {
        mode = next;
        feedback = '';
        touched = { ...UNTOUCHED };
    }

    async function submit(input: SignInInput | SignUpInput) {
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
                <Tabs
                    bind:value={
                        () => mode, (next) => chooseMode(next === 'sign-up' ? 'sign-up' : 'sign-in')
                    }
                >
                    <Tab value="sign-in" controls="auth-panel">Sign in</Tab>
                    <Tab value="sign-up" controls="auth-panel">Create account</Tab>
                </Tabs>
            {:else}
                <h2 class="text-xl font-medium">Sign in</h2>
            {/if}

            <div
                id="auth-panel"
                role={signupEnabled ? 'tabpanel' : undefined}
                aria-label={signingUp ? 'Create account' : 'Sign in'}
            >
                <p class="mt-5 text-sm leading-normal text-muted">
                    {#if signingUp}
                        Use your Google account email. This page encrypts the token for the server,
                        which exchanges it and stores it encrypted. No request carries the token.
                    {:else}
                        Sign in with the email and password of your Phodrive account.
                    {/if}
                </p>

                <form
                    class="mt-7 grid gap-4.5"
                    novalidate
                    onsubmit={(event) => {
                        event.preventDefault();
                        touched = {
                            email: true,
                            password: true,
                            confirmPassword: signingUp,
                            token: signingUp
                        };
                        if (!validation.success) {
                            const path = validation.error.issues[0]?.path[0];
                            const field = FIELDS.find((name) => name === path);
                            if (field) inputs[field]?.focus();

                            return;
                        }

                        void submit(validation.data);
                    }}
                >
                    <div class="field min-w-0">
                        <TextField
                            label={signingUp ? 'Google account email' : 'Email'}
                            type="email"
                            bind:value={email}
                            bind:inputElement={inputs.email}
                            issues={issues('email')}
                            onblur={() => (touched.email = true)}
                            disabled={submitting}
                            autocomplete={signingUp ? 'email' : 'username'}
                            required
                        />
                    </div>
                    <div class="field min-w-0">
                        <TextField
                            label="Password"
                            type="password"
                            bind:value={password}
                            bind:inputElement={inputs.password}
                            issues={issues('password')}
                            onblur={() => (touched.password = true)}
                            disabled={submitting}
                            autocomplete={signingUp ? 'new-password' : 'current-password'}
                            required
                        />
                    </div>
                    {#if signingUp}
                        <div class="field min-w-0">
                            <TextField
                                label="Repeat password"
                                type="password"
                                bind:value={confirmPassword}
                                bind:inputElement={inputs.confirmPassword}
                                issues={issues('confirmPassword')}
                                onblur={() => (touched.confirmPassword = true)}
                                disabled={submitting}
                                autocomplete="new-password"
                                required
                            />
                        </div>
                        <div class="field min-w-0">
                            <TextField
                                label="OAuth2 or AAS token"
                                type="password"
                                bind:value={token}
                                bind:inputElement={inputs.token}
                                issues={issues('token')}
                                onblur={() => (touched.token = true)}
                                disabled={submitting}
                                autocomplete="off"
                                required
                            />
                        </div>
                    {/if}
                    <div>
                        <Button
                            type="submit"
                            variant="filled"
                            size="s"
                            loading={submitting}
                            loadingAriaLabel={signingUp ? 'Creating account' : 'Signing in'}
                        >
                            {signingUp ? 'Create account' : 'Sign in'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    </Card>

    {#if signingUp}
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

    .field :global(.np-text-field) {
        box-sizing: border-box;
        min-width: 0;
        width: 100%;
    }

    .field :global(input) {
        box-sizing: border-box;
    }
</style>
