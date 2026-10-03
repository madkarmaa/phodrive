/** @type {import('semantic-release').Options} */
export default {
    branches: ['main'],
    tagFormat: 'v${version}',
    // Keep the Conventional Commits preset on major 9 for the notes generator's writer 8.
    plugins: [
        ['@semantic-release/commit-analyzer', { preset: 'conventionalcommits' }],
        ['@semantic-release/release-notes-generator', { preset: 'conventionalcommits' }],
        ['@semantic-release/changelog', { changelogFile: 'CHANGELOG.md' }],
        ['@semantic-release/npm', { npmPublish: false }],
        [
            '@semantic-release/git',
            {
                assets: [
                    'CHANGELOG.md',
                    'package.json',
                    'package-lock.json',
                    'npm-shrinkwrap.json'
                ],
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
