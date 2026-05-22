const fs = require('fs');

try {
    const content = fs.readFileSync('H:\\\\DXF_Viewer\\\\2026_modificado (3).dxf', 'latin1');
    const entitiesIdx = content.indexOf('ENTITIES');
    if (entitiesIdx === -1) {
        console.log('No ENTITIES section found.');
        process.exit(0);
    }
    
    const searchString = content.substring(entitiesIdx);
    const endsecMatch = searchString.match(/\n[ \t]*0[ \t]*\r?\n[ \t]*ENDSEC/i);
    if (!endsecMatch) {
        console.log('No ENDSEC found in ENTITIES section.');
        process.exit(0);
    }
    
    const endsecIdx = entitiesIdx + endsecMatch.index;
    
    // Print the 500 characters before ENDSEC
    const beforeEndsec = content.substring(endsecIdx - 500, endsecIdx + 20);
    console.log("=== LAST 500 CHARACTERS OF ENTITIES ===");
    console.log(beforeEndsec.replace(/\r/g, '\\r').replace(/\n/g, '\\n\n'));
    console.log("=======================================");
    
} catch (e) {
    console.error('Error reading file:', e);
}
