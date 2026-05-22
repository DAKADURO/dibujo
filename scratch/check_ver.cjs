const fs = require('fs');
const content = fs.readFileSync('H:\\\\DXF_Viewer\\\\2026_modificado (3).dxf', 'utf8');
const match = content.match(/\\$ACADVER[\\s\\S]{0,50}?1\\s*\\r?\\n\\s*(AC[0-9]+)/);
console.log('Regex:', match ? match[1] : 'null');
const idx = content.indexOf('$ACADVER');
if (idx !== -1) {
  console.log('String:', JSON.stringify(content.substring(idx, idx + 40)));
}
