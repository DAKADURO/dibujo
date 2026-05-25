const fs = require('fs');
const fileContent = fs.readFileSync('H:\\DXF_Viewer\\2026_modificado (3).dxf', 'utf8');
const verMatch = fileContent.match(/\$ACADVER[\s\S]{1,50}?(AC10[0-9]{2})/);
console.log("Version Match:", verMatch ? verMatch[1] : "NOT FOUND");
