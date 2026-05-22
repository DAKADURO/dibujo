const fs = require('fs');
const content = fs.readFileSync('H:\\\\DXF_Viewer\\\\2026_modificado (3).dxf', 'latin1');
const acadverIdx = content.indexOf('$ACADVER');
if (acadverIdx !== -1) {
    console.log(content.substring(acadverIdx, acadverIdx + 50));
} else {
    console.log('No $ACADVER string found.');
}
