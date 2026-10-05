<p align="center">
    <img src="./src/lib/assets/favicon.svg" alt="result-ts logo" width="100" height="auto" />
    <h1 align="center">Phodrive</h1>
    <p align="center"><i>Files worth a thousand pixels.</i></p>
</p>

Use Google Photos as a cloud storage provider by spoofing a Pixel XL device to get unlimited storage.

> [!CAUTION]
> Using this project may violate Google’s terms or policies and could result in your Google account being restricted or banned.

## Run locally

Use Node.js 22.22.2 (22.x) or 24.15 or newer, or Bun.

```sh
bun install
bun --bun run dev
```

1. Open `http://127.0.0.1:5173`
2. Add a Google account email and the one-time `oauth2_4/` token from the [Google Embedded Setup](https://accounts.google.com/EmbeddedSetup) cookies
3. In developer tools, open **Application → Cookies → https://accounts.google.com** and copy the cookie value starting with `oauth2_4/`.

Phodrive exchanges it for an `aas_et/` token on the local server, verifies that Google accepts the email and AAS token, then saves only the AAS token in browser local storage. Existing AAS tokens can also be entered directly and are checked before saving.

> [!NOTE]
> Credentials are stored only in your browser. The server uses them for each request and does not save them.
> Files use private temporary server storage while processing and are removed when the operation finishes.

### Deployment defaults

Settings use this order: **saved user choice → deployment default → hardcoded default**. Unset browser preferences are not saved automatically, so changing deployment defaults still affects users who have not chosen their own values.

| Environment variable                        | Hardcoded default | Allowed values                                           |
| ------------------------------------------- | ----------------- | -------------------------------------------------------- |
| `PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS` | `60`              | Whole seconds from `0` to `86400`; `0` disables refresh  |
| `PHODRIVE_DEFAULT_CONCURRENT_WORKERS`       | `8`               | Whole numbers from `1` to `32`                           |
| `PHODRIVE_DEFAULT_THEME`                    | `auto`            | `auto`, `light`, `dark`                                  |
| `PHODRIVE_DEFAULT_SORT`                     | `modified-desc`   | `modified-desc`, `modified-asc`, `name-asc`, `name-desc` |

Set these variables in the server environment before starting the app. Missing or invalid values use the hardcoded defaults. The server publishes only the validated settings defaults; credentials stay private. For example:

```sh
bunx cross-env PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS=120 PHODRIVE_DEFAULT_CONCURRENT_WORKERS=4 bun run dev
```

For Docker, pass the same variables with `-e`, for example `-e PHODRIVE_DEFAULT_CONCURRENT_WORKERS=4`.

For a production build on this computer, using Node.js for the standard adapter launch:

```sh
bun run build
bun run start
```

To build and serve using Bun:

```sh
bun --bun run build
bun run start:bun
```

Open `http://127.0.0.1:3000` for the production build.

The build compiles `src/server.ts` to `build/server.js`, which the start commands launch with incoming request deadlines disabled using SvelteKit's generated handler. Google requests have no connection, header, body, or overall timeout so slow networks can finish transfers.

> [!WARNING]
> Do not expose this server to other machines.
>
> The local API is not designed as a public service: it has no user authentication. A person who can reach it could send requests through your server to Google Photos and could use your machine's network and resources.

## Run with Docker

```sh
docker run --pull always --rm --init --name phodrive -p 127.0.0.1:3000:3000 ghcr.io/madkarmaa/phodrive:latest
```

## Verify

Tests use [Vitest](https://vitest.dev/).

```sh
bun run check
bun run test
bun run build
```

## Attribution

Copyright © 2026 MadKarma (madkarmaa). Phodrive is licensed under the MIT License; see [LICENSE](./LICENSE).

Google Photos protocol implementation is based on [xob0t/gotohp](https://github.com/xob0t/gotohp) (MIT).

The Photos library request mask is based on [xob0t/gpmc](https://github.com/xob0t/gpmc) (MIT).

The OAuth2-to-AAS exchange is adapted from [xhyrom/sniff's `oauth2aas`](https://github.com/xhyrom/sniff/tree/main/oauth2aas) (Apache-2.0).

## AI use

AI tools assisted with upstream research, implementation, refactoring, visual assets, testing, and documentation. The project maintainer directs the work and is responsible for reviewing and accepting AI-assisted contributions.
