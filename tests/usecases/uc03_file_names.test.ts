import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, test, vi } from 'vitest';
import {
    UploadEventType,
    UploadJobStatus,
    UploadPhase,
    UploadStatus,
    type UploadEvent
} from '$lib/models';
import { uploadFiles, type UploadJob } from '$browser/files';
import { decodeSplitBmp, encodeSplitBmp } from '$server/bmp';
import { planUpload } from '$server/uploads';
import { receiveUpload } from '$server/upload-input';
import { removeTemporaryDirectory } from '$server/temporary-files';
import type { UploadedChunk } from '$lib/file-groups';

const directories: string[] = [];

afterEach(async () => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) await removeTemporaryDirectory(directory);
});

function validNameEvents(names: readonly string[]): UploadEvent[] {
    const events: UploadEvent[] = [];

    for (const [id, name] of names.entries()) {
        events.push({ type: UploadEventType.Queued, id });
        events.push({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Preparing, completed: 0, total: 0 }
        });
        events.push({
            type: UploadEventType.Progress,
            id,
            progress: { phase: UploadPhase.Uploading, completed: 0, total: 1, reused: 1 }
        });
        events.push({
            type: UploadEventType.Chunk,
            id,
            chunk: {
                fileHash: 'a'.repeat(64),
                chunkIndex: 0,
                isLast: true,
                originalName: name,
                size: 0,
                at: 1,
                mediaKey: `media-${id}`,
                sha1: 'b'.repeat(40)
            }
        });
        events.push({
            type: UploadEventType.FileComplete,
            id,
            result: {
                status: UploadStatus.AlreadyExists,
                mediaKey: `media-${id}`,
                sha1: 'b'.repeat(40)
            }
        });
    }

    events.push({ type: UploadEventType.Complete });
    return events;
}

function streamEvents(events: readonly UploadEvent[]): string {
    return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('');
}

test('empty files retain Unicode, emoji, combining marks, dotfile, extensionless, and long names through BMP metadata', async () => {
    const names = [
        'résumé.png',
        'family-👩‍👩‍👧‍👦.jpg',
        'cafe\u0301.txt',
        '.gitignore',
        'LICENSE',
        `${'long-name-'.repeat(400)}.bin`
    ];
    const form = new FormData();
    form.set('email', 'test@example.com');
    form.set('token', 'aas_et/test');
    form.set('workers', '2');
    for (const name of names) form.append('file', new File([], name));

    const received = await receiveUpload(
        new Request('http://localhost/api/upload', { method: 'POST', body: form })
    );
    const input = received.unwrap();
    directories.push(input.directory);

    expect(input.files.map((file) => file.name)).toEqual(names);
    expect(input.files.map((file) => file.size)).toEqual(names.map(() => 0));
    for (const file of input.files) {
        expect(await readFile(file.path)).toEqual(Buffer.alloc(0));
        const plan = planUpload(file).unwrap();
        expect(plan.headers[0].fileName).toBe(file.name);

        const bmp = encodeSplitBmp(new Uint8Array(), plan.headers[0]).unwrap();
        expect(decodeSplitBmp(bmp).unwrap().header.fileName).toBe(file.name);
    }
});

test('invalid selected paths and newline names are rejected while valid empty-file uploads finish', async () => {
    const validNames = ['.profile', 'README', 'cafe\u0301.txt', 'emoji-🚀'];
    const invalidNames = [
        'folder/file.txt',
        'folder\\file.txt',
        'line\nbreak.txt',
        'line\rbreak.txt'
    ];
    const submittedNames: string[] = [];
    const events = validNameEvents(validNames);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
        const body = init?.body;
        if (!(body instanceof FormData)) return new Response('bad request', { status: 400 });
        const submitted = body.getAll('file');
        if (!submitted.every((file) => file instanceof File))
            return new Response('bad form data', { status: 400 });

        submittedNames.push(...submitted.map((file) => file.name));
        return new Response(streamEvents(events), {
            headers: { 'content-type': 'text/event-stream' }
        });
    });

    const files = [
        ...invalidNames.map((name) => new File([], name)),
        ...validNames.map((name) => new File([], name))
    ];
    const jobs: UploadJob[] = [];
    const chunks: UploadedChunk[] = [];
    const uploaded = await uploadFiles(
        files,
        'test@example.com',
        'aas_et/test',
        2,
        (job) => jobs.push(job),
        (chunk) => chunks.push(chunk)
    );

    expect(uploaded.isOk()).toBe(true);
    expect(submittedNames).toEqual(validNames);
    expect(jobs.filter((job) => job.status === UploadJobStatus.Error)).toHaveLength(
        invalidNames.length
    );
    expect(jobs.filter((job) => job.status === UploadJobStatus.Complete)).toHaveLength(
        validNames.length
    );
    expect(chunks).toHaveLength(validNames.length);
});
