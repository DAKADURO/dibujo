const fs = require('fs');
const fileContent = fs.readFileSync('H:\\DXF_Viewer\\2026_modificado (3).dxf', 'utf8');
const verMatch = fileContent.match(/\$ACADVER[\s\S]{0,20}?\n([^\n\r]+)/);
console.log("verMatch[1]:", verMatch ? verMatch[1].trim() : "null");
