<p align="center">
    <img src="./src/lib/assets/favicon.svg" alt="result-ts logo" width="100" height="auto" />
    <h1 align="center">Phodrive</h1>
    <p align="center"><i>Files worth a thousand pixels.</i></p>
</p>

Use Google Photos as a cloud storage provider by spoofing a Pixel XL device to get unlimited storage.

> [!CAUTION]
> Using this project may violate Google’s terms or policies and could result in your Google account being restricted or banned.

## Run locally

```sh
bun install
bun --bun run dev
```

Open `http://127.0.0.1:5173`. Add a Google account email and the one-time `oauth2_4/` token from [Google Embedded Setup](https://accounts.google.com/EmbeddedSetup).

Phodrive exchanges it for an `aas_et/` token on the local server, verifies that Google accepts the email and AAS token, then saves only the AAS token in browser local storage. Existing AAS tokens can also be entered directly and are checked before saving.

> [!NOTE]
> The server keeps no copy, **everything is local**.

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
PHODRIVE_DEFAULT_REFRESH_INTERVAL_SECONDS=120 PHODRIVE_DEFAULT_CONCURRENT_WORKERS=4 bun --bun run dev
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
HOST=127.0.0.1 PORT=3000 ORIGIN=http://127.0.0.1:3000 BODY_SIZE_LIMIT=Infinity bun build/index.js
```

Open `http://127.0.0.1:3000` for the production build.

The server binds to `127.0.0.1`. `BODY_SIZE_LIMIT=Infinity` lets the server receive each BMP above [SvelteKit’s default 512 KiB request limit](https://svelte.dev/docs/kit/adapter-node#Environment-variables-BODY_SIZE_LIMIT).

Google’s private Photos endpoints reject browser CORS preflights, so the browser converts the file and the local server sends the authenticated protocol requests.

> [!WARNING]
> Do not expose this server to other machines.
>
> The local API is not designed as a public service: it has no user authentication. A person who can reach it could send requests through your server to Google Photos and could use your machine's network and resources.

## Run with Docker

> Install [Buildx](https://github.com/docker/buildx#installing) if your Docker installation does not include it.

```sh
docker build --pull -t phodrive .
docker run --rm --init --name phodrive -p 127.0.0.1:3000:3000 phodrive
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
