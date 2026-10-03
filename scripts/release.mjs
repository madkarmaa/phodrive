import { appendFile } from 'node:fs/promises';
import semanticRelease from 'semantic-release';

const release = await semanticRelease({});
const outputPath = process.env.GITHUB_OUTPUT;

if (outputPath) {
    const outputs = release
        ? [
              'published=true',
              `version=${release.nextRelease.version}`,
              `tag=${release.nextRelease.gitTag}`,
              `revision=${release.nextRelease.gitHead}`
          ]
        : ['published=false'];

    await appendFile(outputPath, `${outputs.join('\n')}\n`);
}
