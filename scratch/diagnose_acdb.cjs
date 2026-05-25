const fs = require('fs');
const fileContent = fs.readFileSync('H:\\DXF_Viewer\\2026_modificado (3).dxf', 'utf8');
console.log("Has AcDbLine:", fileContent.includes("AcDbLine"));
