/** @type {import('semantic-release').Options} */
export default {
    branches: ['main'],
    tagFormat: 'v${version}',
    // The writer override in package.json supports the preset's render functions.
    plugins: [
        ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
        ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
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
