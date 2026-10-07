import { createHash } from 'node:crypto';
import { FileActionKind, type FileRequest, type RemoteBmp } from '$lib/models';
import { encodeSplitBmp } from '$server/bmp';

export function bmpResponse(
    bmp: Uint8Array,
    blockSize = 64 * 1024,
    hooks: { onRead?: (bytes: number) => void; onCancel?: () => void } = {}
): Response {
    let offset = 0;
    const body = new ReadableStream<Uint8Array>(
        {
            pull(controller) {
                if (offset === bmp.length) {
                    controller.close();
                    return;
                }

                const block = bmp.subarray(offset, offset + blockSize);
                offset += block.length;
                hooks.onRead?.(block.length);
                controller.enqueue(block);
            },
            cancel: hooks.onCancel
        },
        { highWaterMark: 0 }
    );

    return new Response(body, { headers: { 'content-type': 'image/bmp' } });
}

export function downloadFixture(
    original: Uint8Array = Buffer.from([0, 255, 13, 10, 42]),
    name = 'proof.bin',
    parts: Uint8Array[] = [original.subarray(0, 3), original.subarray(3)]
): { input: FileRequest; bmps: Uint8Array[]; original: Uint8Array } {
    const fileHash = createHash('sha256').update(original).digest('hex');
    const bmps = parts.map((payload, chunkIndex) =>
        encodeSplitBmp(payload, {
            fileHash,
            fileId: fileHash,
            chunkIndex,
            flags: chunkIndex === parts.length - 1 ? 1 : 0,
            payloadSize: payload.length,
            fileName: chunkIndex === 0 ? name : undefined
        }).unwrap()
    );
    const chunks: RemoteBmp[] = bmps.map((bmp, chunkIndex) => ({
        fileHash,
        fileId: fileHash,
        chunkIndex,
        isLast: chunkIndex === parts.length - 1,
        originalName: chunkIndex === 0 ? name : undefined,
        size: parts[chunkIndex].length,
        at: 1,
        mediaKey: `chunk-${chunkIndex}`,
        sha1: createHash('sha1').update(bmp).digest('hex')
    }));

    return {
        original,
        bmps,
        input: {
            action: FileActionKind.Download,
            email: 'test@example.com',
            token: 'aas_et/test',
            name,
            fileHash,
            fileId: fileHash,
            chunks,
            workers: 2
        }
    };
}
