import {
    groupChunks,
    sortFiles,
    filterFiles,
    fileType,
    type UploadedChunk
} from '@madkarmaa/phodrive-core/files';
import { FileSort } from '@madkarmaa/phodrive-core/models';
import { readLibraryPage, readLibrarySnapshot } from '@madkarmaa/phodrive-core/browser/library';

/** Library pagination, filtering, and stale-request protection for the signed-in account. */
export class DriveLibrary {
    chunks = $state<UploadedChunk[]>([]);
    nextPageToken = $state('');
    loading = $state(false);

    private libraryRequest = 0;
    private loadedPages = 0;
    private libraryPageTokens = new Set<string>();

    searchTerm = $state('');
    typeFilter = $state('');
    modifiedDays = $state('');
    loadFailed = $state(false);

    files = $derived(groupChunks(this.chunks));
    availableTypes = $derived([...new Set(this.files.map((item) => fileType(item.name)))].sort());
    visibleFiles = $derived.by(() =>
        sortFiles(
            filterFiles(this.files, this.searchTerm, this.typeFilter, this.modifiedDays),
            this.sortOrder()
        )
    );

    constructor(
        private readonly email: string,
        private readonly actionsDisabled: () => boolean,
        private readonly sortOrder: () => FileSort,
        private readonly feedback: (message: string) => void
    ) {}

    reset() {
        this.searchTerm = '';
        this.typeFilter = '';
        this.modifiedDays = '';
        this.chunks = [];
        this.nextPageToken = '';
        this.loadedPages = 0;
        this.libraryPageTokens.clear();
        this.libraryRequest++;
        this.loading = false;
        this.loadFailed = false;
    }

    async load(reset = true) {
        if (this.actionsDisabled() || (!reset && (this.loading || !this.nextPageToken))) return;

        const email = this.email;
        const pageToken = reset ? '' : this.nextPageToken;
        const request = ++this.libraryRequest;
        if (reset) {
            this.chunks = [];
            this.nextPageToken = '';
            this.loadedPages = 0;
            this.libraryPageTokens.clear();
            this.loadFailed = false;
        }

        this.loading = true;
        this.feedback('');

        const loaded = await readLibraryPage(pageToken);

        if (request !== this.libraryRequest) return;

        loaded.match({
            Ok: (data) => {
                this.loadFailed = false;

                const found: UploadedChunk[] = data.items.map((item) => ({
                    ...item,
                    email
                }));
                const chunks = reset ? found : [...this.chunks, ...found];
                this.chunks = [
                    ...new Map(
                        chunks.map((item) => [`${item.email}:${item.mediaKey}`, item])
                    ).values()
                ];
                this.nextPageToken = data.nextPageToken;
                if (data.nextPageToken && this.libraryPageTokens.has(data.nextPageToken)) {
                    this.nextPageToken = '';
                    this.loadFailed = true;
                    this.feedback('Google Photos repeated a library page. Refresh to try again.');
                }
                if (this.nextPageToken) this.libraryPageTokens.add(this.nextPageToken);

                this.loadedPages++;
            },
            Err: (error) => {
                this.loadFailed = true;
                this.feedback(error.message);
            }
        });
        this.loading = false;
    }

    async refresh() {
        if (this.actionsDisabled() || this.loading || document.hidden) return;

        const email = this.email;
        const request = ++this.libraryRequest;
        this.loading = true;

        const refreshed = await readLibrarySnapshot(this.loadedPages);
        if (request !== this.libraryRequest) return;

        refreshed.match({
            Ok: (snapshot) => {
                this.loadFailed = false;
                this.chunks = snapshot.items.map((item) => ({ ...item, email }));
                this.nextPageToken = snapshot.nextPageToken;
                this.loadedPages = snapshot.pages;
                this.libraryPageTokens.clear();
                if (snapshot.nextPageToken) this.libraryPageTokens.add(snapshot.nextPageToken);
            },
            Err: (error) => {
                this.loadFailed = true;
                this.feedback(error.message);
            }
        });

        this.loading = false;
    }
}
