import { createHash } from 'node:crypto';
import {
    UploadRequestSchema,
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type UploadEvent
} from '#lib/models';
import { encodeSplitBmp, decodeSplitBmp } from '#server/bmp';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '#lib/bmp/format';
import { fileIdentity } from '#server/chunks';
import { bytesField, message, nested, numberField } from '#server/protobuf';
import type { Fetcher } from '#server/fetcher';

export function uploadForm(
    payload: Uint8Array = Buffer.from([0, 255, 13, 10, 42]),
    name = 'proof.bin',
    options: { fileSize?: number; fileHash?: string; chunkIndex?: number } = {}
) {
    const file = {
        name,
        size: options.fileSize ?? payload.length,
        fileHash: options.fileHash ?? createHash('sha256').update(payload).digest('hex')
    };
    const chunkIndex = options.chunkIndex ?? 0;
    const count = Math.max(1, Math.ceil(file.size / MAX_CHUNK_PAYLOAD_BYTES));
    const header = {
        fileHash: file.fileHash,
        fileId: fileIdentity(name, file.fileHash),
        chunkIndex,
        flags: chunkIndex === count - 1 ? (1 as const) : (0 as const),
        payloadSize: Math.min(
            MAX_CHUNK_PAYLOAD_BYTES,
            file.size - chunkIndex * MAX_CHUNK_PAYLOAD_BYTES
        ),
        fileName: chunkIndex === 0 ? name : undefined
    };
    const prefix = encodeSplitPrefix(header).unwrap();
    // A deliberately short payload can test ingestion without allocating a sparse file's declared size.
    const hash = createHash('sha1').update(prefix.prefix).update(payload);
    const zero = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < prefix.paddingSize; offset += zero.length)
        hash.update(zero.subarray(0, prefix.paddingSize - offset));
    const metadata = {
        email: 'test@example.com',
        token: 'aas_et/test',
        file,
        chunkIndex,
        sha1: hash.digest('hex')
    };
    const form = new FormData();
    form.set('metadata', JSON.stringify(metadata));
    form.set('chunk', new Blob([Uint8Array.from(payload)]), 'chunk.bin');
    return {
        form,
        metadata,
        header,
        prefix,
        request: () => new Request('http://localhost/api/upload', { method: 'POST', body: form })
    };
}

export async function browserUploadResponse(
    init: RequestInit | undefined,
    duplicate = false,
    change: (events: UploadEvent[]) => UploadEvent[] = (events) => events
): Promise<Response> {
    if (!(init?.body instanceof FormData)) throw new Error('Expected chunk form');
    const json = init.body.get('metadata');
    const payload = init.body.get('chunk');
    if (typeof json !== 'string' || !(payload instanceof Blob))
        throw new Error('Missing chunk metadata/payload');
    const metadata = UploadRequestSchema.parse(JSON.parse(json));
    const count = Math.max(1, Math.ceil(metadata.file.size / MAX_CHUNK_PAYLOAD_BYTES));
    const header = {
        fileHash: metadata.file.fileHash,
        fileId: fileIdentity(metadata.file.name, metadata.file.fileHash),
        chunkIndex: metadata.chunkIndex,
        flags: metadata.chunkIndex === count - 1 ? (1 as const) : (0 as const),
        payloadSize: payload.size,
        fileName: metadata.chunkIndex === 0 ? metadata.file.name : undefined
    };
    const bytes = await payload.arrayBuffer();
    const bmp = encodeSplitBmp(new Uint8Array(bytes), header).unwrap();
    if (createHash('sha1').update(bmp).digest('hex') !== metadata.sha1)
        throw new Error('Wrong browser BMP checksum');
    const result = {
        status: duplicate ? UploadStatus.AlreadyExists : UploadStatus.Uploaded,
        mediaKey: `${metadata.file.name}-${metadata.chunkIndex}`,
        sha1: metadata.sha1
    };
    const events: UploadEvent[] = [
        {
            type: UploadEventType.Progress,
            id: 0,
            progress: {
                phase: UploadPhase.Uploading,
                completed: duplicate ? 0 : bmp.length,
                reused: duplicate ? bmp.length : 0,
                total: bmp.length
            }
        },
        {
            type: UploadEventType.Chunk,
            id: 0,
            chunk: {
                fileHash: header.fileHash,
                fileId: header.fileId,
                chunkIndex: header.chunkIndex,
                isLast: Boolean(header.flags),
                originalName: header.fileName,
                size: payload.size,
                at: 1,
                mediaKey: result.mediaKey,
                sha1: result.sha1
            }
        },
        { type: UploadEventType.FileComplete, id: 0, result },
        { type: UploadEventType.Complete }
    ];
    return new Response(
        change(events)
            .map((event) => `data: ${JSON.stringify(event)}\n\n`)
            .join(''),
        { headers: { 'content-type': 'text/event-stream' } }
    );
}

export function photosUploadHarness(options: { duplicate?: boolean; failCommit?: boolean } = {}) {
    const stored = new Map<string, Buffer>();
    const counts = { transfers: 0, commits: 0, largestBlock: 0 };
    const scotty = message(numberField(1, 2), bytesField(2, Uint8Array.of(7)));
    const fetcher: Fetcher = async (input, init) => {
        const url = String(input);
        if (url.includes('android.googleapis.com/auth'))
            return new Response(`Auth=bearer\nExpiry=${Date.now() / 1000 + 3600}`);
        if (url.includes('5084965799730810217')) {
            const data = await new Response(init?.body).arrayBuffer();
            const sha1 = nested(Buffer.from(data), 1, 1, 1).unwrap();
            const fields = [bytesField(1, bytesField(1, sha1))];
            if (options.duplicate || stored.has(sha1.toString('hex')))
                fields.push(bytesField(2, bytesField(1, 'existing-key')));
            return new Response(Uint8Array.from(bytesField(1, bytesField(2, message(...fields)))));
        }
        if (init?.method === 'PUT') {
            counts.transfers++;
            const reader = new Response(init.body).body!.getReader();
            const chunks: Uint8Array[] = [];
            while (true) {
                const next = await reader.read();
                if (next.done) break;
                counts.largestBlock = Math.max(counts.largestBlock, next.value.length);
                chunks.push(next.value);
            }
            const bmp = Buffer.concat(chunks);
            decodeSplitBmp(bmp).unwrap();
            const sha1 = createHash('sha1').update(bmp).digest('hex');
            stored.set(sha1, bmp);
            expectLength(init, bmp.length);
            return new Response(Uint8Array.from(scotty));
        }
        if (url.includes('uploadmedia/interactive'))
            return new Response(null, { headers: { 'x-guploader-uploadid': 'upload-id' } });
        if (url.includes('16538846908252377752')) {
            counts.commits++;
            if (options.failCommit) return new Response(null, { status: 503 });
            return new Response(
                Uint8Array.from(
                    bytesField(
                        1,
                        message(
                            bytesField(1, scotty),
                            numberField(2, 0),
                            bytesField(3, bytesField(1, 'media-key'))
                        )
                    )
                )
            );
        }
        throw new Error('Unexpected provider request');
    };
    return { fetcher, stored, counts };
}
function expectLength(init: RequestInit | undefined, length: number) {
    if (new Headers(init?.headers).get('content-length') !== String(length))
        throw new Error('Wrong streamed BMP length');
}
