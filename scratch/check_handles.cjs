const fs = require('fs');
const content = fs.readFileSync('H:\\\\DXF_Viewer\\\\2026_modificado (3).dxf', 'latin1');
const entitiesIdx = content.indexOf('ENTITIES');
const entitiesEnd = content.indexOf('ENDSEC', entitiesIdx);
const entitiesSection = content.substring(entitiesIdx, entitiesEnd);

const handleMatches = entitiesSection.match(/\n[ \t]*5[ \t]*\r?\n/g);
console.log(`Found ${handleMatches ? handleMatches.length : 0} handles (group 5) in ENTITIES.`);

const acdbMatches = entitiesSection.match(/AcDbEntity/g);
console.log(`Found ${acdbMatches ? acdbMatches.length : 0} AcDbEntity subclasses in ENTITIES.`);
