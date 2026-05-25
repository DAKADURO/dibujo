const fs = require('fs');
const fileContent = fs.readFileSync('H:\\DXF_Viewer\\2026_modificado (3).dxf', 'utf8');
const acadverIdx = fileContent.indexOf('$ACADVER');
console.log("ACADVER idx:", acadverIdx);
if (acadverIdx !== -1) {
    console.log(fileContent.substring(acadverIdx, acadverIdx + 100));
}
