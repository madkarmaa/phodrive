import { json } from '@sveltejs/kit';
import { Err, Ok, type Result } from 'results-ts';
import { decodeSplitBmp, MAX_PHOTOS_BMP_BYTES } from '$lib/bmp';
import { parseChunkFileName } from '$lib/chunks';
import { safeUploadError, uploadStream } from '$server/upload-stream';
import { readForm } from '$server/request';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const parsed = await readForm(request);
    const form = parsed.match({ Ok: (value) => value, Err: () => null });
    if (!form) return json({ error: 'Could not read the upload' }, { status: 400 });

    const file = form.get('file');
    const email = form.get('email');
    const token = form.get('token');
    if (!(file instanceof File) || typeof email !== 'string' || typeof token !== 'string') {
        return json({ error: 'Choose a file and enter your account credentials' }, { status: 400 });
    }

    if (file.size > MAX_PHOTOS_BMP_BYTES) {
        return json({ error: 'Google Photos accepts photos up to 200 MB.' }, { status: 413 });
    }

    const namedChunk = parseChunkFileName(file.name);
    if (!namedChunk) return json({ error: 'Invalid chunk file name' }, { status: 400 });

    let bmp: Result<Buffer, Error>;
    try {
        const body = await file.arrayBuffer();
        bmp = Ok(Buffer.from(body));
    } catch {
        bmp = Err(new Error('Could not read the upload'));
    }

    const result = bmp.andThen((bytes) =>
        decodeSplitBmp(bytes).andThen(({ header }) => {
            if (
                header.fileHash !== namedChunk.fileHash ||
                header.chunkIndex !== namedChunk.chunkIndex ||
                header.flags !== Number(namedChunk.chunkIndex === namedChunk.chunkCount - 1) ||
                (namedChunk.chunkIndex === 0 && header.fileName !== namedChunk.name)
            )
                return Err(new Error('Invalid chunk metadata'));

            return Ok(bytes);
        })
    );
    return result.match({
        Ok: (bytes) => uploadStream(email.trim(), token.trim(), file.name, bytes),
        Err: (error) => {
            return json(
                { error: safeUploadError(error) },
                { status: 400, headers: { 'cache-control': 'no-store' } }
            );
        }
    });
};
