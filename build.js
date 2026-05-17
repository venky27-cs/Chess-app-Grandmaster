const fs = require('fs');
const path = require('path');

// Create dist directory
fs.mkdirSync('dist', { recursive: true });

// Read all files in the current directory
const files = fs.readdirSync('.');

// Copy everything into dist except node_modules, .git, and dist itself
for (const file of files) {
    if (file !== 'dist' && file !== 'node_modules' && file !== '.git') {
        fs.cpSync(file, path.join('dist', file), { recursive: true });
    }
}
console.log("Successfully copied files to dist/ for deployment.");
