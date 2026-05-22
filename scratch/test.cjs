const fs = require('fs');
const DxfParser = require('dxf-parser');

const c = 7;
const x1 = 10;
const y1 = 20;
const x2 = 30;
const y2 = 40;
const h = 'F00001';

const customEntities = `  0\r\nLINE\r\n  5\r\n${h}\r\n100\r\nAcDbEntity\r\n  8\r\n0\r\n 62\r\n${c}\r\n100\r\nAcDbLine\r\n 10\r\n${x1.toFixed(4)}\r\n 20\r\n${y1.toFixed(4)}\r\n 30\r\n0.0\r\n 11\r\n${x2.toFixed(4)}\r\n 21\r\n${y2.toFixed(4)}\r\n 31\r\n0.0\r\n`;

const customText = `  0\r\nTEXT\r\n  5\r\nF00002\r\n100\r\nAcDbEntity\r\n  8\r\n0\r\n 62\r\n${c}\r\n100\r\nAcDbText\r\n 10\r\n10.0\r\n 20\r\n10.0\r\n 30\r\n0.0\r\n 40\r\n5.0\r\n  1\r\nHello\r\n`;

const dxf = `  0\r\nSECTION\r\n  2\r\nENTITIES\r\n` + customEntities + customText + `  0\r\nENDSEC\r\n  0\r\nEOF\r\n`;

try {
  const parser = new DxfParser();
  parser.parseSync(dxf);
  console.log('Valid DXF syntax');
} catch (e) {
  console.error('DXF parse error:', e.message);
}
