const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    js.configs.recommended,
    {
        // Server, scripts and tests: CommonJS on Node.
        files: ['*.js', 'scripts/**/*.js', 'test/**/*.js'],
        languageOptions: { sourceType: 'commonjs', globals: globals.node }
    },
    {
        // Browser pages: plain scripts sharing the page's globals.
        files: ['public/js/**/*.js'],
        languageOptions: {
            sourceType: 'script',
            globals: {
                ...globals.browser,
                io: 'readonly',          // /socket.io/socket.io.js
                VotingTimer: 'readonly', // public/js/voting-timer.js
                Motion: 'readonly'       // public/js/motion.js
            }
        }
    },
    {
        rules: {
            // Allow deliberately unused arguments/catch bindings named _ or e.
            'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }]
        }
    }
];
