export const BMP_ERRORS = {
    INVALID_CHUNK_SIZE: { code: 'INVALID_CHUNK_SIZE', message: 'Invalid chunk size' },
    CHUNK_TOO_LARGE: {
        code: 'CHUNK_TOO_LARGE',
        message: 'Chunk would exceed the 200 MB photo limit'
    },
    INVALID_CHUNK_METADATA: { code: 'INVALID_CHUNK_METADATA', message: 'Invalid chunk metadata' }
} as const;

export type BmpError = (typeof BMP_ERRORS)[keyof typeof BMP_ERRORS];
