import { invalidateAll } from '$app/navigation';
import { replaceGoogleToken, signOut } from '#browser/auth';
import type { DriveLibrary } from '#browser/drive/library.svelte';

/** Replacing the Google token and signing out, allowed only while no file work is running. */
export class DriveAccount {
    replacingToken = $state(false);
    signingOut = $state(false);

    constructor(
        private readonly library: DriveLibrary,
        private readonly idle: () => boolean,
        private readonly feedback: (message: string) => void
    ) {}

    /** Validate a new Google token on the server, then reload files with it. */
    async replaceToken(token: string): Promise<boolean> {
        if (this.replacingToken || !this.idle()) return false;

        this.replacingToken = true;
        this.feedback('');

        const replaced = await replaceGoogleToken(token);

        this.replacingToken = false;

        return replaced.match({
            Ok: () => {
                this.library.reset();
                void this.library.load();

                return true;
            },
            Err: (error) => {
                this.feedback(error.message);

                return false;
            }
        });
    }

    async signOut() {
        if (this.signingOut || !this.idle()) return;

        this.signingOut = true;

        const signedOut = await signOut();

        this.signingOut = false;

        await signedOut.match({
            Ok: () => invalidateAll(),
            Err: async (error) => this.feedback(error.message)
        });
    }
}
