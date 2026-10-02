/** Recoverable failures carry a stable code and a user-facing message. */
export type ApplicationError = {
    readonly code:
        | 'ACCOUNT_CONNECTION_FAILED'
        | 'DELETE_FAILED'
        | 'DOWNLOAD_RECEIVE_FAILED'
        | 'INCOMPLETE_DOWNLOAD_CHUNKS'
        | 'INVALID_CONCURRENT_WORKERS'
        | 'INVALID_DELETE_RESPONSE'
        | 'INVALID_FORM_REQUEST'
        | 'INVALID_JSON_REQUEST'
        | 'INVALID_OAUTH_CREDENTIALS'
        | 'INVALID_REFRESH_INTERVAL'
        | 'INVALID_SCHEMA'
        | 'INVALID_STORED_JSON'
        | 'INVALID_UPLOAD_PROGRESS'
        | 'OAUTH_EXCHANGE_FAILED'
        | 'REPEATED_LIBRARY_PAGE'
        | 'REQUEST_FAILED'
        | 'STORAGE_UNAVAILABLE'
        | 'UPLOAD_FAILED'
        | 'UPLOAD_STREAM_INTERRUPTED';
    readonly message: string;
};
