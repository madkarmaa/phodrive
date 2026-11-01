import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { invalidateAll } from '$app/navigation';
import { DriveController } from '#browser/drive/index.svelte';
import { replaceGoogleToken, signOut } from '#browser/auth';

const { storage } = await vi.hoisted(async () => {
    const { stubBrowser } = await import('../helpers/browser');

    return stubBrowser();
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

test('a rejected replacement token keeps the library and shows a safe error', async () => {
    vi.mocked(replaceGoogleToken).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'AAS authentication failed' } as const)
        )
    );
    const drive = createDrive();

    const replaced = await drive.account.replaceToken('oauth2_4/fake');

    expect(replaced).toBe(false);
    expect(drive.feedbackMessage).toBe('AAS authentication failed');
    expect(drive.account.replacingToken).toBe(false);
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

    const first = drive.account.replaceToken('oauth2_4/fake');
    const second = await drive.account.replaceToken('oauth2_4/other');

    expect(second).toBe(false);
    expect(replaceGoogleToken).toHaveBeenCalledTimes(1);
    expect(drive.account.replacingToken).toBe(true);

    resolveReplacement?.(Ok(undefined));

    expect(await first).toBe(true);
    expect(drive.library.load).toHaveBeenCalledOnce();
});

test('signing out reloads the session, and a failed sign out keeps the drive with an error', async () => {
    vi.mocked(signOut).mockReturnValueOnce(Ok(undefined).andThenAsync(async () => Ok(undefined)));
    const drive = createDrive();

    await drive.account.signOut();

    expect(invalidateAll).toHaveBeenCalledOnce();

    vi.mocked(signOut).mockReturnValueOnce(
        Ok(undefined).andThenAsync(async () =>
            Err({ code: 'REQUEST_FAILED', message: 'Could not sign out. Try again.' } as const)
        )
    );

    await drive.account.signOut();

    expect(invalidateAll).toHaveBeenCalledOnce();
    expect(drive.feedbackMessage).toBe('Could not sign out. Try again.');
    expect(drive.account.signingOut).toBe(false);
});

test('sign out waits for active transfers', async () => {
    const drive = createDrive();
    drive.busy = true;

    await drive.account.signOut();

    expect(signOut).not.toHaveBeenCalled();
});
