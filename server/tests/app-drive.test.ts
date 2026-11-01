import { beforeEach, expect, test, vi } from 'vitest';
import { ChunkFormat, ProcessingMode } from '@madkarmaa/phodrive-core/models';
import { downloadBmp, listBmps } from '@madkarmaa/phodrive-core/server/photos';
import { SERVER_ERRORS } from '@madkarmaa/phodrive-core/server/errors';
import { receiveFileUpload } from '@madkarmaa/phodrive-core/server/upload/file';
import { receiveUpload } from '@madkarmaa/phodrive-core/server/upload/input';
import { requireSessionUser } from '../src/auth';
import { AUTH_ERRORS } from '../src/errors';
import { readGoogleAccount } from '../src/google';
import { ACCOUNT, USER, call, postJson, rejected, resolved, settings } from './helpers/api';

vi.mock('../src/auth', () => ({
    createAuth: vi.fn(() => ({})),
    handleAuthRequest: vi.fn(),
    readSessionUser: vi.fn(),
    requireSessionUser: vi.fn()
}));
vi.mock('../src/google', () => ({
    readGoogleAccount: vi.fn(),
    readGoogleEmail: vi.fn(),
    saveGoogleAccount: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/photos', () => ({
    downloadBmp: vi.fn(),
    listBmps: vi.fn()
}));
vi.mock('@madkarmaa/phodrive-core/server/upload/input', () => ({ receiveUpload: vi.fn() }));
vi.mock('@madkarmaa/phodrive-core/server/upload/file', () => ({
    fileUploadStream: vi.fn(),
    receiveFileUpload: vi.fn()
}));

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSessionUser).mockReturnValue(resolved(USER));
    vi.mocked(readGoogleAccount).mockReturnValue(resolved(ACCOUNT));
    settings.processing = ProcessingMode.Browser;
});

test('drive routes refuse signed-out requests before contacting Google', async () => {
    vi.mocked(requireSessionUser).mockReturnValue(rejected(AUTH_ERRORS.SIGNED_OUT));

    for (const path of ['/api/library', '/api/files', '/api/upload']) {
        const response = await postJson(path, {});
        const body: unknown = await response.json();

        expect(response.status).toBe(401);
        expect(body).toEqual({ error: AUTH_ERRORS.SIGNED_OUT.message });
    }

    expect(readGoogleAccount).not.toHaveBeenCalled();
    expect(listBmps).not.toHaveBeenCalled();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('the library uses the stored account and ignores credentials sent by the client', async () => {
    vi.mocked(listBmps).mockReturnValue(resolved({ items: [], nextPageToken: '' }));

    const response = await postJson('/api/library', {
        email: 'other@example.com',
        token: 'aas_et/forged',
        pageToken: 'next'
    });

    expect(response.status).toBe(200);
    expect(vi.mocked(readGoogleAccount).mock.calls[0][1]).toBe(USER.id);
    expect(listBmps).toHaveBeenCalledWith(ACCOUNT.email, ACCOUNT.token, 'next');
});

test('in browser mode, uploads relay finished BMPs with the stored account', async () => {
    vi.mocked(receiveUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(vi.mocked(receiveUpload).mock.calls[0].slice(1)).toEqual([ACCOUNT, ChunkFormat.Bmp]);
    expect(receiveFileUpload).not.toHaveBeenCalled();
});

test('in server mode, uploads receive whole files for the server to process', async () => {
    settings.processing = ProcessingMode.Server;
    vi.mocked(receiveFileUpload).mockReturnValue(rejected(SERVER_ERRORS.INVALID_UPLOAD_REQUEST));

    const response = await call('/api/upload', { method: 'POST', body: new FormData() });

    expect(response.status).toBe(400);
    expect(receiveFileUpload).toHaveBeenCalledOnce();
    expect(receiveUpload).not.toHaveBeenCalled();
});

test('raw chunks are relayed unchanged with the stored account', async () => {
    const bytes = Uint8Array.of(66, 77, 1, 2, 3);
    vi.mocked(downloadBmp).mockReturnValue(
        resolved(new Response(bytes, { headers: { 'content-type': 'image/bmp' } }))
    );

    const response = await postJson('/api/chunk', { mediaKey: 'key', sha1: '0'.repeat(40) });

    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    expect(vi.mocked(downloadBmp).mock.calls[0].slice(0, 4)).toEqual([
        ACCOUNT.email,
        ACCOUNT.token,
        'key',
        '0'.repeat(40)
    ]);
});

test('an unreadable or missing Google account is reported without a token', async () => {
    vi.mocked(readGoogleAccount).mockReturnValue(rejected(AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE));

    const response = await postJson('/api/library', {});
    const body: unknown = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({ error: AUTH_ERRORS.GOOGLE_ACCOUNT_UNREADABLE.message });
});

test('unknown API paths return JSON not-found errors', async () => {
    const response = await call('/api/missing');

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: AUTH_ERRORS.NOT_FOUND.message });
});
