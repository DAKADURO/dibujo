const fs = require('fs');
const content = fs.readFileSync('H:\\\\DXF_Viewer\\\\2026_modificado (3).dxf', 'latin1');
const entitiesIdx = content.indexOf('ENTITIES');
const entitiesEnd = content.indexOf('ENDSEC', entitiesIdx);
const entitiesSection = content.substring(entitiesIdx, entitiesEnd);

const ownerMatches = entitiesSection.match(/330[\\s\\r\\n]+([0-9A-Fa-f]+)/g);
if (ownerMatches && ownerMatches.length > 0) {
    console.log('Found 330 pointers:', ownerMatches.slice(0, 5));
} else {
    console.log('No 330 pointers found in ENTITIES section at all.');
}
