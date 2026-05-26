import DxfParser from 'dxf-parser';
import { setupAnnotations, resizeAnnotations, setToolChangeCallback, setMode, getFabricObjects } from './annotations.js';
import { generateBOM, exportBOMtoCSV } from './bom.js';

const dxfInput = document.getElementById('dxf-input');
const canvas = document.getElementById('dxf-canvas');
const ctx = canvas.getContext('2d');
const loading = document.getElementById('loading');

window.addEventListener('error', (e) => {
    if (e.message && e.message.includes('ResizeObserver')) return;
    alert(`Error: ${e.message} \nLine: ${e.lineno}`);
});

let dxfData = null;
let rawDxfContent = null;     // decoded string (latin1) of original file
let rawDxfBytes = null;       // Uint8Array of original file (preserved for export)
export const viewState = {
    x: 0,
    y: 0,
    scale: 1,
    isDragging: false,
    lastX: 0,
    lastY: 0
};
window.viewState = viewState;

// ─── Measurement State ───
let measurements = [];
let customLines = [];
let measurePending = null; // first click point (in DXF coords)
let linePending = null;
let currentTool = 'pan'; // pan, measure, cople, rect, text, sum, draw, delete, sym-*
let currentMousePt = { x: 0, y: 0 };
let currentSnapPoint = null;

const CATALOG_AIRPIPE = {
    'reductor': [
        { code: '2121', d1: '25mm (1")', d2: '20mm (3/4")', label: '2121: 25mm (1") x 20mm (3/4")' },
        { code: '4221', d1: '40mm (1 1/2")', d2: '25mm (1")', label: '4221: 40mm (1 1/2") x 25mm (1")' },
        { code: '5221', d1: '50mm (2")', d2: '25mm (1")', label: '5221: 50mm (2") x 25mm (1")' },
        { code: '5421', d1: '50mm (2")', d2: '40mm (1 1/2")', label: '5421: 50mm (2") x 40mm (1 1/2")' },
        { code: '8421', d1: '63mm (2 1/2")', d2: '40mm (1 1/2")', label: '8421: 63mm (2 1/2") x 40mm (1 1/2")' },
        { code: '6521', d1: '63mm (2 1/2")', d2: '50mm (2")', label: '6521: 63mm (2 1/2") x 50mm (2")' },
        { code: '7521', d1: '80mm (3")', d2: '50mm (2")', label: '7521: 80mm (3") x 50mm (2")' },
        { code: '7621', d1: '80mm (3")', d2: '63mm (2 1/2")', label: '7621: 80mm (3") x 63mm (2 1/2")' },
        { code: '8621', d1: '100mm (4")', d2: '63mm (2 1/2")', label: '8621: 100mm (4") x 63mm (2 1/2")' },
        { code: '8721', d1: '100mm (4")', d2: '80mm (3")', label: '8721: 100mm (4") x 80mm (3")' },
        { code: '9721', d1: '150mm (6")', d2: '80mm (3")', label: '9721: 150mm (6") x 80mm (3")' },
        { code: '9821', d1: '150mm (6")', d2: '100mm (4")', label: '9821: 150mm (6") x 100mm (4")' },
        { code: 'A921', d1: '200mm (8")', d2: '150mm (6")', label: 'A921: 200mm (8") x 150mm (6")' }
    ],
    'tee-red': [
        { code: '2107', d1: '25mm (1")', d2: '20mm (3/4")', label: '2107: 25mm (1") x 20mm (3/4")' },
        { code: '4207', d1: '40mm (1 1/2")', d2: '25mm (1")', label: '4207: 40mm (1 1/2") x 25mm (1")' },
        { code: '5207', d1: '50mm (2")', d2: '25mm (1")', label: '5207: 50mm (2") x 25mm (1")' },
        { code: '5407', d1: '50mm (2")', d2: '40mm (1 1/2")', label: '5407: 50mm (2") x 40mm (1 1/2")' },
        { code: '6407', d1: '63mm (2 1/2")', d2: '40mm (1 1/2")', label: '6407: 63mm (2 1/2") x 40mm (1 1/2")' },
        { code: '6507', d1: '63mm (2 1/2")', d2: '50mm (2")', label: '6507: 63mm (2 1/2") x 50mm (2")' },
        { code: '7407', d1: '80mm (3")', d2: '40mm (1 1/2")', label: '7407: 80mm (3") x 40mm (1 1/2")' },
        { code: '7507', d1: '80mm (3")', d2: '50mm (2")', label: '7507: 80mm (3") x 50mm (2")' },
        { code: '8507', d1: '100mm (4")', d2: '50mm (2")', label: '8507: 100mm (4") x 50mm (2")' },
        { code: '7607', d1: '80mm (3")', d2: '63mm (2 1/2")', label: '7607: 80mm (3") x 63mm (2 1/2")' },
        { code: '8607', d1: '100mm (4")', d2: '63mm (2 1/2")', label: '8607: 100mm (4") x 63mm (2 1/2")' },
        { code: '8707', d1: '100mm (4")', d2: '80mm (3")', label: '8707: 100mm (4") x 80mm (3")' },
        { code: '9607', d1: '150mm (6")', d2: '63mm (2 1/2")', label: '9607: 150mm (6") x 63mm (2 1/2")' },
        { code: '9707', d1: '150mm (6")', d2: '80mm (3")', label: '9707: 150mm (6") x 80mm (3")' },
        { code: '9807', d1: '150mm (6")', d2: '100mm (4")', label: '9807: 150mm (6") x 100mm (4")' },
        { code: 'A607', d1: '200mm (8")', d2: '63mm (2 1/2")', label: 'A607: 200mm (8") x 63mm (2 1/2")' },
        { code: 'A707', d1: '200mm (8")', d2: '80mm (3")', label: 'A707: 200mm (8") x 80mm (3")' },
        { code: 'A807', d1: '200mm (8")', d2: '100mm (4")', label: 'A807: 200mm (8") x 100mm (4")' },
        { code: 'A907', d1: '200mm (8")', d2: '150mm (6")', label: 'A907: 200mm (8") x 150mm (6")' }
    ],
    'tee-lat': [
        { code: '8712', d1: '100mm (4")', d2: '80mm (3")', label: '8712: 100mm (4") x 80mm (3")' },
        { code: '9712', d1: '150mm (6")', d2: '80mm (3")', label: '9712: 150mm (6") x 80mm (3")' },
        { code: '9812', d1: '150mm (6")', d2: '100mm (4")', label: '9812: 150mm (6") x 100mm (4")' },
        { code: 'A812', d1: '200mm (8")', d2: '100mm (4")', label: 'A812: 200mm (8") x 100mm (4")' },
        { code: 'A912', d1: '200mm (8")', d2: '150mm (6")', label: 'A912: 200mm (8") x 150mm (6")' }
    ],
    'standard': [
        { d1: '20mm (3/4")', label: '20mm (3/4")' },
        { d1: '25mm (1")', label: '25mm (1")' },
        { d1: '40mm (1 1/2")', label: '40mm (1 1/2")' },
        { d1: '50mm (2")', label: '50mm (2")' },
        { d1: '63mm (2 1/2")', label: '63mm (2 1/2")' },
        { d1: '80mm (3")', label: '80mm (3")' },
        { d1: '100mm (4")', label: '100mm (4")' },
        { d1: '150mm (6")', label: '150mm (6")' },
        { d1: '200mm (8")', label: '200mm (8")' }
    ]
};

let currentFileName = '';
let currentMeasureColor = '#06b6d4';
let currentUnit = 'mm';

// ─── Cople Array State ───
export const virtualCouplings = [];

// ─── Piping Symbols State ───
const pipingSymbols = []; // { type, dxfX, dxfY, angle, selected }
let selectedSymbolIndex = -1;
let symDragging = false;
let symDragLastX = 0, symDragLastY = 0;
let clipboardSymbol = null;

// Global recent colors shared across all files
let recentColors = ['#06b6d4', '#ef4444', '#f59e0b', '#10b981', '#8b5cf6'];
try {
    const savedColors = localStorage.getItem('dxf_global_recent_colors');
    if (savedColors) {
        recentColors = JSON.parse(savedColors);
    }
} catch (e) { console.warn(e); }

// Clear clipboard when clicking any tool button so it doesn't interfere with new fresh symbols
document.querySelectorAll('.tool-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        clipboardSymbol = null;
    });
});

// ─── BOM State ───
let bomData = null;

// ─── Setup Canvas ───
function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    if (dxfData) drawDxf();
    resizeAnnotations(container.clientWidth, container.clientHeight);
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();
setupAnnotations();
setToolChangeCallback((tool) => {
    currentTool = tool;
    const container = document.getElementById('canvas-container');
    const infoCople = document.getElementById('info-cople');
    
    if (tool === 'measure' || tool === 'line') {
        container.classList.add('measure-mode');
    } else {
        container.classList.remove('measure-mode');
    }
    
    const infoSum = document.getElementById('info-sum');
    
    if (tool === 'cople' || tool === 'delete' || tool === 'sum' || (tool.startsWith('sym-') && tool !== 'sym-move') || tool === 'line') {
        container.classList.add('measure-mode'); // Use crosshair
        if (tool === 'cople' && infoCople) infoCople.style.display = 'flex';
        else if (infoCople) infoCople.style.display = 'none';
        
        if (tool === 'sum' && infoSum) infoSum.style.display = 'flex';
        else if (infoSum) infoSum.style.display = 'none';
    } else {
        if (infoCople) infoCople.style.display = 'none';
        if (infoSum) infoSum.style.display = 'none';
    }
    
    // Clear selection when not in sum mode
    if (tool !== 'sum') {
        measurements.forEach(m => m.selected = false);
        updateSumDisplay();
        drawDxf();
    }
});

// ─── File Upload ───
dxfInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    currentFileName = file.name;
    loading.classList.remove('hidden');

    const reader = new FileReader();
    reader.onload = (event) => {
        const buffer = event.target.result;
        rawDxfBytes = new Uint8Array(buffer);
        
        // Convert to 1-to-1 string without corrupting binary data for export
        const CHUNK_SIZE = 0x8000;
        const chars = [];
        for (let i = 0; i < rawDxfBytes.length; i += CHUNK_SIZE) {
            chars.push(String.fromCharCode.apply(null, rawDxfBytes.subarray(i, i + CHUNK_SIZE)));
        }
        rawDxfContent = chars.join('');
        
        // Decode text for the DXF Parser (preserves accents)
        const parserContent = new TextDecoder('windows-1252').decode(rawDxfBytes);
        const parser = new DxfParser();
        
        // Monkey-patch ATTRIB and ATTDEF support
        if (parser._entityHandlers && parser._entityHandlers['TEXT']) {
            parser._entityHandlers['ATTRIB'] = {
                ForEntityName: 'ATTRIB',
                parseEntity: function(scanner, curr) {
                    const ent = parser._entityHandlers['TEXT'].parseEntity(scanner, curr);
                    ent.type = 'ATTRIB';
                    return ent;
                }
            };
            parser._entityHandlers['ATTDEF'] = {
                ForEntityName: 'ATTDEF',
                parseEntity: function(scanner, curr) {
                    const ent = parser._entityHandlers['TEXT'].parseEntity(scanner, curr);
                    ent.type = 'ATTDEF';
                    return ent;
                }
            };
        }

        try {
            dxfData = parser.parseSync(parserContent);
            console.log('DXF Parsed:', dxfData);
            fitToScreen();
            
            // Detect and set units
            currentUnit = detectUnits();
            const unitSelect = document.getElementById('unit-select');
            if (unitSelect) unitSelect.value = currentUnit;
            updateCouplingDefault();
            
            // Reset state
            measurements = [];
            customLines = [];
            virtualCouplings.length = 0;
            measurePending = null;
            linePending = null;
            bomData = null;
            
            // Try to load saved annotations for this file
            loadAnnotations();
            
            drawDxf();
        } catch (err) {
            console.error('Error parsing DXF', err);
            alert('Error al leer el archivo DXF.');
        } finally {
            loading.classList.add('hidden');
        }
    };
    reader.readAsArrayBuffer(file);
});

// ─── DXF Export Logic ───
document.getElementById('btn-export-dxf').addEventListener('click', () => {
    if (!rawDxfContent) {
        alert('Por favor, carga un archivo DXF primero.');
        return;
    }
    exportToDxf();
});

// (dxfHandleCounter is now managed inside buildDxfEntityHelpers per-export)

function hexToAci(hex) {
    if (!hex) return 7;
    hex = hex.toLowerCase();
    if (hex.includes('06b6d4')) return 4;
    if (hex.includes('ef4444')) return 1;
    if (hex.includes('f59e0b')) return 40;
    if (hex.includes('10b981')) return 3;
    if (hex.includes('8b5cf6')) return 200;
    if (hex.startsWith('#')) {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        if (r>200 && g<100 && b<100) return 1;
        if (r>200 && g>200 && b<100) return 2;
        if (r<100 && g>200 && b<100) return 3;
        if (r<100 && g>200 && b>200) return 4;
        if (r<100 && g<100 && b>200) return 5;
        if (r>200 && g<100 && b>200) return 6;
    }
    return 7;
}

// ─── DXF Export Engine (rewritten) ───────────────────────────────────────────

/**
 * Sample a quadratic Bezier (M, Q) into N line segments, returning intermediate DXF-space points.
 * p0=start, p1=control, p2=end — all in canvas pixels.
 */
function sampleQuadBezier(p0, p1, p2, steps = 12) {
    const pts = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x;
        const y = mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y;
        pts.push({ x, y });
    }
    return pts;
}

/**
 * Sample a cubic Bezier (C) into N line segments.
 * p0=start, p1=control1, p2=control2, p3=end — all in canvas pixels.
 */
function sampleCubicBezier(p0, p1, p2, p3, steps = 12) {
    const pts = [];
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const mt = 1 - t;
        const x = mt*mt*mt*p0.x + 3*mt*mt*t*p1.x + 3*mt*t*t*p2.x + t*t*t*p3.x;
        const y = mt*mt*mt*p0.y + 3*mt*mt*t*p1.y + 3*mt*t*t*p2.y + t*t*t*p3.y;
        pts.push({ x, y });
    }
    return pts;
}

// Detect DXF format version and line endings from raw content, then build entities accordingly
function buildDxfEntityHelpers() {
    const nl = rawDxfContent.includes('\r\n') ? '\r\n' : '\n';

    const verMatch = rawDxfContent.match(/\$ACADVER[\s\S]{1,50}?(AC10[0-9]{2})/);
    const ver = verMatch ? verMatch[1] : 'AC1015';
    const modern = ver >= 'AC1015';

    // Find the *Model_Space BLOCK_RECORD handle (group 5 appears BEFORE group 2 in DXF).
    let modelSpaceHandle = null;
    const modelSpaceMatch = rawDxfContent.match(/  0\r?\nBLOCK_RECORD\r?\n  5\r?\n([0-9A-Fa-f]+)[\s\S]{1,400}?  2\r?\n\*Model_Space/i);
    if (modelSpaceMatch) {
        modelSpaceHandle = modelSpaceMatch[1];
    } else {
        const fallbackMatch = rawDxfContent.match(/  5\r?\n([0-9A-Fa-f]+)[\s\S]{1,400}?  2\r?\n\*Model_Space/i);
        if (fallbackMatch) modelSpaceHandle = fallbackMatch[1];
    }

    // Parse $HANDSEED so new handles never collide with existing ones.
    const handseedMatch = rawDxfContent.match(/\$HANDSEED[\s\r\n]+5[\s\r\n]+([0-9A-Fa-f]+)/);
    let currentHandleSeed = handseedMatch ? parseInt(handseedMatch[1], 16) : 0xF00000;

    function getNextDxfHandle() {
        const h = currentHandleSeed.toString(16).toUpperCase();
        currentHandleSeed++;
        return h;
    }

    function getUpdatedHandseedString() {
        if (!handseedMatch) return null;
        return {
            oldStr: handseedMatch[0],
            newStr: handseedMatch[0].replace(handseedMatch[1], currentHandleSeed.toString(16).toUpperCase())
        };
    }

    /**
     * Emit a DXF LINE entity with strictly correct group-code formatting.
     * Group codes 0-9 → 1 space prefix; 10-99 → 1 space prefix; 100-999 → no prefix.
     * We follow the AutoCAD convention: "  0\n" for type codes and "  5\n" for handle.
     */
    function dxfLine(x1, y1, x2, y2, colorHex) {
        if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return '';
        if (!isFinite(x1) || !isFinite(y1) || !isFinite(x2) || !isFinite(y2)) return '';
        const c = hexToAci(colorHex);
        const h = getNextDxfHandle();

        let s = '';
        s += `  0${nl}LINE${nl}`;
        s += `  5${nl}${h}${nl}`;
        if (modern && modelSpaceHandle) s += `330${nl}${modelSpaceHandle}${nl}`;
        if (modern) s += `100${nl}AcDbEntity${nl}`;
        s += `  8${nl}ANOTACIONES${nl}`;        // named layer so CAD user can toggle
        s += ` 62${nl}     ${c}${nl}`;         // ACI color
        if (modern) s += `100${nl}AcDbLine${nl}`;
        s += ` 10${nl}${x1.toFixed(6)}${nl}`;
        s += ` 20${nl}${y1.toFixed(6)}${nl}`;
        s += ` 30${nl}0.0${nl}`;
        s += ` 11${nl}${x2.toFixed(6)}${nl}`;
        s += ` 21${nl}${y2.toFixed(6)}${nl}`;
        s += ` 31${nl}0.0${nl}`;
        return s;
    }

    /**
     * Emit a DXF TEXT entity.
     * angle is in RADIANS (internal) — converted to degrees for DXF group 50.
     */
    function dxfText(text, x, y, height, colorHex, angleRad = 0) {
        if (isNaN(x) || isNaN(y) || isNaN(height) || !text) return '';
        if (!isFinite(x) || !isFinite(y)) return '';
        // Strip characters that break DXF text (newlines, null, curly braces)
        const safeTxt = text.replace(/[\r\n\x00{}]/g, ' ').replace(/\\[^;]*;/g, '').trim();
        if (!safeTxt) return '';

        const c = hexToAci(colorHex);
        const h = getNextDxfHandle();
        const deg = (angleRad * 180 / Math.PI).toFixed(6);

        let s = '';
        s += `  0${nl}TEXT${nl}`;
        s += `  5${nl}${h}${nl}`;
        if (modern && modelSpaceHandle) s += `330${nl}${modelSpaceHandle}${nl}`;
        if (modern) s += `100${nl}AcDbEntity${nl}`;
        s += `  8${nl}ANOTACIONES${nl}`;
        s += ` 62${nl}     ${c}${nl}`;
        if (modern) s += `100${nl}AcDbText${nl}`;
        s += ` 10${nl}${x.toFixed(6)}${nl}`;
        s += ` 20${nl}${y.toFixed(6)}${nl}`;
        s += ` 30${nl}0.0${nl}`;
        s += ` 40${nl}${height.toFixed(6)}${nl}`;
        s += `  1${nl}${safeTxt}${nl}`;
        const degF = parseFloat(deg);
        if (Math.abs(degF) > 0.001) s += ` 50${nl}${deg}${nl}`;
        if (modern) s += `100${nl}AcDbText${nl}`; // second AcDbText subclass marker required by AC1015+
        return s;
    }

    return { dxfLine, dxfText, nl, getUpdatedHandseedString };
}

function rotatePt(cx, cy, px, py, angleRad) {
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return {
        x: cos * (px - cx) - sin * (py - cy) + cx,
        y: sin * (px - cx) + cos * (py - cy) + cy
    };
}

export function generateModifiedDxfBlob() {
    const helpers = buildDxfEntityHelpers();
    const { dxfLine, dxfText } = helpers;
    let customEntities = '';

    // ── 1. Fabric.js annotations (Freehand paths, Rectangles, Text) ──────────
    const fabricObjs = getFabricObjects();
    for (const obj of fabricObjs) {
        const color = obj.stroke || obj.fill || '#06b6d4';

        if (obj.type === 'path') {
            // FIX: Fabric path coords are in canvas-local space after applying the
            // object's transform matrix.  We must NOT call screenToDxf (which subtracts
            // the HTML element's bounding rect).  Instead we use canvasToDxf directly.
            if (obj.path && obj.path.length > 0) {
                const mtx = obj.calcTransformMatrix();
                let lastCanvasPt = null;   // last point in canvas pixel space
                let lastDxfPt    = null;

                for (let pi = 0; pi < obj.path.length; pi++) {
                    const p = obj.path[pi];
                    const cmd = p[0];

                    if (cmd === 'M' || cmd === 'L') {
                        const abs = fabric.util.transformPoint({ x: p[1], y: p[2] }, mtx);
                        const dpt = canvasToDxf(abs.x, abs.y);
                        if (cmd === 'L' && lastDxfPt) {
                            customEntities += dxfLine(lastDxfPt.x, lastDxfPt.y, dpt.x, dpt.y, color);
                        }
                        lastCanvasPt = { x: p[1], y: p[2] };
                        lastDxfPt = dpt;

                    } else if (cmd === 'Q') {
                        // Quadratic Bezier: p = ['Q', cpx, cpy, x, y]
                        // FIX: tessellate instead of using only endpoint
                        const p0abs = fabric.util.transformPoint(
                            lastCanvasPt || { x: p[3], y: p[4] }, mtx);
                        const p1abs = fabric.util.transformPoint({ x: p[1], y: p[2] }, mtx); // control
                        const p2abs = fabric.util.transformPoint({ x: p[3], y: p[4] }, mtx); // end
                        const samples = sampleQuadBezier(p0abs, p1abs, p2abs, 8);
                        let prev = lastDxfPt || canvasToDxf(p0abs.x, p0abs.y);
                        for (const sp of samples) {
                            const dpt = canvasToDxf(sp.x, sp.y);
                            customEntities += dxfLine(prev.x, prev.y, dpt.x, dpt.y, color);
                            prev = dpt;
                        }
                        lastCanvasPt = { x: p[3], y: p[4] };
                        lastDxfPt = prev;

                    } else if (cmd === 'C') {
                        // Cubic Bezier: p = ['C', cp1x, cp1y, cp2x, cp2y, x, y]
                        // FIX: was completely ignored before
                        const p0abs = fabric.util.transformPoint(
                            lastCanvasPt || { x: p[5], y: p[6] }, mtx);
                        const p1abs = fabric.util.transformPoint({ x: p[1], y: p[2] }, mtx);
                        const p2abs = fabric.util.transformPoint({ x: p[3], y: p[4] }, mtx);
                        const p3abs = fabric.util.transformPoint({ x: p[5], y: p[6] }, mtx);
                        const samples = sampleCubicBezier(p0abs, p1abs, p2abs, p3abs, 10);
                        let prev = lastDxfPt || canvasToDxf(p0abs.x, p0abs.y);
                        for (const sp of samples) {
                            const dpt = canvasToDxf(sp.x, sp.y);
                            customEntities += dxfLine(prev.x, prev.y, dpt.x, dpt.y, color);
                            prev = dpt;
                        }
                        lastCanvasPt = { x: p[5], y: p[6] };
                        lastDxfPt = prev;
                    }
                }
            }

        } else if (obj.type === 'rect') {
            // FIX: aCoords gives canvas-pixel positions, not screen positions.
            // Use canvasToDxf directly (not screenToDxf which subtracts elem offset).
            const ac = obj.aCoords;
            const tl = canvasToDxf(ac.tl.x, ac.tl.y);
            const tr = canvasToDxf(ac.tr.x, ac.tr.y);
            const br = canvasToDxf(ac.br.x, ac.br.y);
            const bl = canvasToDxf(ac.bl.x, ac.bl.y);
            customEntities += dxfLine(tl.x, tl.y, tr.x, tr.y, color);
            customEntities += dxfLine(tr.x, tr.y, br.x, br.y, color);
            customEntities += dxfLine(br.x, br.y, bl.x, bl.y, color);
            customEntities += dxfLine(bl.x, bl.y, tl.x, tl.y, color);

        } else if (obj.type === 'i-text' || obj.type === 'text') {
            // FIX: getCenterPoint() returns canvas-local coords — use canvasToDxf.
            const center  = obj.getCenterPoint();
            const pt      = canvasToDxf(center.x, center.y);
            const dxfH    = Math.max(0.5, (obj.fontSize * obj.scaleY) / viewState.scale);
            // FIX: Fabric angle is in DEGREES; convert to radians for rotatePt and dxfText.
            const radAngle = -(obj.angle || 0) * Math.PI / 180;
            const textW    = (obj.text ? obj.text.length : 4) * dxfH * 0.6;
            const pStart   = rotatePt(pt.x, pt.y, pt.x - textW / 2, pt.y - dxfH / 2, radAngle);
            customEntities += dxfText(obj.text, pStart.x, pStart.y, dxfH, color, radAngle);
        }
    }

    // ── 2. Measurements ──────────────────────────────────────────────────────
    for (const m of measurements) {
        customEntities += dxfLine(m.p1.x, m.p1.y, m.p2.x, m.p2.y, m.color);
        const midX = (m.p1.x + m.p2.x) / 2;
        const midY = (m.p1.y + m.p2.y) / 2;

        // Text height = 1% of measurement distance (was 4%), with minimum 0.5 drawing units.
        const dxfFontSize = Math.max(m.distance * 0.01, 0.5);
        const textStr  = m.distance.toFixed(2);
        const textW    = textStr.length * dxfFontSize * 0.6;
        customEntities += dxfText(textStr, midX - textW / 2, midY + dxfFontSize * 0.6,
                                  dxfFontSize, m.color, 0);
    }

    // ── 3. Couplings ─────────────────────────────────────────────────────────
    // Coupling size expressed in DXF drawing units.
    // We estimate a "drawing unit size" from the bounding box so couplings look
    // proportional regardless of whether the drawing is in mm or meters.
    let drawingScale = 1;
    if (dxfData && dxfData.entities) {
        let minX = Infinity, maxX = -Infinity;
        for (const ent of dxfData.entities) {
            const pts = getEntityPoints(ent);
            for (const p of pts) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
            }
        }
        if (isFinite(minX) && isFinite(maxX) && maxX > minX) {
            // Dividing by 8000 gives a small proportional unit suitable for
            // typical mm-scale piping drawings (coords in the 5000-15000 range).
            drawingScale = (maxX - minX) / 8000;
        }
    }
    const cHalf  = Math.max(drawingScale * 1.5, 0.3);  // half-width of coupling rectangle
    const cHalfH = Math.max(drawingScale * 0.6, 0.1); // half-height

    for (const c of virtualCouplings) {
        const cx = c.x, cy = c.y;
        const color = c.color || document.getElementById('cople-color-picker')?.value || '#ef4444';
        const a = c.angle || 0; // already in radians (set by Math.atan2 in handleCopleClick)
        const p1 = rotatePt(cx, cy, cx - cHalf, cy - cHalfH, a);
        const p2 = rotatePt(cx, cy, cx + cHalf, cy - cHalfH, a);
        const p3 = rotatePt(cx, cy, cx + cHalf, cy + cHalfH, a);
        const p4 = rotatePt(cx, cy, cx - cHalf, cy + cHalfH, a);
        customEntities += dxfLine(p1.x, p1.y, p2.x, p2.y, color);
        customEntities += dxfLine(p2.x, p2.y, p3.x, p3.y, color);
        customEntities += dxfLine(p3.x, p3.y, p4.x, p4.y, color);
        customEntities += dxfLine(p4.x, p4.y, p1.x, p1.y, color);
    }

    // ── 4. Piping Symbols ────────────────────────────────────────────────────
    // Symbol size in DXF drawing units. Multiplier 2 keeps symbols small but visible.
    const sSize = Math.max(drawingScale * 2, 0.3);

    for (const sym of pipingSymbols) {
        const cx = sym.dxfX, cy = sym.dxfY;
        const color  = sym.color || '#06b6d4';
        // FIX: sym.angle is stored in RADIANS (see keydown 'R' handler: += Math.PI/4).
        // dxfAngle negates because DXF Y-axis is upward (opposite to canvas).
        const a = sym.angle || 0;   // radians
        const dxfAngle = -a;        // flip for DXF coordinate system

        const drawSeg = (x1, y1, x2, y2) => {
            const pa = rotatePt(cx, cy, cx + x1, cy + y1, dxfAngle);
            const pb = rotatePt(cx, cy, cx + x2, cy + y2, dxfAngle);
            customEntities += dxfLine(pa.x, pa.y, pb.x, pb.y, color);
        };

        if (sym.type === 'tee') {
            drawSeg(-sSize, 0,  sSize, 0);
            drawSeg(0, 0,  0, -sSize);
        } else if (sym.type === 'tee-lat') {
            drawSeg(-sSize, 0,  sSize, 0); // main straight
            // 45 degree lateral branch
            const d = sSize * 0.7071; // sin(45)*sSize
            drawSeg(0, 0, d, -d);
        } else if (sym.type === 'codo') {
            drawSeg(-sSize, 0,  0, 0);
            drawSeg(0, 0,  0, -sSize);
        } else if (sym.type === 'reductor') {
            drawSeg(-sSize, -sSize * 0.6,  sSize, -sSize * 0.35);
            drawSeg( sSize, -sSize * 0.35, sSize,  sSize * 0.35);
            drawSeg( sSize,  sSize * 0.35, -sSize, sSize * 0.6);
            drawSeg(-sSize,  sSize * 0.6, -sSize, -sSize * 0.6);
        } else if (sym.type === 'brida') {
            drawSeg(-sSize * 0.25, -sSize, -sSize * 0.25, sSize);
            drawSeg( sSize * 0.25, -sSize,  sSize * 0.25, sSize);
        } else if (sym.type === 'tapon') {
            drawSeg(-sSize, 0,  0, 0);
            drawSeg(0, -sSize * 0.7, 0, sSize * 0.7);
        }

        // Label
        let label = '';
        if (sym.type === 'tapon') label = 'Tapón';
        else if (sym.type === 'tee-lat') label = 'Tee Lat';
        else label = sym.type.charAt(0).toUpperCase() + sym.type.slice(1);
        
        // Use part code if available, else d1xd2
        if (sym.code) label += ` ${sym.code}`;
        else if (sym.d1 && sym.d2) label += ` ${sym.d1}x${sym.d2}`;
        else if (sym.d1) label += ` ${sym.d1}`;
        else if (sym.d2) label += ` ${sym.d2}`;

        const txtH  = sSize * 0.7;
        const txtW  = label.length * txtH * 0.6;
        const pL    = rotatePt(cx, cy, cx - txtW / 2, cy + sSize * 1.4, dxfAngle);
        customEntities += dxfText(label, pL.x, pL.y, txtH, color, dxfAngle);
    }

    // ── 5. Inject entities before ENDSEC of the ENTITIES section ─────────────
    const nl = helpers.nl;
    const objectsHeader = rawDxfContent.match(/  0\r?\nSECTION\r?\n  2\r?\nOBJECTS/i);
    let injectionIndex = -1;

    if (objectsHeader) {
        const antesDeObjects = rawDxfContent.substring(0, objectsHeader.index);
        const pat1 = `  0${nl}ENDSEC`;
        let idx = antesDeObjects.lastIndexOf(pat1);
        if (idx === -1) idx = antesDeObjects.lastIndexOf(`0${nl}ENDSEC`);
        if (idx !== -1) injectionIndex = idx;
    }

    if (injectionIndex === -1) {
        const entHeader = rawDxfContent.match(/  0\r?\nSECTION\r?\n  2\r?\nENTITIES/i);
        if (!entHeader) {
            alert('No se pudo encontrar la sección ENTITIES en el archivo original.');
            return null;
        }
        const start = entHeader.index + entHeader[0].length;
        const sub   = rawDxfContent.substring(start);
        let pat = `  0${nl}ENDSEC`;
        let mi  = sub.indexOf(pat);
        if (mi === -1) { pat = `0${nl}ENDSEC`; mi = sub.indexOf(pat); }
        if (mi === -1) {
            alert('No se pudo encontrar el fin de la sección ENTITIES.');
            return null;
        }
        injectionIndex = start + mi;
    }

    let remainder = rawDxfContent.substring(injectionIndex);
    if (!remainder.includes('EOF')) {
        console.warn('Sección remanente sin EOF — agregando cierre de emergencia.');
        remainder += `${nl}  0${nl}ENDSEC${nl}  0${nl}EOF${nl}`;
    }

    let finalStr = rawDxfContent.substring(0, injectionIndex)
                 + customEntities
                 + remainder;

    // Update $HANDSEED
    const hsUpdate = helpers.getUpdatedHandseedString();
    if (hsUpdate) {
        finalStr = finalStr.replace(hsUpdate.oldStr, hsUpdate.newStr);
    }

    // FIX: Use TextEncoder (UTF-8) instead of charCodeAt & 0xFF.
    // Most modern CAD tools handle UTF-8 DXF (AC1021 / R2007+).  For older
    // files (AC1009–AC1014) which are strictly latin-1, we fall back to latin1.
    const verMatch2 = rawDxfContent.match(/\$ACADVER[\s\S]{1,50}?(AC10[0-9]{2})/);
    const fileVer   = verMatch2 ? verMatch2[1] : 'AC1015';
    let buffer;
    if (fileVer >= 'AC1021') {
        // R2007+ — encode as UTF-8
        buffer = new TextEncoder().encode(finalStr);
    } else {
        // Older format — encode as latin-1 (truncate high bytes)
        buffer = new Uint8Array(finalStr.length);
        for (let i = 0; i < finalStr.length; i++) {
            buffer[i] = finalStr.charCodeAt(i) & 0xFF;
        }
    }

    return new Blob([buffer], { type: 'application/dxf' });
}
window.generateModifiedDxfBlob = generateModifiedDxfBlob;

export function exportToDxf() {
    const blob = generateModifiedDxfBlob();
    if (!blob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    const safeName = (window._currentFileName || currentFileName || 'plano').replace(/\.dxf$/i, '');
    link.download = `${safeName}_modificado.dxf`;
    link.click();
}

// ─── Coordinate Transforms ───
export function screenToDxf(screenX, screenY) {
    const rect = canvas.getBoundingClientRect();
    const cx = screenX - rect.left;
    const cy = screenY - rect.top;
    return canvasToDxf(cx, cy);
}
window.screenToDxf = screenToDxf;

export function canvasToDxf(cx, cy) {
    const dxfX = (cx - viewState.x) / viewState.scale;
    const dxfY = -(cy - viewState.y) / viewState.scale;  // Y is inverted
    return { x: dxfX, y: dxfY };
}
window.canvasToDxf = canvasToDxf;

export function dxfToScreen(dxfX, dxfY) {
    const sx = dxfX * viewState.scale + viewState.x;
    const sy = -dxfY * viewState.scale + viewState.y;
    return { x: sx, y: sy };
}
window.dxfToScreen = dxfToScreen;

// ─── Fit to Screen ───
function fitToScreen() {
    if (!dxfData || !dxfData.entities || dxfData.entities.length === 0) return;
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    
    for (const ent of dxfData.entities) {
        const points = getEntityPoints(ent);
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        }
    }

    if (minX === Infinity) { minX = 0; minY = 0; maxX = 1000; maxY = 1000; }

    const width = maxX - minX;
    const height = maxY - minY;
    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    
    viewState.scale = Math.min(scaleX, scaleY) * 0.9;
    
    const centerX = minX + width / 2;
    const centerY = minY + height / 2;
    viewState.x = canvas.width / 2 - centerX * viewState.scale;
    viewState.y = canvas.height / 2 + centerY * viewState.scale;
}

function getEntityPoints(ent) {
    const pts = [];
    if (ent.vertices) {
        for (const v of ent.vertices) pts.push(v);
    }
    if (ent.center) pts.push(ent.center);
    if (ent.startPoint) pts.push(ent.startPoint);
    if (ent.position) pts.push(ent.position);
    if (ent.endPoint) pts.push(ent.endPoint);
    return pts;
}

// ─── Render Pipeline Optimization ───
let renderPending = false;
export function requestDrawDxf() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
            drawDxf();
            renderPending = false;
        });
    }
}

export function forceDrawDxf() {
    drawDxf();
}
window.forceDrawDxf = forceDrawDxf;

// ─── Drawing ───
function drawDxf() {
    if (!dxfData) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    ctx.translate(viewState.x, viewState.y);
    ctx.scale(viewState.scale, -viewState.scale);
    const exportScale = window.exportScaleFactor || 1;
    // Hacer la línea proporcional al exportar en alta resolución para que no desaparezca
    ctx.lineWidth = exportScale / viewState.scale;
    
    for (const ent of dxfData.entities) {
        ctx.strokeStyle = getEntityColor(ent);
        drawEntity(ent);
    }
    
    ctx.restore();
    
    // Draw overlays (in screen coords)
    drawCouplings();
    drawCustomLines();
    drawSymbols();
    drawMeasurements();
    drawSymbols();
    drawSnapIndicator();
    
    // Sync Fabric.js canvas (for draw/rect/text tools)
    if (window.syncFabricSymbols) {
        window.syncFabricSymbols(viewState.scale);
    }
    
    // Update zoom display
    const zoomEl = document.getElementById('zoom-level');
    if (zoomEl) zoomEl.textContent = Math.round(viewState.scale * 100) + '%';
}

// ─── Draw Entity ───
function drawEntity(entity) {
    ctx.beginPath();
    if (entity.type === 'LINE') {
        if (!entity.vertices || entity.vertices.length < 2) return;
        ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
        ctx.lineTo(entity.vertices[1].x, entity.vertices[1].y);
    } else if (entity.type === 'LWPOLYLINE' || entity.type === 'POLYLINE') {
        if (!entity.vertices || entity.vertices.length === 0) return;
        ctx.moveTo(entity.vertices[0].x, entity.vertices[0].y);
        for (let i = 1; i < entity.vertices.length; i++) {
            ctx.lineTo(entity.vertices[i].x, entity.vertices[i].y);
        }
        if (entity.shape) ctx.closePath();
    } else if (entity.type === 'CIRCLE') {
        const cx = entity.center ? entity.center.x : (entity.x || 0);
        const cy = entity.center ? entity.center.y : (entity.y || 0);
        const r = entity.radius || entity.r || 0;
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
    } else if (entity.type === 'ARC') {
        const cx = entity.center ? entity.center.x : (entity.x || 0);
        const cy = entity.center ? entity.center.y : (entity.y || 0);
        const r = entity.radius || entity.r || 0;
        ctx.arc(cx, cy, r, entity.startAngle || 0, entity.endAngle || 0);
    } else if (entity.type === 'ELLIPSE') {
        if (entity.center && entity.majorAxisEndPoint) {
            const cx = entity.center.x;
            const cy = entity.center.y;
            const mx = entity.majorAxisEndPoint.x;
            const my = entity.majorAxisEndPoint.y;
            const majorR = Math.sqrt(mx * mx + my * my);
            const minorR = majorR * (entity.axisRatio || 1);
            const rotation = Math.atan2(my, mx);
            ctx.ellipse(cx, cy, majorR, minorR, rotation, entity.startAngle || 0, entity.endAngle || Math.PI * 2);
        }
    } else if (entity.type === 'SPLINE') {
        const pts = entity.controlPoints || entity.fitPoints || entity.vertices;
        if (pts && pts.length > 0) {
            ctx.moveTo(pts[0].x, pts[0].y);
            for (let i = 1; i < pts.length; i++) {
                ctx.lineTo(pts[i].x, pts[i].y);
            }
        }
    } else if (entity.type === 'SOLID' || entity.type === '3DFACE') {
        const pts = entity.points || entity.vertices || [];
        if (pts.length >= 3) {
            ctx.beginPath();
            ctx.moveTo(pts[0].x, pts[0].y);
            ctx.lineTo(pts[1].x, pts[1].y);
            if (pts.length === 4) {
                ctx.lineTo(pts[3].x, pts[3].y);
                ctx.lineTo(pts[2].x, pts[2].y);
            } else {
                ctx.lineTo(pts[2].x, pts[2].y);
            }
            ctx.closePath();
            ctx.fillStyle = ctx.strokeStyle;
            ctx.fill();
        }
    } else if (entity.type === 'TEXT' || entity.type === 'MTEXT' || entity.type === 'ATTRIB' || entity.type === 'ATTDEF') {
        ctx.save();
        
        const alignPt = (entity.halign && entity.halign > 0 && entity.endPoint) ? entity.endPoint : 
                        (entity.startPoint || entity.position || entity);
        const x = alignPt.x || 0;
        const y = alignPt.y || 0;
        
        ctx.translate(x, y);
        if (entity.rotation) {
            ctx.rotate(entity.rotation * Math.PI / 180);
        }
        
        if (entity.halign === 1 || entity.halign === 4) {
            ctx.textAlign = 'center';
        } else if (entity.halign === 2 || entity.halign === 5) {
            ctx.textAlign = 'right';
        } else {
            ctx.textAlign = 'left';
        }
        
        let height = entity.textHeight || entity.height || 12;
        if (height === 0) height = 12;
        
        const FONT_SCALE = 100;
        ctx.scale(1 / FONT_SCALE, -1 / FONT_SCALE);
        
        ctx.font = `${height * FONT_SCALE}px "Inter", sans-serif`;
        ctx.fillStyle = ctx.strokeStyle;
        let txt = entity.text || entity.tag || '';
        
        txt = txt.replace(/\\S(.*?)[#^](.*?);/g, '$1/$2');
        txt = txt.replace(/\\[^;]+;/g, '');
        txt = txt.replace(/\\P/g, ' ');
        txt = txt.replace(/[{}]/g, ''); 
        txt = txt.replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');
        
        ctx.fillText(txt, 0, 0);
        ctx.restore();
    } else if (entity.type === 'INSERT') {
        let block = dxfData.blocks ? dxfData.blocks[entity.name] : null;
        if (!block && dxfData.blocks && entity.name) {
            const lowerName = entity.name.toLowerCase();
            for (const key in dxfData.blocks) {
                if (key.toLowerCase() === lowerName) {
                    block = dxfData.blocks[key];
                    break;
                }
            }
        }
        if (block && block.entities) {
            ctx.save();
            const ix = entity.position ? entity.position.x : (entity.x || 0);
            const iy = entity.position ? entity.position.y : (entity.y || 0);
            ctx.translate(ix, iy);
            if (entity.rotation) {
                ctx.rotate(entity.rotation * Math.PI / 180);
            }
            const sx = entity.xScale !== undefined ? entity.xScale : (entity.scaleX !== undefined ? entity.scaleX : 1);
            const sy = entity.yScale !== undefined ? entity.yScale : (entity.scaleY !== undefined ? entity.scaleY : 1);
            ctx.scale(sx, sy);
            
            for (const ent of block.entities) {
                const prevColor = ctx.strokeStyle;
                ctx.strokeStyle = (ent.colorIndex === 0 || ent.colorIndex === 256 || ent.colorIndex === undefined) 
                                   ? prevColor 
                                   : getEntityColor(ent);
                drawEntity(ent);
                ctx.strokeStyle = prevColor;
            }
            ctx.restore();
        }
    } else if (entity.type === 'DIMENSION') {
        const block = dxfData.blocks ? dxfData.blocks[entity.block] : null;
        if (block && block.entities) {
            ctx.save();
            for (const ent of block.entities) {
                const prevColor = ctx.strokeStyle;
                ctx.strokeStyle = (ent.colorIndex === 0 || ent.colorIndex === 256 || ent.colorIndex === undefined) 
                                   ? getEntityColor(entity)
                                   : getEntityColor(ent);
                drawEntity(ent);
                ctx.strokeStyle = prevColor;
            }
            ctx.restore();
        }
    } else if (entity.type === 'POINT') {
        const x = entity.position ? entity.position.x : (entity.x || 0);
        const y = entity.position ? entity.position.y : (entity.y || 0);
        ctx.beginPath();
        ctx.arc(x, y, 1, 0, Math.PI * 2);
        ctx.fill();
    }
    
    if (entity.type !== 'TEXT' && entity.type !== 'MTEXT' && entity.type !== 'ATTRIB' && entity.type !== 'ATTDEF' 
        && entity.type !== 'INSERT' && entity.type !== 'DIMENSION'
        && entity.type !== 'SOLID' && entity.type !== '3DFACE' && entity.type !== 'POINT') {
        ctx.stroke();
    }
}

// ─── Colors ───
function getEntityColor(entity) {
    let colorInt = entity.color;
    
    if (colorInt === undefined || entity.colorIndex === 256 || entity.colorIndex === 0) {
        if (dxfData.tables && dxfData.tables.layer && dxfData.tables.layer.layers) {
            const layer = dxfData.tables.layer.layers[entity.layer];
            if (layer && layer.color !== undefined) {
                colorInt = layer.color;
            }
        }
    }
    
    if (colorInt !== undefined) {
        let hex = colorInt.toString(16).padStart(6, '0');
        return hex === 'ffffff' ? '#f3f4f6' : '#' + hex;
    }
    
    return '#f3f4f6';
}

// ══════════════════════════════════════════════════
//  MEASUREMENT TOOL
// ══════════════════════════════════════════════════

function drawMeasurements() {
    if (measurements.length === 0 && !measurePending) return;
    
    ctx.save();
    
    const lineWidth = 2;
    const fontSize = 14;
    const crossSize = 8;
    
    // Draw completed measurements
    for (const m of measurements) {
        const p1 = dxfToScreen(m.p1.x, m.p1.y);
        const p2 = dxfToScreen(m.p2.x, m.p2.y);
        
        const screenDist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
        
        // Hide measurement if it's too small on screen
        if (screenDist < 15) continue;
        
        // Scale font and lines dynamically to avoid clutter when zoomed out
        const scaleFactor = Math.min(1, screenDist / 80); // 80px screen length is "full size"
        
        const exportScale = window.exportScaleFactor || 1;
        const dFontSize = Math.max(8, 14 * scaleFactor) * exportScale;
        const dCrossSize = Math.max(3, 8 * scaleFactor) * exportScale;
        const dLineWidth = Math.max(1, 2 * scaleFactor) * exportScale;
        const dPad = Math.max(2, 6 * scaleFactor) * exportScale;
        
        const isSelected = m.selected;
        const baseColor = m.color || '#06b6d4';
        
        const color = isSelected ? '#fbbf24' : baseColor; // Amber if selected
        const bgColor = isSelected ? 'rgba(251, 191, 36, 0.15)' : hexToRgba(baseColor, 0.15);
        const strokeColor = isSelected ? 'rgba(251, 191, 36, 0.5)' : hexToRgba(baseColor, 0.5);
        
        // Dimension line
        ctx.strokeStyle = color;
        ctx.lineWidth = dLineWidth;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        // Cross markers
        drawCross(p1.x, p1.y, dCrossSize, color);
        drawCross(p2.x, p2.y, dCrossSize, color);
        
        // Distance label (hide text if the line is still very small)
        if (screenDist > 30) {
            const midX = (p1.x + p2.x) / 2;
            const midY = (p1.y + p2.y) / 2;
            
            const label = formatDistance(m.distance);
            
            ctx.font = `bold ${dFontSize}px "Inter", sans-serif`;
            const tw = ctx.measureText(label).width;
            
            // Label background
            ctx.fillStyle = bgColor;
            ctx.strokeStyle = strokeColor;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(midX - tw / 2 - dPad, midY - dFontSize / 2 - dPad, tw + dPad * 2, dFontSize + dPad * 2, 4);
            ctx.fill();
            ctx.stroke();
            
            // Label text
            ctx.fillStyle = color;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(label, midX, midY);
        }
    }
    
    // Draw pending first point
    if (measurePending && currentMousePt) {
        const sp = dxfToScreen(measurePending.x, measurePending.y);
        drawCross(sp.x, sp.y, crossSize, '#f59e0b');
        
        // Live line to cursor or snap point
        const targetPt = currentSnapPoint || currentMousePt;
        const tp = dxfToScreen(targetPt.x, targetPt.y);
        
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);
        
        ctx.font = `11px "Inter", sans-serif`;
        ctx.fillStyle = '#f59e0b';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText('Clic en 2° punto', sp.x + 12, sp.y - 6);
    }
    
    ctx.restore();
}

function drawSnapIndicator() {
    if ((currentTool === 'measure' || currentTool === 'line' || currentTool.startsWith('sym-')) && currentSnapPoint) {
        ctx.save();
        const sp = dxfToScreen(currentSnapPoint.x, currentSnapPoint.y);

        if (currentSnapPoint.isSymbolPort) {
            // ── Magenta diamond = snapping to another symbol's port ──
            ctx.strokeStyle = '#e879f9';
            ctx.fillStyle   = 'rgba(232,121,249,0.15)';
            ctx.lineWidth = 2;
            const d = 7;
            ctx.beginPath();
            ctx.moveTo(sp.x,     sp.y - d);
            ctx.lineTo(sp.x + d, sp.y);
            ctx.lineTo(sp.x,     sp.y + d);
            ctx.lineTo(sp.x - d, sp.y);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // Pulsating ring
            ctx.strokeStyle = 'rgba(232,121,249,0.35)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(sp.x, sp.y, d + 5, 0, Math.PI * 2);
            ctx.stroke();
        } else {
            // ── Green square = snapping to DXF entity vertex ──
            ctx.strokeStyle = '#22c55e';
            ctx.lineWidth = 2;
            const sSize = 5;
            ctx.strokeRect(sp.x - sSize, sp.y - sSize, sSize * 2, sSize * 2);
        }
        ctx.restore();
    }
}

/**
 * Returns the open connection ports of a piping symbol in DXF coordinates.
 * Each port is where another fitting can attach.
 * Port offsets are in screen pixels (SYM_SIZE-based) and converted to DXF units.
 * `outDxfX/outDxfY` is the unit outward direction vector in DXF space (used to
 * offset a new symbol so its OWN edge, not its center, lands on this port).
 */
function getSymbolConnectionPortsDxf(sym) {
    if (sym.dxfX === undefined || sym.dxfY === undefined) return [];

    const scaleFactor = Math.min(1.0, viewState.scale / 15.0) || 1.0;
    const s = SYM_SIZE * scaleFactor; // screen-pixel half-size of the symbol
    const a = sym.angle || 0;         // rotation in radians
    const cos = Math.cos(a);
    const sin = Math.sin(a);

    /**
     * Convert a screen-space local offset (lx, ly) → DXF point.
     * The outward normal direction is the normalised (lx, ly) rotated into DXF space.
     */
    function portAt(lx, ly) {
        // Position (screen offset → DXF)
        const rx = lx * cos - ly * sin;
        const ry = lx * sin + ly * cos;

        // Outward unit direction (screen offset normalised, then rotated to DXF axes)
        const len = Math.hypot(lx, ly) || 1;
        const nlx = lx / len;
        const nly = ly / len;
        const ndx = nlx * cos - nly * sin; // screen X maps to DXF X
        const ndy = nlx * sin + nly * cos; // screen Y is downward; DXF Y is upward

        return {
            x: sym.dxfX + rx / viewState.scale,
            y: sym.dxfY - ry / viewState.scale,
            isSymbolPort: true,
            // Outward direction in DXF coordinate space
            outDxfX:  ndx,
            outDxfY: -ndy   // negate because DXF Y is opposite of screen Y
        };
    }

    switch (sym.type) {
        case 'tee':      return [portAt(-s, 0), portAt(s, 0), portAt(0, s)];
        case 'tee-lat':  {
            const d = s * 0.7071; // 45 deg branch
            return [portAt(-s, 0), portAt(s, 0), portAt(d, -d)];
        }
        case 'codo':     return [portAt(-s, 0), portAt(0, s)];
        case 'reductor': return [portAt(-s, 0), portAt(s, 0)];
        case 'brida':    return [portAt(0, -s), portAt(0, s)];
        case 'tapon':    return [portAt(-s, 0)];
        default:         return [];
    }
}

function findClosestSnapPoint(mouseDxfPt, maxScreenDist) {
    let closestPt = null;
    let minDistSq = Infinity;
    const maxDxfDistSq = Math.pow(maxScreenDist / viewState.scale, 2);

    // ── 1. DXF entity vertices and edges ────────────────────────────────────────────────
    if (dxfData && dxfData.entities) {
        for (const ent of dxfData.entities) {
            const points = getEntityPoints(ent);
            for (const p of points) {
                if (p.x === undefined || p.y === undefined) continue;
                const dx = p.x - mouseDxfPt.x;
                const dy = p.y - mouseDxfPt.y;
                const distSq = dx * dx + dy * dy;
                if (distSq < maxDxfDistSq && distSq < minDistSq) {
                    minDistSq = distSq;
                    closestPt = { x: p.x, y: p.y };
                }
            }
            
            if (ent.type === 'LINE' || ent.type === 'LWPOLYLINE' || ent.type === 'POLYLINE') {
                const pts = ent.vertices || [];
                for (let i = 0; i < pts.length - 1; i++) {
                    if (pts[i].x === undefined || pts[i].y === undefined || pts[i+1].x === undefined || pts[i+1].y === undefined) continue;
                    const proj = projectPointOnSegment(mouseDxfPt, pts[i], pts[i+1]);
                    const dx = proj.x - mouseDxfPt.x;
                    const dy = proj.y - mouseDxfPt.y;
                    const distSq = dx * dx + dy * dy;
                    if (distSq < maxDxfDistSq && distSq < minDistSq) {
                        minDistSq = distSq;
                        closestPt = proj;
                    }
                }
            }
        }
    }

    // ── 2. Piping symbol connection ports (snaps with higher priority) ────────
    // Use a slightly wider search radius for symbol ports so they feel magnetic.
    const symMaxDxfDistSq = Math.pow((maxScreenDist + 6) / viewState.scale, 2);
    for (const sym of pipingSymbols) {
        const ports = getSymbolConnectionPortsDxf(sym);
        for (const p of ports) {
            const dx = p.x - mouseDxfPt.x;
            const dy = p.y - mouseDxfPt.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < symMaxDxfDistSq && distSq < minDistSq) {
                minDistSq = distSq;
                closestPt = p; // already has isSymbolPort: true
            }
        }
    }

    return closestPt;
}

function drawCross(x, y, size, color) {
    const exportScale = window.exportScaleFactor || 1;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2 * exportScale;
    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x + size, y);
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y + size);
    ctx.stroke();
    
    // Circle around cross
    ctx.beginPath();
    ctx.arc(x, y, size * 0.7, 0, Math.PI * 2);
    ctx.stroke();
}

function formatDistance(dist) {
    return dist.toFixed(2) + ' ' + currentUnit;
}

function handleMeasureClick(e) {
    if (currentTool !== 'measure') return;
    
    const rawPt = screenToDxf(e.clientX, e.clientY);
    const pt = currentSnapPoint || rawPt;
    
    if (!measurePending) {
        // First click
        measurePending = pt;
        const infoMeasure = document.getElementById('info-measure');
        if (infoMeasure) infoMeasure.style.display = 'flex';
        const mv = document.getElementById('measure-value');
        if (mv) mv.textContent = 'Selecciona 2° punto...';
    } else {
        // Second click — Save measurement
        const dx = pt.x - measurePending.x;
        const dy = pt.y - measurePending.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        measurements.push({ 
            p1: { ...measurePending }, 
            p2: { ...pt }, 
            distance: distance,
            color: currentMeasureColor
        });
        
        const mv = document.getElementById('measure-value');
        if (mv) mv.textContent = formatDistance(distance);
        
        measurePending = null;
        saveAnnotations();
    }
    
    drawDxf();
}

function drawCustomLines() {
    if (customLines.length === 0 && !linePending) return;
    
    ctx.save();
    const exportScale = window.exportScaleFactor || 1;
    ctx.lineWidth = 2 * exportScale;
    
    for (const l of customLines) {
        const p1 = dxfToScreen(l.p1.x, l.p1.y);
        const p2 = dxfToScreen(l.p2.x, l.p2.y);
        
        ctx.strokeStyle = l.color;
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
    }
    
    if (linePending && currentMousePt) {
        const linePicker = document.getElementById('line-color-picker');
        const lineColor = linePicker ? linePicker.value : currentMeasureColor;
        
        const sp = dxfToScreen(linePending.x, linePending.y);
        drawCross(sp.x, sp.y, 8, lineColor);
        
        const targetPt = currentSnapPoint || currentMousePt;
        const tp = dxfToScreen(targetPt.x, targetPt.y);
        
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(sp.x, sp.y);
        ctx.lineTo(tp.x, tp.y);
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    ctx.restore();
}

function handleLineClick(e) {
    if (!dxfData) return;
    
    // Si es clic derecho, terminar la línea continua
    if (e.button === 2) {
        linePending = null;
        drawDxf();
        return;
    }
    
    const rawPt = screenToDxf(e.clientX, e.clientY);
    const pt = currentSnapPoint || rawPt;
    
    if (!linePending) {
        linePending = pt;
    } else {
        // Evitar líneas de longitud cero
        if (pt.x !== linePending.x || pt.y !== linePending.y) {
            const linePicker = document.getElementById('line-color-picker');
            const lineColor = linePicker ? linePicker.value : currentMeasureColor;
            
            customLines.push({ 
                p1: { ...linePending }, 
                p2: { ...pt }, 
                color: lineColor
            });
            saveAnnotations();
        }
        linePending = pt; // Continuar desde el último punto
    }
    drawDxf();
}

function updateSymbolPropertiesUI(x, y) {
    const panel = document.getElementById('floating-sym-props');
    if (!panel) return;
    
    if (selectedSymbolIndex >= 0) {
        const sym = pipingSymbols[selectedSymbolIndex];
        panel.style.display = 'block';
        
        if (x !== undefined && y !== undefined) {
            panel.style.left = (x + 20) + 'px';
            panel.style.top = (y + 20) + 'px';
        }
        
        const partSelect = document.getElementById('float-part');
        if (partSelect) {
            partSelect.innerHTML = '<option value="">— Seleccionar —</option>';
            
            let options = [];
            if (sym.type === 'reductor') {
                options = CATALOG_AIRPIPE['reductor'];
            } else if (sym.type === 'tee-lat') {
                options = CATALOG_AIRPIPE['tee-lat'];
            } else if (sym.type === 'tee') {
                // For regular tee, combine standard sizes and reducing tees
                options = [
                    ...CATALOG_AIRPIPE['standard'].map(o => ({ ...o, label: `Igual ${o.label}` })),
                    ...CATALOG_AIRPIPE['tee-red']
                ];
            } else {
                options = CATALOG_AIRPIPE['standard'];
            }
            
            options.forEach(opt => {
                const el = document.createElement('option');
                // Store code or d1 as value to identify selection
                el.value = opt.code ? `code:${opt.code}` : `d1:${opt.d1}`;
                el.textContent = opt.label;
                
                // Set selected if it matches
                if (opt.code && sym.code === opt.code) {
                    el.selected = true;
                } else if (!opt.code && !sym.code && sym.d1 === opt.d1 && !sym.d2) {
                    el.selected = true;
                }
                
                partSelect.appendChild(el);
            });
        }
        
        const colorInput = document.getElementById('float-color');
        if (colorInput) colorInput.value = sym.color || '#06b6d4';
        
        renderRecentColors();
    } else {
        panel.style.display = 'none';
    }
}

document.getElementById('float-part')?.addEventListener('change', (e) => {
    if (selectedSymbolIndex >= 0) {
        const val = e.target.value;
        const sym = pipingSymbols[selectedSymbolIndex];
        
        if (!val) {
            sym.code = null; sym.d1 = null; sym.d2 = null;
        } else if (val.startsWith('code:')) {
            const code = val.replace('code:', '');
            sym.code = code;
            // Find the item in catalog to set d1 and d2
            let found = false;
            for (const cat of ['reductor', 'tee-red', 'tee-lat']) {
                const item = CATALOG_AIRPIPE[cat].find(c => c.code === code);
                if (item) {
                    sym.d1 = item.d1;
                    sym.d2 = item.d2;
                    found = true;
                    break;
                }
            }
        } else if (val.startsWith('d1:')) {
            sym.code = null;
            sym.d1 = val.replace('d1:', '');
            sym.d2 = null;
        }
        
        saveAnnotations();
        requestDrawDxf();
    }
});

document.getElementById('float-color')?.addEventListener('input', (e) => {
    if (selectedSymbolIndex >= 0) {
        pipingSymbols[selectedSymbolIndex].color = e.target.value;
        saveAnnotations();
        requestDrawDxf();
    }
});

function addRecentColor(color) {
    if (!color) return;
    recentColors = recentColors.filter(c => c !== color);
    recentColors.unshift(color);
    if (recentColors.length > 8) recentColors.pop();
    
    try {
        localStorage.setItem('dxf_global_recent_colors', JSON.stringify(recentColors));
    } catch (e) { console.warn(e); }
    
    renderRecentColors();
}

function renderRecentColors() {
    const wrapper = document.getElementById('recent-colors-wrapper');
    const container = document.getElementById('recent-colors-container');
    if (!wrapper || !container) return;
    
    if (recentColors.length === 0) {
        wrapper.style.display = 'none';
        return;
    }
    
    wrapper.style.display = 'block';
    container.innerHTML = '';
    
    recentColors.forEach(color => {
        const swatch = document.createElement('div');
        swatch.style.width = '18px';
        swatch.style.height = '18px';
        swatch.style.borderRadius = '50%';
        swatch.style.backgroundColor = color;
        swatch.style.cursor = 'pointer';
        swatch.style.border = '1px solid var(--glass-border)';
        swatch.addEventListener('click', () => {
            const colorInput = document.getElementById('float-color');
            if (colorInput) colorInput.value = color;
            if (selectedSymbolIndex >= 0) {
                pipingSymbols[selectedSymbolIndex].color = color;
                saveAnnotations();
                requestDrawDxf();
            }
        });
        container.appendChild(swatch);
    });
}

document.getElementById('float-color')?.addEventListener('change', (e) => {
    addRecentColor(e.target.value);
    saveAnnotations();
});

document.getElementById('sym-color-picker')?.addEventListener('change', (e) => {
    addRecentColor(e.target.value);
    saveAnnotations();
});

// ─── Delete mode logic ───
function handleDeleteClick(e) {
    if (currentTool !== 'delete') return;
    
    // We do collision detection in screen coordinates because measurements/couplings are drawn with fixed screen pixel sizes
    const clickScreen = {
        x: e.clientX - canvas.getBoundingClientRect().left,
        y: e.clientY - canvas.getBoundingClientRect().top
    };
    
    const clickDxf = screenToDxf(e.clientX, e.clientY);
    const maxScreenDistSq = 15 * 15;
    
    let deletedSomething = false;
    
    // 1. Check measurements
    for (let i = measurements.length - 1; i >= 0; i--) {
        const m = measurements[i];
        const p1s = dxfToScreen(m.p1.x, m.p1.y);
        const p2s = dxfToScreen(m.p2.x, m.p2.y);
        
        // Check distance to line segment
        const dSq = distToSegmentSquaredScreen(clickScreen, p1s, p2s);
        
        // Also check distance to text label center
        const midX = (p1s.x + p2s.x) / 2;
        const midY = (p1s.y + p2s.y) / 2;
        const distToCenterSq = (clickScreen.x - midX)**2 + (clickScreen.y - midY)**2;
        
        if (dSq < maxScreenDistSq || distToCenterSq < maxScreenDistSq * 2) {
            measurements.splice(i, 1);
            deletedSomething = true;
            break; // Delete one at a time
        }
    }
    
    if (!deletedSomething) {
        // 2. Check virtual couplings
        for (let i = virtualCouplings.length - 1; i >= 0; i--) {
            const c = virtualCouplings[i];
            const p = dxfToScreen(c.x, c.y);
            const dSq = (clickScreen.x - p.x)**2 + (clickScreen.y - p.y)**2;
            if (dSq < maxScreenDistSq) {
                const idToDelete = c.matrixId;
                if (idToDelete) {
                    // Delete all couplings generated in the same matrix operation
                    for (let j = virtualCouplings.length - 1; j >= 0; j--) {
                        if (virtualCouplings[j].matrixId === idToDelete) {
                            virtualCouplings.splice(j, 1);
                        }
                    }
                } else {
                    virtualCouplings.splice(i, 1);
                }
                deletedSomething = true;
                break;
            }
        }
    }
    
    if (!deletedSomething) {
        // 3. Check customLines (manually drawn straight lines/pipes)
        for (let i = customLines.length - 1; i >= 0; i--) {
            const l = customLines[i];
            const p1s = dxfToScreen(l.p1.x, l.p1.y);
            const p2s = dxfToScreen(l.p2.x, l.p2.y);
            const dSq = distToSegmentSquaredScreen(clickScreen, p1s, p2s);
            if (dSq < maxScreenDistSq) {
                customLines.splice(i, 1);
                deletedSomething = true;
                break;
            }
        }
    }
    
    if (!deletedSomething) {
        // 4. Check pipingSymbols
        const hit = findSymbolAt(clickScreen.x, clickScreen.y);
        if (hit >= 0) {
            pipingSymbols.splice(hit, 1);
            if (selectedSymbolIndex === hit) selectedSymbolIndex = -1;
            deletedSomething = true;
        }
    }
    
    if (!deletedSomething) {
        // 5. Check Fabric.js annotations (Freehand lines, Rectangles, Text)
        if (window.deleteFabricObjectAtEvent) {
            deletedSomething = window.deleteFabricObjectAtEvent(e);
        }
    }
    
    if (deletedSomething) {
        saveAnnotations();
        drawDxf();
        // If BOM is open, we could refresh it, but the user has to click it again anyway.
    }
}

function distToSegmentSquaredScreen(p, v, w) {
    const l2 = (v.x - w.x)**2 + (v.y - w.y)**2;
    if (l2 === 0) return (p.x - v.x)**2 + (p.y - v.y)**2;
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
    return (p.x - proj.x)**2 + (p.y - proj.y)**2;
}

// ─── Sum mode logic ───
function handleSumClick(e) {
    if (currentTool !== 'sum') return;
    
    const clickScreen = {
        x: e.clientX - canvas.getBoundingClientRect().left,
        y: e.clientY - canvas.getBoundingClientRect().top
    };
    
    const maxScreenDistSq = 15 * 15;
    let clickedSomething = false;
    
    for (let i = measurements.length - 1; i >= 0; i--) {
        const m = measurements[i];
        const p1s = dxfToScreen(m.p1.x, m.p1.y);
        const p2s = dxfToScreen(m.p2.x, m.p2.y);
        
        const dSq = distToSegmentSquaredScreen(clickScreen, p1s, p2s);
        
        const midX = (p1s.x + p2s.x) / 2;
        const midY = (p1s.y + p2s.y) / 2;
        const distToCenterSq = (clickScreen.x - midX)**2 + (clickScreen.y - midY)**2;
        
        if (dSq < maxScreenDistSq || distToCenterSq < maxScreenDistSq * 2) {
            m.selected = !m.selected; // Toggle selection
            clickedSomething = true;
            break; 
        }
    }
    
    if (clickedSomething) {
        updateSumDisplay();
        drawDxf();
    }
}

function updateSumDisplay() {
    const sumEl = document.getElementById('sum-value');
    if (!sumEl) return;
    
    let total = 0;
    measurements.forEach(m => {
        if (m.selected) total += m.distance;
    });
    
    sumEl.textContent = formatDistance(total);
}

// ══════════════════════════════════════════════════
//  COPLE ARRAY TOOL
// ══════════════════════════════════════════════════

function drawCouplings() {
    if (virtualCouplings.length === 0) return;
    ctx.save();
    
    // Draw couplings as small red rectangles perpendicular to the line
    const width = 10;
    const height = 4;
    
    ctx.fillStyle = '#ef4444'; // Red
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    
    for (const c of virtualCouplings) {
        if (c.x === undefined || c.y === undefined || isNaN(c.x) || isNaN(c.y)) continue;
        const p = dxfToScreen(c.x, c.y);
        ctx.save();
        ctx.translate(p.x, p.y);
        
        if (c.angle !== undefined) {
            ctx.rotate(-c.angle);
        }
        
        ctx.fillStyle = c.color || document.getElementById('cople-color-picker')?.value || '#ef4444'; // Default Red or selected color
        
        const exportScale = window.exportScaleFactor || 1;
        let scaleFactor = Math.min(1.0, viewState.scale / 15.0);
        if (isNaN(scaleFactor) || scaleFactor <= 0.01) scaleFactor = 1.0;
        ctx.scale(scaleFactor * exportScale, scaleFactor * exportScale);
        
        ctx.fillRect(-width/2, -height/2, width, height);
        ctx.strokeRect(-width/2, -height/2, width, height);
        ctx.restore();
    }
    
    ctx.restore();
}

// ══════════════════════════════════════════════════
//  PIPING SYMBOLS — drawn directly on DXF canvas
// ══════════════════════════════════════════════════

const SYM_SIZE = 14; // half-size in screen pixels

function drawSymbols() {
    if (pipingSymbols.length === 0) return;
    ctx.save();
    
    for (let i = 0; i < pipingSymbols.length; i++) {
        const sym = pipingSymbols[i];
        if (!sym || sym.dxfX === undefined || sym.dxfY === undefined || isNaN(sym.dxfX) || isNaN(sym.dxfY)) continue;
        
        const sp = dxfToScreen(sym.dxfX, sym.dxfY);
        ctx.save();
        if (isNaN(sp.x) || isNaN(sp.y)) { ctx.restore(); continue; }
        
        ctx.translate(sp.x, sp.y);
        ctx.rotate(sym.angle || 0);
        
        const baseColor = sym.selected ? '#fbbf24' : (sym.color || '#06b6d4');
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        
        const exportScale = window.exportScaleFactor || 1;
        // Scale down symbol visually when zoomed out to avoid clutter
        let scaleFactor = Math.min(1.0, viewState.scale / 15.0);
        if (isNaN(scaleFactor) || scaleFactor <= 0.01) scaleFactor = 1.0;
        ctx.scale(scaleFactor * exportScale, scaleFactor * exportScale);
        
        const s = SYM_SIZE;
        
        ctx.beginPath();
        if (sym.type === 'tee') {
            ctx.moveTo(-s, 0); ctx.lineTo(s, 0);   // horizontal pipe
            ctx.moveTo(0, 0);  ctx.lineTo(0, s);    // branch down
        } else if (sym.type === 'tee-lat') {
            ctx.moveTo(-s, 0); ctx.lineTo(s, 0);
            const d = s * 0.7071;
            ctx.moveTo(0, 0); ctx.lineTo(d, d);
        } else if (sym.type === 'codo') {
            ctx.moveTo(-s, 0); ctx.lineTo(0, 0);    // horizontal
            ctx.lineTo(0, s);                        // vertical
        } else if (sym.type === 'reductor') {
            ctx.moveTo(-s, -s * 0.6); ctx.lineTo(s, -s * 0.35);
            ctx.lineTo(s, s * 0.35);  ctx.lineTo(-s, s * 0.6);
            ctx.closePath();
        } else if (sym.type === 'brida') {
            ctx.moveTo(-s * 0.25, -s); ctx.lineTo(-s * 0.25, s);
            ctx.moveTo(s * 0.25, -s);  ctx.lineTo(s * 0.25, s);
        } else if (sym.type === 'tapon') {
            ctx.moveTo(-s, 0); ctx.lineTo(0, 0);    // tube reaching end
            ctx.moveTo(0, -s * 0.7); ctx.lineTo(0, s * 0.7); // vertical cap
        }
        ctx.stroke();
        
        // Label
        let label = '';
        if (sym.type === 'tapon') label = 'Tapón';
        else if (sym.type === 'tee-lat') label = 'Tee Lat';
        else if (sym.type) label = sym.type.charAt(0).toUpperCase() + sym.type.slice(1);
        
        if (sym.code) label += ` ${sym.code}`;
        else if (sym.d1 && sym.d2) label += ` ${sym.d1}x${sym.d2}`;
        else if (sym.d1) label += ` ${sym.d1}`;
        else if (sym.d2) label += ` ${sym.d2}`;
        
        ctx.font = 'bold 10px "Inter", sans-serif';
        ctx.fillStyle = baseColor;
        ctx.textAlign = 'center';
        ctx.fillText(label, 0, -s - 4);
        
        // Selection ring
        if (sym.selected) {
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.arc(0, 0, s + 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        
        ctx.restore();
    }
    ctx.restore();
}

function findSymbolAt(cx, cy) {
    const hitRadius = SYM_SIZE + 8;
    for (let i = pipingSymbols.length - 1; i >= 0; i--) {
        const sp = dxfToScreen(pipingSymbols[i].dxfX, pipingSymbols[i].dxfY);
        const dist = Math.hypot(cx - sp.x, cy - sp.y);
        if (dist < hitRadius) return i;
    }
    return -1;
}


function handleCopleClick(e) {
    if (currentTool !== 'cople') return;
    if (!dxfData || !dxfData.entities) return;
    
    const pt = screenToDxf(e.clientX, e.clientY);
    const maxScreenDist = 15;
    const maxDxfDistSq = Math.pow(maxScreenDist / viewState.scale, 2);
    
    let closestEnt = null;
    let closestDistSq = Infinity;
    
    // Valid layers roughly for piping
    const pipeLayers = ['TUBOS', 'LINEA', 'I2DRUCKL', 'I2HDRUCKL', 'ALIMENTACION', 'AIRE', 'A-CONEX'];
    
    for (const ent of dxfData.entities) {
        if (ent.type !== 'LINE' && ent.type !== 'LWPOLYLINE' && ent.type !== 'POLYLINE') continue;
        
        // Find distance to segment
        let pts = [];
        if (ent.type === 'LINE') {
            pts = ent.vertices || [];
        } else {
            pts = ent.vertices || [];
        }
        
        for (let i = 0; i < pts.length - 1; i++) {
            const dSq = distToSegmentSquared(pt, pts[i], pts[i+1]);
            if (dSq < maxDxfDistSq && dSq < closestDistSq) {
                closestDistSq = dSq;
                closestEnt = ent;
            }
        }
    }
    
    if (closestEnt) {
        const inputDist = parseFloat(document.getElementById('cople-dist').value);
        if (isNaN(inputDist) || inputDist <= 0) {
            alert('Por favor ingresa una distancia válida.');
            return;
        }
        
        let selectedPoints = closestEnt.vertices || [];
        let distanceAccum = inputDist;
        let generated = 0;
        const matrixId = Date.now(); // Group ID for matrix deletion
        
        for (let i = 0; i < selectedPoints.length - 1; i++) {
            const pA = selectedPoints[i];
            const pB = selectedPoints[i+1];
            
            const dx = pB.x - pA.x;
            const dy = pB.y - pA.y;
            const segLen = Math.hypot(dx, dy);
            
            let localD = distanceAccum;
            while (localD <= segLen) {
                const t = localD / segLen;
                const copleX = pA.x + dx * t;
                const copleY = pA.y + dy * t;
                
                const angle = Math.atan2(dy, dx);
                
                virtualCouplings.push({ 
                    x: copleX, 
                    y: copleY, 
                    matrixId,
                    angle: angle,
                    color: document.getElementById('cople-color-picker')?.value || '#ef4444'
                });
                
                generated++;
                localD += inputDist;
            }
            
            // leftover length
            distanceAccum = segLen - (localD - inputDist);
        }
        
        if (generated > 0) saveAnnotations();
        drawDxf();
    }
}

function distToSegmentSquared(p, v, w) {
    const l2 = distSquared(v, w);
    if (l2 === 0) return distSquared(p, v);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return distSquared(p, { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) });
}

function projectPointOnSegment(p, v, w) {
    const l2 = distSquared(v, w);
    if (l2 === 0) return { x: v.x, y: v.y };
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return { x: v.x + t * (w.x - v.x), y: v.y + t * (w.y - v.y) };
}

function distSquared(v, w) {
    return (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
}

// ─── Clear measurements ───
document.getElementById('btn-clear-measures')?.addEventListener('click', () => {
    measurements = [];
    customLines = [];
    measurePending = null;
    linePending = null;
    virtualCouplings.length = 0; // Clear couplings as well
    saveAnnotations();
    const infoMeasure = document.getElementById('info-measure');
    if (infoMeasure) infoMeasure.style.display = 'none';
    drawDxf();
});

// ─── Color Picker Logic ───
document.getElementById('measure-color-picker')?.addEventListener('input', (e) => {
    currentMeasureColor = e.target.value;
    
    // Sync to fabric brush for free drawing mode
    if (window.updateFabricBrushColor) {
        window.updateFabricBrushColor(currentMeasureColor);
    }
    
    // If in sum mode, apply color to selected measurements
    if (currentTool === 'sum') {
        let changed = false;
        measurements.forEach(m => {
            if (m.selected) {
                m.color = currentMeasureColor;
                changed = true;
            }
        });
        if (changed) {
            saveAnnotations();
            drawDxf();
        }
    }
});

function hexToRgba(hex, alpha) {
    if (!hex) return `rgba(6, 182, 212, ${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16) || 6;
    const g = parseInt(hex.slice(3, 5), 16) || 182;
    const b = parseInt(hex.slice(5, 7), 16) || 212;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// ─── Unit Logic ───
document.getElementById('unit-select')?.addEventListener('change', (e) => {
    currentUnit = e.target.value;
    updateCouplingDefault();
    saveAnnotations(); // In case we want to persist unit preference later, but mostly triggers a redraw
    requestDrawDxf();
});

function updateCouplingDefault() {
    const input = document.getElementById('cople-dist');
    if (!input) return;
    if (currentUnit === 'm') input.value = '5.79';
    else if (currentUnit === 'in') input.value = '228';
    else input.value = '5791.2';
}

function detectUnits() {
    if (dxfData.header && dxfData.header.$INSUNITS !== undefined) {
        const u = dxfData.header.$INSUNITS;
        if (u === 1) return 'in';
        if (u === 4) return 'mm';
        if (u === 6) return 'm';
    }
    
    let minX = Infinity, maxX = -Infinity;
    for (const ent of dxfData.entities) {
        const points = getEntityPoints(ent);
        for (const p of points) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
        }
    }
    const width = maxX - minX;
    // If the entire drawing is less than 1000 units wide, it's highly likely to be in meters.
    if (width > 0 && width < 1000) return 'm'; 
    return 'mm';
}

// ─── Persistence Logic ───
function saveAnnotations() {
    if (!currentFileName) return;
    const data = {
        measurements: measurements.map(m => ({
            p1: m.p1, p2: m.p2, distance: m.distance, color: m.color
        })),
        customLines: customLines,
        couplings: virtualCouplings,
        unit: currentUnit,
        symbols: pipingSymbols.map(s => ({ 
            type: s.type, 
            dxfX: s.dxfX, 
            dxfY: s.dxfY, 
            angle: s.angle || 0,
            d1: s.d1,
            d2: s.d2,
            color: s.color
        }))
    };
    try {
        localStorage.setItem(`dxf_annotations_${currentFileName}`, JSON.stringify(data));
    } catch(e) {
        console.warn('Could not save to localStorage', e);
    }
}

function loadAnnotations() {
    if (!currentFileName) return;
    try {
        const saved = localStorage.getItem(`dxf_annotations_${currentFileName}`);
        if (saved) {
            const data = JSON.parse(saved);
            if (data.measurements) measurements = data.measurements;
            if (data.customLines) customLines = data.customLines;
            if (data.couplings) {
                virtualCouplings.length = 0;
                virtualCouplings.push(...data.couplings);
            }
            if (data.unit) {
                currentUnit = data.unit;
                const unitSelect = document.getElementById('unit-select');
                if (unitSelect) unitSelect.value = currentUnit;
                updateCouplingDefault();
            }
            if (data.symbols) {
                pipingSymbols.length = 0;
                data.symbols.forEach(s => pipingSymbols.push({ ...s, selected: false }));
            }
        }
    } catch(e) {
        console.warn('Could not load from localStorage', e);
    }
}

// ══════════════════════════════════════════════════
//  BOM PANEL
// ══════════════════════════════════════════════════

document.getElementById('btn-bom')?.addEventListener('click', () => {
    if (!dxfData) {
        alert('Carga un archivo DXF primero.');
        return;
    }
    
    bomData = generateBOM(dxfData, virtualCouplings, pipingSymbols, customLines);
    if (!bomData || bomData.summary.length === 0) {
        alert('No se encontraron elementos de tubería en el archivo.');
        return;
    }
    
    renderBOMTable(bomData.summary);
    document.getElementById('bom-panel').classList.remove('hidden');
});

document.getElementById('btn-close-bom')?.addEventListener('click', () => {
    document.getElementById('bom-panel').classList.add('hidden');
});

document.getElementById('btn-bom-csv')?.addEventListener('click', () => {
    if (!bomData) return;
    const csv = exportBOMtoCSV(bomData.summary);
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'BOM_Tuberia.csv';
    link.click();
    URL.revokeObjectURL(url);
});

// BOM filter buttons
document.querySelectorAll('.bom-filter').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.bom-filter').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        const filter = btn.dataset.filter;
        if (bomData) {
            const filtered = filter === 'all' 
                ? bomData.summary 
                : bomData.summary.filter(r => r.category === filter);
            renderBOMTable(filtered);
        }
    });
});

function renderBOMTable(data) {
    const tbody = document.getElementById('bom-tbody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    
    data.forEach((row, i) => {
        const tr = document.createElement('tr');
        
        let catClass = 'tuberia';
        if (row.category.includes('Válvula')) catClass = 'valvula';
        else if (row.category.includes('Accesorio')) catClass = 'accesorio';
        else if (row.category.includes('Instrumento')) catClass = 'instrumento';
        
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td><span class="cat-badge ${catClass}">${row.category}</span></td>
            <td>${row.description}</td>
            <td style="color: var(--text-muted); font-size: 11px;">${row.detail}</td>
            <td style="font-weight: 600; font-variant-numeric: tabular-nums;">${
                typeof row.quantity === 'number' && !Number.isInteger(row.quantity) 
                    ? row.quantity.toFixed(2) 
                    : row.quantity
            }</td>
            <td style="color: var(--text-muted);">${row.unit}</td>
        `;
        tbody.appendChild(tr);
    });
    
    const countEl = document.getElementById('bom-count');
    if (countEl) countEl.textContent = `${data.length} elementos`;
}

// ══════════════════════════════════════════════════
//  PAN / ZOOM / CURSOR EVENTS
// ══════════════════════════════════════════════════

canvas.addEventListener('contextmenu', (e) => {
    if (currentTool === 'line' || currentTool === 'measure') {
        e.preventDefault();
    }
});

canvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'line' && e.button === 2) {
        handleLineClick(e);
        return;
    }
    if (currentTool === 'measure' && e.button === 2) {
        measurePending = null;
        drawDxf();
        return;
    }

    if (currentTool === 'measure') {
        handleMeasureClick(e);
        return;
    }
    if (currentTool === 'line') {
        handleLineClick(e);
        return;
    }
    if (currentTool === 'cople') {
        handleCopleClick(e);
        return;
    }
    if (currentTool === 'delete') {
        handleDeleteClick(e);
        return;
    }
    if (currentTool === 'sum') {
        handleSumClick(e);
        return;
    }
    // ─── Symbol placement ───
    if (currentTool.startsWith('sym-') && currentTool !== 'sym-move') {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        // Compute placement position in DXF space.
        // If snapping to another symbol's port, shift the new symbol's CENTER outward
        // by half its own size so its EDGE (port) lands exactly on the snap point
        // instead of its center overlapping the other symbol.
        let dxfPt;
        if (currentSnapPoint && currentSnapPoint.isSymbolPort) {
            const scaleFactor = Math.min(1.0, viewState.scale / 15.0) || 1.0;
            const halfSizeDxf  = (SYM_SIZE * scaleFactor) / viewState.scale;
            dxfPt = {
                x: currentSnapPoint.x + (currentSnapPoint.outDxfX || 0) * halfSizeDxf,
                y: currentSnapPoint.y + (currentSnapPoint.outDxfY || 0) * halfSizeDxf
            };
        } else {
            dxfPt = currentSnapPoint ? { ...currentSnapPoint } : canvasToDxf(cx, cy);
        }
        const symType = currentTool.replace('sym-', '');
        
        let newSym = null;
        if (clipboardSymbol && clipboardSymbol.type === symType) {
            // Paste copied symbol properties
            newSym = { ...clipboardSymbol, dxfX: dxfPt.x, dxfY: dxfPt.y, selected: false };
        } else {
            // Fresh symbol
            const picker = document.getElementById('sym-color-picker');
            const symColor = picker ? picker.value : '#06b6d4';
            newSym = { type: symType, dxfX: dxfPt.x, dxfY: dxfPt.y, angle: 0, selected: false, color: symColor };
            addRecentColor(symColor);
        }
        
        pipingSymbols.push(newSym);
        saveAnnotations();
        drawDxf();
        
        if (!clipboardSymbol) {
            setMode('pan', document.getElementById('btn-pan'));
        }
        return;
    }
    // ─── Symbol move: select / start drag (also works in Pan mode) ───
    if (currentTool === 'pan' || currentTool === 'sym-move') {
        const rect = canvas.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const hit = findSymbolAt(cx, cy);
        
        if (hit >= 0) {
            pipingSymbols.forEach(s => s.selected = false);
            selectedSymbolIndex = hit;
            pipingSymbols[hit].selected = true;
            symDragging = true;
            symDragLastX = e.clientX;
            symDragLastY = e.clientY;
            updateSymbolPropertiesUI(e.clientX, e.clientY);
            drawDxf();
            return; // Intercepted the click for symbol, don't pan
        } else {
            // Clicked empty space
            pipingSymbols.forEach(s => s.selected = false);
            selectedSymbolIndex = -1;
            updateSymbolPropertiesUI();
            drawDxf();
            if (currentTool === 'sym-move') return; // Do nothing else
        }
    }
    
    if (currentTool === 'pan') {
        viewState.isDragging = true;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
    }
});

canvas.addEventListener('mousemove', (e) => {
    // Update cursor coordinates
    if (dxfData) {
        let pt = screenToDxf(e.clientX, e.clientY);
        
        // Modo Ortogonal (Ortho) para la herramienta de línea
        // Fuerza la línea a ser horizontal o vertical (Shift para liberar)
        if (currentTool === 'line' && linePending && !e.shiftKey) {
            const dx = Math.abs(pt.x - linePending.x);
            const dy = Math.abs(pt.y - linePending.y);
            if (dx > dy) {
                pt.y = linePending.y;
            } else {
                pt.x = linePending.x;
            }
        }
        
        currentMousePt = pt;
        
        const cx = document.getElementById('cursor-x');
        const cy = document.getElementById('cursor-y');
        if (cx) cx.textContent = `X: ${pt.x.toFixed(2)}`;
        if (cy) cy.textContent = `Y: ${pt.y.toFixed(2)}`;
        
        if (currentTool === 'measure' || currentTool === 'line' || currentTool.startsWith('sym-') || symDragging) {
            currentSnapPoint = findClosestSnapPoint(pt, 15); // 15px snap radius
            
            // Si el snap jaló el cursor fuera del eje ortogonal, forzarlo de vuelta al eje
            if (currentTool === 'line' && linePending && !e.shiftKey && currentSnapPoint) {
                if (Math.abs(pt.x - linePending.x) > Math.abs(pt.y - linePending.y)) {
                    currentSnapPoint.y = linePending.y; // Mantener horizontal
                } else {
                    currentSnapPoint.x = linePending.x; // Mantener vertical
                }
            }
            
            if (!viewState.isDragging) requestDrawDxf(); // Redraw for live line/snap
        } else {
            currentSnapPoint = null;
        }
        
        // Hover detection for symbols (cursor feedback)
        if (currentTool === 'pan' && !viewState.isDragging && !symDragging) {
            const rect = canvas.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const hit = findSymbolAt(cx, cy);
            if (hit >= 0) {
                canvas.style.cursor = 'move';
            } else {
                canvas.style.cursor = 'grab'; // Default pan cursor
            }
        }
    }
    
    if (viewState.isDragging) {
        const dx = e.clientX - viewState.lastX;
        const dy = e.clientY - viewState.lastY;
        viewState.x += dx;
        viewState.y += dy;
        viewState.lastX = e.clientX;
        viewState.lastY = e.clientY;
        requestDrawDxf();
    }
    
    // Symbol dragging
    if (symDragging && selectedSymbolIndex >= 0) {
        const sym = pipingSymbols[selectedSymbolIndex];
        
        if (currentSnapPoint) {
            // Snap the symbol strictly to the DXF point
            sym.dxfX = currentSnapPoint.x;
            sym.dxfY = currentSnapPoint.y;
            // Update last coords so breaking snap is smooth
            symDragLastX = e.clientX;
            symDragLastY = e.clientY;
        } else {
            // Normal free dragging
            const dx = e.clientX - symDragLastX;
            const dy = e.clientY - symDragLastY;
            sym.dxfX += dx / viewState.scale;
            sym.dxfY -= dy / viewState.scale; // Y inverted
            symDragLastX = e.clientX;
            symDragLastY = e.clientY;
        }
        
        requestDrawDxf();
    }
});

window.addEventListener('mouseup', () => {
    viewState.isDragging = false;
    if (symDragging) {
        symDragging = false;
        saveAnnotations();
        drawDxf();
    }
});

// R = rotate selected symbol 45°, Delete/Backspace = remove selected symbol
window.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    
    if (e.key === 'Escape') {
        linePending = null;
        measurePending = null;
        requestDrawDxf();
    }
    
    // Copy Symbol (Ctrl+C)
    if (selectedSymbolIndex >= 0 && (e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault();
        clipboardSymbol = { ...pipingSymbols[selectedSymbolIndex] };
        
        // Switch to the placement tool for this symbol type
        const btn = document.getElementById('btn-sym-' + clipboardSymbol.type);
        if (btn) setMode('sym-' + clipboardSymbol.type, btn);
        
        // Deselect the copied symbol
        pipingSymbols.forEach(s => s.selected = false);
        selectedSymbolIndex = -1;
        updateSymbolPropertiesUI();
        drawDxf();
        return;
    }
    
    if (selectedSymbolIndex >= 0) {
        if (e.key === 'r' || e.key === 'R') {
            pipingSymbols[selectedSymbolIndex].angle = ((pipingSymbols[selectedSymbolIndex].angle || 0) + Math.PI / 4) % (Math.PI * 2);
            saveAnnotations();
            drawDxf();
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
            e.preventDefault();
            pipingSymbols.splice(selectedSymbolIndex, 1);
            selectedSymbolIndex = -1;
            updateSymbolPropertiesUI(); // Will hide it
            saveAnnotations();
            drawDxf();
        }
    }
});

canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomIntensity = 0.1;
    const wheel = e.deltaY < 0 ? 1 : -1;
    const zoom = Math.exp(wheel * zoomIntensity);
    
    const mouseX = e.clientX - canvas.getBoundingClientRect().left;
    const mouseY = e.clientY - canvas.getBoundingClientRect().top;
    
    viewState.x = mouseX - (mouseX - viewState.x) * zoom;
    viewState.y = mouseY - (mouseY - viewState.y) * zoom;
    viewState.scale *= zoom;
    
    requestDrawDxf();
}, { passive: false });
