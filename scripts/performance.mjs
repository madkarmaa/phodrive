import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir, cpus, platform, release } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const cases = JSON.parse(
    await readFile(new URL('../benchmarks/cases.json', import.meta.url), 'utf8')
);
const selected = process.argv.slice(2).filter((arg) => !arg.startsWith('--output='));
const output = process.argv
    .slice(2)
    .find((arg) => arg.startsWith('--output='))
    ?.slice(9);
const directory = await mkdtemp(join(tmpdir(), 'phodrive-perf-'));
const manifestPath = fileURLToPath(import.meta.resolve('vitest/package.json'));
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const runner = resolve(dirname(manifestPath), manifest.bin.vitest);
const results = [];
try {
    for (const name of selected.length ? selected : cases) {
        if (!cases.includes(name)) throw new Error(`Unknown benchmark: ${name}`);
        const resultPath = join(directory, `${name}.json`);
        await new Promise((resolveRun, reject) => {
            const child = spawn(
                process.execPath,
                [runner, 'run', '--config', 'benchmarks/vitest.config.ts'],
                {
                    stdio: ['ignore', 'pipe', 'pipe'],
                    env: {
                        ...process.env,
                        PHODRIVE_PERF_CASE: name,
                        PHODRIVE_PERF_RESULT: resultPath
                    }
                }
            );
            let diagnostics = '';
            child.stdout.on('data', (chunk) => {
                diagnostics += chunk;
            });
            child.stderr.on('data', (chunk) => {
                diagnostics += chunk;
            });
            child.on('error', reject);
            child.on('exit', (code) =>
                code === 0 ? resolveRun(undefined) : reject(new Error(diagnostics))
            );
        });
        const result = JSON.parse(await readFile(resultPath, 'utf8'));
        results.push(result);
        console.log(
            `${name}: ${result.medianMs.toFixed(2)} ms; peak RSS ${result.peakRssMiB.toFixed(1)} MiB`
        );
        if (output)
            await writeFile(
                output,
                JSON.stringify(
                    {
                        environment: {
                            runtime: process.version,
                            platform: platform(),
                            release: release(),
                            cpu: cpus()[0]?.model
                        },
                        results
                    },
                    null,
                    2
                ) + '\n'
            );
    }
} finally {
    await rm(directory, { recursive: true, force: true });
}
