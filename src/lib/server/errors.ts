/** Recoverable server failures contain only application-owned messages. */
export const SERVER_ERRORS = {
    FILE_RECEIVE_FAILED: {
        code: 'FILE_RECEIVE_FAILED',
        message: 'Could not receive the selected file.'
    },
    FILE_TOO_LARGE: { code: 'FILE_TOO_LARGE', message: 'File is too large.' },
    UPLOAD_INPUT_REQUIRED: {
        code: 'UPLOAD_INPUT_REQUIRED',
        message: 'Choose files and enter your account credentials.'
    },
    INVALID_UPLOAD_REQUEST: { code: 'INVALID_UPLOAD_REQUEST', message: 'Invalid upload request.' },
    INVALID_UPLOAD_FILE_NAME: { code: 'INVALID_UPLOAD_FILE_NAME', message: 'Invalid file name.' },
    INVALID_FILE_NAME: { code: 'INVALID_FILE_NAME', message: 'Invalid file name' },
    FILE_RECEIVE_FAILEDS: {
        code: 'FILE_RECEIVE_FAILEDS',
        message: 'Could not receive the selected files.'
    },
    FILES_REQUIRED: {
        code: 'FILES_REQUIRED',
        message: 'Choose at least one file.'
    },
    INVALID_UPLOAD_CREDENTIALS: {
        code: 'INVALID_UPLOAD_CREDENTIALS',
        message: 'Enter a valid account and worker count.'
    },
    INVALID_FILE_NAME_OR_SIZE: {
        code: 'INVALID_FILE_NAME_OR_SIZE',
        message: 'Invalid file name or size.'
    },
    NO_UPLOADED_CHUNKS: {
        code: 'NO_UPLOADED_CHUNKS',
        message: 'No chunks were uploaded.'
    },
    TEMPORARY_STORAGE_CREATE_FAILED: {
        code: 'TEMPORARY_STORAGE_CREATE_FAILED',
        message: 'Could not create temporary file storage.'
    },
    TEMPORARY_STORAGE_REMOVE_FAILED: {
        code: 'TEMPORARY_STORAGE_REMOVE_FAILED',
        message: 'Could not remove temporary file storage.'
    },
    FILE_READ_FAILED: {
        code: 'FILE_READ_FAILED',
        message: 'Could not read the received file.'
    },
    INCOMPLETE_FILE: {
        code: 'INCOMPLETE_FILE',
        message: 'The received file is incomplete.'
    },
    TEMPORARY_STORAGE_CLOSE_FAILED: {
        code: 'TEMPORARY_STORAGE_CLOSE_FAILED',
        message: 'Could not close temporary file storage.'
    },
    INVALID_PAGE_TOKEN: { code: 'INVALID_PAGE_TOKEN', message: 'Invalid page token' },
    REPEATED_LIBRARY_PAGE: {
        code: 'REPEATED_LIBRARY_PAGE',
        message: 'Google Photos repeated a library page. Refresh to try again.'
    },
    MISSING_MEDIA_KEY: { code: 'MISSING_MEDIA_KEY', message: 'Missing media key' },
    HASH_LOOKUP_MISMATCH: { code: 'HASH_LOOKUP_MISMATCH', message: 'Hash lookup mismatch' },
    COMMIT_TOKEN_MISMATCH: { code: 'COMMIT_TOKEN_MISMATCH', message: 'Commit token mismatch' },
    COMMIT_REJECTED: { code: 'COMMIT_REJECTED', message: 'Commit rejected' },
    UNKNOWN_COMMIT_STATUS: { code: 'UNKNOWN_COMMIT_STATUS', message: 'Unknown commit status' },
    INVALID_ACCOUNT: {
        code: 'INVALID_ACCOUNT',
        message: 'Enter a valid account email and AAS token'
    },
    AAS_AUTHENTICATION_FAILED: {
        code: 'AAS_AUTHENTICATION_FAILED',
        message: 'AAS authentication failed'
    },
    UPLOAD_START_RESPONSE_FAILED: {
        code: 'UPLOAD_START_RESPONSE_FAILED',
        message: 'Upload start response failed'
    },
    INVALID_TRANSFER_TOKEN: { code: 'INVALID_TRANSFER_TOKEN', message: 'Invalid transfer token' },
    COMMIT_OUTCOME_UNCERTAIN: {
        code: 'COMMIT_OUTCOME_UNCERTAIN',
        message: 'Commit outcome uncertain. Check Google Photos before retrying.'
    },
    INVALID_SHA_1: { code: 'INVALID_SHA_1', message: 'Invalid SHA-1' },
    INVALID_FILE_REFERENCE: { code: 'INVALID_FILE_REFERENCE', message: 'Invalid file reference' },
    INVALID_DOWNLOAD_CONTENT_TYPE: {
        code: 'INVALID_DOWNLOAD_CONTENT_TYPE',
        message: 'Invalid download content type'
    },
    DOWNLOAD_INTEGRITY_FAILED: {
        code: 'DOWNLOAD_INTEGRITY_FAILED',
        message: 'Download integrity failed'
    },
    MISSING_DOWNLOAD_BODY: { code: 'MISSING_DOWNLOAD_BODY', message: 'Missing download body' },
    COULD_NOT_INSPECT_PHOTO_HEADER: {
        code: 'COULD_NOT_INSPECT_PHOTO_HEADER',
        message: 'Could not inspect photo header'
    },
    INVALID_DOWNLOAD_URL: { code: 'INVALID_DOWNLOAD_URL', message: 'Invalid download URL' },
    DOWNLOAD_MEDIA_MISMATCH: {
        code: 'DOWNLOAD_MEDIA_MISMATCH',
        message: 'Download media mismatch'
    },
    DOWNLOAD_FINGERPRINT_MISMATCH: {
        code: 'DOWNLOAD_FINGERPRINT_MISMATCH',
        message: 'Download fingerprint mismatch'
    },
    INVALID_CHUNK_SIZE: { code: 'INVALID_CHUNK_SIZE', message: 'Invalid chunk size' },
    CHUNK_TOO_LARGE: {
        code: 'CHUNK_TOO_LARGE',
        message: 'Chunk would exceed the 200 MB photo limit'
    },
    INVALID_CHUNK_VARINT: { code: 'INVALID_CHUNK_VARINT', message: 'Invalid chunk varint' },
    INVALID_CHUNK_METADATA: { code: 'INVALID_CHUNK_METADATA', message: 'Invalid chunk metadata' },
    BMP_ALLOCATION_FAILED: {
        code: 'BMP_ALLOCATION_FAILED',
        message: 'Not enough memory to create BMP'
    },
    INVALID_DOWNLOADED_BMP: {
        code: 'INVALID_DOWNLOADED_BMP',
        message: 'Downloaded BMP is invalid or damaged'
    },
    OVERSIZED_PROTOBUF_INTEGER: {
        code: 'OVERSIZED_PROTOBUF_INTEGER',
        message: 'Oversized protobuf integer'
    },
    INVALID_PROTOBUF_INTEGER: {
        code: 'INVALID_PROTOBUF_INTEGER',
        message: 'Invalid protobuf integer'
    },
    INVALID_PROTOBUF_FIELD: { code: 'INVALID_PROTOBUF_FIELD', message: 'Invalid protobuf field' },
    TRUNCATED_PROTOBUF_FIELD: {
        code: 'TRUNCATED_PROTOBUF_FIELD',
        message: 'Truncated protobuf field'
    },
    UNSUPPORTED_PROTOBUF_FIELD: {
        code: 'UNSUPPORTED_PROTOBUF_FIELD',
        message: 'Unsupported protobuf field'
    },
    MISSING_OR_AMBIGUOUS_PROTOBUF_FIELD: {
        code: 'MISSING_OR_AMBIGUOUS_PROTOBUF_FIELD',
        message: 'Missing or ambiguous protobuf field'
    },
    INVALID_PROTOBUF_FIELD_TYPE: {
        code: 'INVALID_PROTOBUF_FIELD_TYPE',
        message: 'Invalid protobuf field type'
    },
    INVALID_UTF_8_IN_RESPONSE: {
        code: 'INVALID_UTF_8_IN_RESPONSE',
        message: 'Invalid UTF-8 in response'
    },
    INVALID_FILE_METADATA: { code: 'INVALID_FILE_METADATA', message: 'Invalid file metadata.' },
    INCOMPLETE_DOWNLOAD_CHUNKS: {
        code: 'INCOMPLETE_DOWNLOAD_CHUNKS',
        message: 'Load the remaining chunks before downloading.'
    },
    DOWNLOAD_CHUNK_MISMATCH: {
        code: 'DOWNLOAD_CHUNK_MISMATCH',
        message: 'Downloaded chunks do not match this file.'
    },
    COULD_NOT_SAVE_THE_DOWNLOADED_FILE: {
        code: 'COULD_NOT_SAVE_THE_DOWNLOADED_FILE',
        message: 'Could not save the downloaded file.'
    },
    FILE_INTEGRITY_FAILED: {
        code: 'FILE_INTEGRITY_FAILED',
        message: 'Reconstructed file failed SHA-256 verification.'
    },
    COULD_NOT_CREATE_THE_DOWNLOADED_FILE: {
        code: 'COULD_NOT_CREATE_THE_DOWNLOADED_FILE',
        message: 'Could not create the downloaded file.'
    },
    COULD_NOT_CLOSE_THE_DOWNLOADED_FILE: {
        code: 'COULD_NOT_CLOSE_THE_DOWNLOADED_FILE',
        message: 'Could not close the downloaded file.'
    },
    COULD_NOT_READ_THE_DOWNLOADED_FILE: {
        code: 'COULD_NOT_READ_THE_DOWNLOADED_FILE',
        message: 'Could not read the downloaded file.'
    },
    INVALID_DOWNLOADED_FILE_DATA: {
        code: 'INVALID_DOWNLOADED_FILE_DATA',
        message: 'Invalid downloaded file data.'
    }
} as const;

export type ServerError =
    | (typeof SERVER_ERRORS)[keyof typeof SERVER_ERRORS]
    | { readonly code: 'REQUEST_FAILED'; readonly message: string };
