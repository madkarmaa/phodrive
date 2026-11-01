import { SignInSchema, type SignInInput, type SignUpInput } from '@madkarmaa/phodrive-core/auth';
import { SignUpFormSchema } from '#lib/auth';

export type AuthMode = 'sign-in' | 'sign-up';
export type AuthField = 'email' | 'password' | 'confirmPassword' | 'token';

const FIELDS: readonly AuthField[] = ['email', 'password', 'confirmPassword', 'token'];
const UNTOUCHED: Record<AuthField, boolean> = {
    email: false,
    password: false,
    confirmPassword: false,
    token: false
};

/** Sign-in and sign-up form values; a field shows its issues only once it has been touched. */
export class AuthForm {
    mode = $state<AuthMode>('sign-in');
    values = $state<Record<AuthField, string>>({
        email: '',
        password: '',
        confirmPassword: '',
        token: ''
    });
    touched = $state<Record<AuthField, boolean>>({ ...UNTOUCHED });

    readonly signingUp = $derived.by(() => this.mode === 'sign-up' && this.signupEnabled());
    readonly validation = $derived.by(() => {
        const { email, password, confirmPassword, token } = this.values;
        if (!this.signingUp) return SignInSchema.safeParse({ email: email.trim(), password });

        return SignUpFormSchema.safeParse({
            email: email.trim(),
            password,
            confirmPassword,
            token: token.trim()
        });
    });

    constructor(private readonly signupEnabled: () => boolean) {}

    issues(field: AuthField) {
        if (!this.touched[field] || this.validation.success) return undefined;

        return this.validation.error.issues.filter((issue) => issue.path[0] === field);
    }

    choose(mode: AuthMode) {
        this.mode = mode;
        this.touched = { ...UNTOUCHED };
    }

    /**
     * Mark every shown field as touched. Returns the valid input, or the first field to fix.
     */
    submit(): { input: SignInInput | SignUpInput } | { invalid: AuthField | undefined } {
        this.touched = {
            email: true,
            password: true,
            confirmPassword: this.signingUp,
            token: this.signingUp
        };
        if (this.validation.success) return { input: this.validation.data };

        const path = this.validation.error.issues[0]?.path[0];

        return { invalid: FIELDS.find((name) => name === path) };
    }
}
