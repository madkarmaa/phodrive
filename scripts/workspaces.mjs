import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const task = process.argv[2];
const forwarded = process.argv.slice(3);
// Each step is one [workspace, script] pair, or a list of pairs that run together.
const tasks = {
    prepare: [
        ['core', 'build'],
        ['web', 'prepare']
    ],
    build: [
        ['core', 'build'],
        ['web', 'build'],
        ['server', 'build'],
        ['cli', 'build']
    ],
    check: [
        ['core', 'build'],
        ['core', 'check'],
        ['web', 'check'],
        ['server', 'check'],
        ['cli', 'check']
    ],
    test: [
        ['core', 'build'],
        ['core', 'test'],
        ['web', 'test'],
        ['server', 'test'],
        ['cli', 'test']
    ],
    cli: [
        ['core', 'build'],
        ['cli', 'build'],
        ['cli', 'start']
    ],
    compile: [['cli', 'compile']],
    dev: [
        ['core', 'build'],
        [
            ['server', 'dev'],
            ['web', 'dev']
        ]
    ],
    start: [['server', 'start']],
    'start:bun': [['server', 'start:bun']],
    'check:watch': [
        ['core', 'build'],
        ['web', 'check:watch']
    ]
};

if (!Object.hasOwn(tasks, task)) throw new Error(`Unknown workspace task: ${task}`);

// Use the package manager that invoked this script, with no shell or platform-specific commands.
const packageManager = process.env.npm_execpath;
if (!packageManager) throw new Error('Run workspace tasks through bun run or npm run.');
const useBun = /^bun(?:\.exe)?$/.test(basename(packageManager));
const executable = useBun ? packageManager : process.execPath;

function run([workspace, script], extra) {
    const args = useBun
        ? [...(process.versions.bun ? ['--bun'] : []), 'run', script]
        : [packageManager, 'run', script, '--'];
    args.push(...extra);

    const child = spawn(executable, args, {
        cwd: fileURLToPath(new URL(`../${workspace}/`, import.meta.url)),
        stdio: 'inherit',
        env: process.env
    });
    const exited = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
    });

    return { child, exited };
}

/** Parallel scripts stop together: when one exits, the others are interrupted. */
async function runStep(step, extra) {
    const commands = typeof step[0] === 'string' ? [step] : step;
    const running = commands.map((command) => run(command, extra));
    const forward = (signal) => () => running.forEach(({ child }) => child.kill(signal));
    const interrupt = forward('SIGINT');
    const terminate = forward('SIGTERM');
    process.once('SIGINT', interrupt);
    process.once('SIGTERM', terminate);

    try {
        const first = await Promise.race(running.map(({ exited }) => exited));
        if (running.length > 1) interrupt();

        const codes = await Promise.all(running.map(({ exited }) => exited));

        return codes.find((code) => code !== 0) ?? first;
    } finally {
        process.removeListener('SIGINT', interrupt);
        process.removeListener('SIGTERM', terminate);
    }
}

for (const [index, step] of tasks[task].entries()) {
    const code = await runStep(step, index === tasks[task].length - 1 ? forwarded : []);
    if (code !== 0) {
        process.exitCode = code;
        break;
    }
}
