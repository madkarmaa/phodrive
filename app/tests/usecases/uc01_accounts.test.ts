import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { ThemeMode } from '@madkarmaa/phodrive-core/models';
import { invalidateAll } from '$app/navigation';
import { DriveController } from '#browser/drive/index.svelte';
import { replaceGoogleToken, signOut, signUp } from '#browser/auth';
import { SignInSchema, SignUpSchema } from '#lib/auth';

const { storage } = vi.hoisted(() => {
    const values = new Map<string, string>();
    const storage: Storage = {
        get length() {
            return values.size;
        },
        clear: () => values.clear(),
        getItem: (key) => values.get(key) ?? null,
        key: (index) => [...values.keys()][index] ?? null,
        removeItem: (key) => values.delete(key),
        setItem: (key, value) => values.set(key, value)
    };

    vi.stubGlobal('window', Object.assign(new EventTarget(), { localStorage: storage }));
    vi.stubGlobal('document', {
        documentElement: { getAttribute: () => ThemeMode.Auto, setAttribute: vi.fn() }
    });

    return { storage };
});

vi.mock('esm-env', () => ({ BROWSER: true, DEV: true }));
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => {}) }));
vi.mock('#browser/drive/refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));
vi.mock('#browser/auth', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#browser/auth')>();

    return { ...actual, replaceGoogleToken: vi.fn(), signOut: vi.fn() };
});

beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

function createDrive() {
    const drive = new DriveController('test@example.com');
    drive.initialize();
    drive.ready = false;
    vi.spyOn(drive.library, 'load').mockResolvedValue();
    return drive;
}

test('signup needs a Google email, a valid password, and a Google token before any request', () => {
    const valid = { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' };

    expect(SignUpSchema.safeParse(valid).success).toBe(true);
    expect(SignUpSchema.safeParse({ ...valid, password: 'short' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, password: 'x'.repeat(129) }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, token: 'not-a-token' }).success).toBe(false);
    expect(SignUpSchema.safeParse({ ...valid, email: 'not-an-email' }).success).toBe(false);
    expect(SignInSchema.safeParse({ email: valid.email, password: '' }).success).toBe(false);
});

test('signup posts once to the account endpoint and never stores the token in the browser', async () => {
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ signedUp: true }));
    const input = { email: 'test@example.com', password: 'long enough', token: 'oauth2_4/fake' };

    const signedUp = await signUp(input);

    expect(signedUp.isOk()).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe('/api/account');
    expect(storage.length).toBe(0);
    fetchMock.mockRestore();
});

test('signup surfaces the server error message', async () => {
    const fetchMock = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(Response.json({ error: 'Signup is disabled.' }, { status: 403 }));

    const signedUp = await signUp({
        email: 'test@example.com',
        password: 'long enough',
        token: 'aas_et/fake'
    });

    expect(signedUp.unwrapErr().message).toBe('Signup is disabled.');
    fetchMock.mockRestore();
});

test('a rejected replacement token keeps the library and shows a safe error', async () => {
    vi.mocked(replaceGoogleToken).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'AAS authentication failed' } as const)
        )
    );
    const drive = createDrive();

    const replaced = await drive.replaceToken('oauth2_4/fake');

    expect(replaced).toBe(false);
    expect(drive.feedbackMessage).toBe('AAS authentication failed');
    expect(drive.replacingToken).toBe(false);
    expect(drive.library.load).not.toHaveBeenCalled();
});

test('a second replacement while one is pending does not issue another request', async () => {
    let resolveReplacement:
        ((value: Awaited<ReturnType<typeof replaceGoogleToken>>) => void) | undefined;
    vi.mocked(replaceGoogleToken).mockReturnValue(
        Ok(undefined).andThenAsync(
            () =>
                new Promise((resolve) => {
                    resolveReplacement = resolve;
                })
        )
    );
    const drive = createDrive();

    const first = drive.replaceToken('oauth2_4/fake');
    const second = await drive.replaceToken('oauth2_4/other');

    expect(second).toBe(false);
    expect(replaceGoogleToken).toHaveBeenCalledTimes(1);
    expect(drive.replacingToken).toBe(true);

    resolveReplacement?.(Ok(undefined));

    expect(await first).toBe(true);
    expect(drive.library.load).toHaveBeenCalledOnce();
});

test('signing out reloads the session, and a failed sign out keeps the drive with an error', async () => {
    vi.mocked(signOut).mockReturnValueOnce(Ok(undefined).andThenAsync(async () => Ok(undefined)));
    const drive = createDrive();

    await drive.signOut();

    expect(invalidateAll).toHaveBeenCalledOnce();

    vi.mocked(signOut).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Could not sign out. Try again.' } as const)
        )
    );

    await drive.signOut();

    expect(invalidateAll).toHaveBeenCalledOnce();
    expect(drive.feedbackMessage).toBe('Could not sign out. Try again.');
    expect(drive.signingOut).toBe(false);
});

test('sign out waits for active transfers', async () => {
    const drive = createDrive();
    drive.busy = true;

    await drive.signOut();

    expect(signOut).not.toHaveBeenCalled();
});
