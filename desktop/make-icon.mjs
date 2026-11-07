// Genera build/icon.png (1024x1024) dall'SVG dell'app web. Usa sharp, installato in ../web (via @capacitor/assets).
// Il PNG risultante e' committato: serve rilanciarlo solo se cambia l'icona.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const require = createRequire(new URL('../web/package.json', import.meta.url));
const sharp = require('sharp');

const svg = fs.readFileSync(fileURLToPath(new URL('../web/public/icon.svg', import.meta.url)));
const out = fileURLToPath(new URL('./build/icon.png', import.meta.url));
fs.mkdirSync(fileURLToPath(new URL('./build/', import.meta.url)), { recursive: true });
await sharp(svg, { density: 384 }).resize(1024, 1024).png().toFile(out);
console.log('build/icon.png creato');
