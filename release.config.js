import { DEFAULT_COMMIT_TYPES } from 'conventional-changelog-conventionalcommits';

const RELEASE_PRESET_CONFIG = {
    types: [
        { type: 'chore', scope: 'deps', section: 'Dependency Updates', effect: 'bump' },
        ...DEFAULT_COMMIT_TYPES.map((commitType) =>
            commitType.type === 'refactor' ? { ...commitType, effect: 'bump' } : commitType
        )
    ]
};

/** @type {import('semantic-release').Options} */
export default {
    branches: ['main'],
    tagFormat: 'v${version}',
    // The writer override in package.json supports the preset's render functions.
    plugins: [
        [
            '@semantic-release/commit-analyzer',
            {
                preset: 'conventionalcommits',
                presetConfig: RELEASE_PRESET_CONFIG,
                releaseRules: [
                    { breaking: true, release: 'major' },
                    { type: 'refactor', release: 'patch' },
                    { type: 'chore', scope: 'deps', release: 'patch' }
                ]
            }
        ],
        [
            '@semantic-release/release-notes-generator',
            { preset: 'conventionalcommits', presetConfig: RELEASE_PRESET_CONFIG }
        ],
        ['@semantic-release/npm', { npmPublish: false }],
        [
            '@semantic-release/git',
            {
                assets: ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'],
                message: 'chore(release): ${nextRelease.version} [skip ci]'
            }
        ],
        [
            '@semantic-release/github',
            {
                successComment: false,
                failComment: false,
                releasedLabels: false
            }
        ]
    ]
};
