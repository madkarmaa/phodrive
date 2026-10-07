import type { Agent } from 'undici/index.js';
import { expect, test, vi } from 'vitest';

const { configureAgent } = vi.hoisted(() => ({ configureAgent: vi.fn() }));

vi.mock('undici/index.js', async (importOriginal) => {
    const undici = await importOriginal<typeof import('undici/index.js')>();

    return {
        ...undici,
        Agent: class extends undici.Agent {
            constructor(options?: Agent.Options) {
                super(options);
                configureAgent(options);
            }
        }
    };
});

test('Google transport disables connection, header and body timeouts', async () => {
    vi.resetModules();
    const transport = await import('#server/fetcher');

    expect(transport.photosFetch).toBeTypeOf('function');
    expect(configureAgent).toHaveBeenCalledWith({
        allowH2: false,
        connectTimeout: 0,
        headersTimeout: 0,
        bodyTimeout: 0
    });
});
