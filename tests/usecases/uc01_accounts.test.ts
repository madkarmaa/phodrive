import { afterAll, beforeEach, expect, test, vi } from 'vitest';
import { Err, Ok } from 'results-ts';
import { ThemeMode } from '$lib/models';
import { DriveController } from '$browser/drive.svelte';
import { validateAccount } from '$browser/accounts';

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
vi.mock('$browser/accounts', () => ({ validateAccount: vi.fn() }));
vi.mock('$browser/automatic-refresh.svelte', () => ({ useAutomaticRefresh: vi.fn() }));

beforeEach(() => {
    storage.clear();
    vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

function createDrive(email = 'test@example.com', token = 'oauth2_4/fake') {
    const drive = new DriveController();
    drive.initialize();
    drive.ready = false;
    drive.newEmail = email;
    drive.newToken = token;
    return drive;
}

test('whitespace and malformed credentials stop before account validation', async () => {
    const drive = createDrive('   ', '   ');

    await drive.saveAccount();

    expect(validateAccount).not.toHaveBeenCalled();
    expect(drive.message).toBe('Enter your Google account email and an OAuth2 or AAS token.');
    expect(drive.accounts).toEqual({});
});

test('rejected or expired token leaves account storage unchanged and shows a safe error', async () => {
    vi.mocked(validateAccount).mockReturnValue(
        Ok(undefined).andThenAsync(async () =>
            Err({
                code: 'ACCOUNT_CONNECTION_FAILED',
                message: 'AAS authentication failed'
            } as const)
        )
    );
    const drive = createDrive();

    await drive.saveAccount();

    expect(drive.accounts).toEqual({});
    expect(drive.message).toBe('AAS authentication failed');
    expect(drive.connecting).toBe(false);
});

test('a second submit while authentication is pending does not issue another validation', async () => {
    let resolveValidation:
        ((value: Awaited<ReturnType<typeof validateAccount>>) => void) | undefined;
    vi.mocked(validateAccount).mockReturnValue(
        Ok(undefined).andThenAsync(
            () =>
                new Promise((resolve) => {
                    resolveValidation = resolve;
                })
        )
    );
    const drive = createDrive();

    const firstSubmit = drive.saveAccount();
    await drive.saveAccount();

    expect(validateAccount).toHaveBeenCalledTimes(1);
    expect(drive.connecting).toBe(true);

    resolveValidation?.(Ok('aas_et/fake'));
    await firstSubmit;
});

test('editing credentials during pending authentication does not associate the token with another email', async () => {
    let resolveValidation:
        ((value: Awaited<ReturnType<typeof validateAccount>>) => void) | undefined;
    vi.mocked(validateAccount).mockReturnValue(
        Ok(undefined).andThenAsync(
            () =>
                new Promise((resolve) => {
                    resolveValidation = resolve;
                })
        )
    );
    const drive = createDrive();

    const pendingSubmit = drive.saveAccount();
    await Promise.resolve();
    drive.newEmail = 'changed@example.com';
    drive.newToken = 'oauth2_4/other-fake';
    resolveValidation?.(Ok('aas_et/verified-original'));
    await pendingSubmit;

    expect(drive.accounts).toEqual({ 'test@example.com': 'aas_et/verified-original' });
});
