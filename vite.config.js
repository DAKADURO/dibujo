import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import fs from 'fs';

function generateVersion() {
    return {
        name: 'generate-version',
        buildStart() {
            if (!fs.existsSync('public')) fs.mkdirSync('public');
            fs.writeFileSync('public/version.json', JSON.stringify({ version: Date.now() }));
        }
    };
}

export default defineConfig({
    plugins: [viteSingleFile(), generateVersion()],
});
