import { createHash } from 'node:crypto';
import {
    UploadChunkSchema,
    UploadEventType,
    UploadPhase,
    UploadStatus,
    type Account,
    type UploadEvent
} from '@madkarmaa/phodrive-core/models';
import { encodeSplitBmp, decodeSplitBmp } from '@madkarmaa/phodrive-core/server/bmp';
import { encodeSplitPrefix, MAX_CHUNK_PAYLOAD_BYTES } from '@madkarmaa/phodrive-core/bmp/format';
import { fileIdentity } from '@madkarmaa/phodrive-core/server/chunks';

/** The signed-in account the server adds to browser chunk metadata. */
export const TEST_ACCOUNT: Account = { email: 'test@example.com', token: 'aas_et/test' };

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
    const chunk = init.body.get('chunk');
    if (typeof json !== 'string' || !(chunk instanceof Blob))
        throw new Error('Missing chunk metadata/BMP');
    const sent: unknown = JSON.parse(json);
    if (typeof sent === 'object' && sent && ('email' in sent || 'token' in sent))
        throw new Error('Browser chunk metadata must not carry account credentials');
    const metadata = UploadChunkSchema.parse(sent);
    // Browsers send the finished BMP; it must match what the server would have encoded.
    const bmp = new Uint8Array(await chunk.arrayBuffer());
    const payload = decodeSplitBmp(bmp).unwrap().payload;
    const count = Math.max(1, Math.ceil(metadata.file.size / MAX_CHUNK_PAYLOAD_BYTES));
    const header = {
        fileHash: metadata.file.fileHash,
        fileId: fileIdentity(metadata.file.name, metadata.file.fileHash),
        chunkIndex: metadata.chunkIndex,
        flags: metadata.chunkIndex === count - 1 ? (1 as const) : (0 as const),
        payloadSize: payload.length,
        fileName: metadata.chunkIndex === 0 ? metadata.file.name : undefined
    };
    if (!Buffer.from(encodeSplitBmp(payload, header).unwrap()).equals(bmp))
        throw new Error('Browser BMP does not match the expected encoding');
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
                size: payload.length,
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
