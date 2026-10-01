import { json } from '@sveltejs/kit';
import { receiveUpload } from '$server/upload-input';
import { safeUploadError, uploadStream } from '$server/upload-stream';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
    const received = await receiveUpload(request);
    return received.match({
        Ok: (input) => uploadStream(input),
        Err: (error) =>
            json(
                { error: safeUploadError(error) },
                {
                    status: 400,
                    headers: { 'cache-control': 'no-store' }
                }
            )
    });
};
