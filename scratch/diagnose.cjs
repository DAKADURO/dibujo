const fs = require('fs');

try {
    const fileContent = fs.readFileSync('H:\\DXF_Viewer\\2026_modificado (3).dxf', 'utf8');
    const entitiesHeader = fileContent.match(/2\s*\r?\nENTITIES/i);
    if (!entitiesHeader) {
        console.log("No ENTITIES section found");
        process.exit(1);
    }
    const startIndex = entitiesHeader.index + entitiesHeader[0].length;
    const section = fileContent.substring(startIndex);
    const endsecMatch = section.match(/\n[ \t]*0[ \t]*\r?\n[ \t]*ENDSEC/i);
    
    if (!endsecMatch) {
        console.log("No ENDSEC found");
    } else {
        const end = startIndex + endsecMatch.index;
        console.log("Last 500 chars of ENTITIES section:");
        console.log(fileContent.substring(end - 500, end + 20));
    }
} catch(e) {
    console.error(e);
}
