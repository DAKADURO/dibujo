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
let rawDxfContent = null;
export const viewState = {
    x: 0,
    y: 0,
    scale: 1,
    isDragging: false,
    lastX: 0,
    lastY: 0
};

// ─── Measurement State ───
let measurements = [];
let measurePending = null; // first click point (in DXF coords)
let currentTool = 'pan';
let currentSnapPoint = null;
let currentMousePt = null;
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
    
    if (tool === 'measure') {
        container.classList.add('measure-mode');
    } else {
        container.classList.remove('measure-mode');
    }
    
    const infoSum = document.getElementById('info-sum');
    
    if (tool === 'cople' || tool === 'delete' || tool === 'sum' || (tool.startsWith('sym-') && tool !== 'sym-move')) {
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
        const fileContent = event.target.result;
        rawDxfContent = fileContent; // Save raw content for exporting later
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
            dxfData = parser.parseSync(fileContent);
            console.log('DXF Parsed:', dxfData);
            fitToScreen();
            
            // Detect and set units
            currentUnit = detectUnits();
            const unitSelect = document.getElementById('unit-select');
            if (unitSelect) unitSelect.value = currentUnit;
            updateCouplingDefault();
            
            // Reset state
            measurements = [];
            virtualCouplings.length = 0;
            measurePending = null;
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
    reader.readAsText(file);
});

// ─── DXF Export Logic ───
document.getElementById('btn-export-dxf').addEventListener('click', () => {
    if (!rawDxfContent) {
        alert('Por favor, carga un archivo DXF primero.');
        return;
    }
    exportToDxf();
});

function hexToDxfColor(hex) {
    if (!hex) return 0;
    if (hex.startsWith('#')) hex = hex.substring(1);
    return parseInt(hex, 16);
}

function dxfLine(x1, y1, x2, y2, colorHex) {
    const c = hexToDxfColor(colorHex);
    return `  0\nLINE\n  8\nAnotaciones\n 420\n${c}\n 10\n${x1}\n 20\n${y1}\n 30\n0.0\n 11\n${x2}\n 21\n${y2}\n 31\n0.0\n`;
}

function dxfText(text, x, y, height, colorHex) {
    const c = hexToDxfColor(colorHex);
    return `  0\nTEXT\n  8\nAnotaciones\n 420\n${c}\n 10\n${x}\n 20\n${y}\n 30\n0.0\n 40\n${height}\n  1\n${text}\n  72\n1\n 11\n${x}\n 21\n${y}\n 31\n0.0\n`; // Centered
}

function rotatePt(cx, cy, px, py, angle) {
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return {
        x: cos * (px - cx) - sin * (py - cy) + cx,
        y: sin * (px - cx) + cos * (py - cy) + cy
    };
}

function exportToDxf() {
    let customEntities = '';
    
    // 1. Freehand & Rectangles & Text (Fabric.js objects)
    const fabricObjs = getFabricObjects();
    for (const obj of fabricObjs) {
        // We need to convert screen coordinates back to DXF coordinates.
        // But wait! Fabric objects are mapped to the canvas screen coordinates.
        // Actually, in our viewer, we pan and zoom. The Fabric canvas stays fixed to the screen?
        // Let's check how Fabric objects are managed.
        // We can just use the inverse of dxfToScreen, which is screenToDxf.
        const color = obj.stroke || obj.fill || '#06b6d4';
        
        if (obj.type === 'path') {
            // Freehand
            if (obj.path && obj.path.length > 0) {
                // path elements are like ['M', x, y], ['Q', x1, y1, x2, y2], ['L', x, y]
                // For simplicity, we just use the control points or endpoints.
                let lastPt = null;
                for (const p of obj.path) {
                    let screenX = 0, screenY = 0;
                    if (p[0] === 'M' || p[0] === 'L') { screenX = p[1]; screenY = p[2]; }
                    else if (p[0] === 'Q') { screenX = p[3]; screenY = p[4]; }
                    else continue;
                    
                    // The path coordinates are relative to the object's left/top if it's transformed, but usually absolute in fabric path if not scaled?
                    // Actually, fabric path points are relative to the path center or origin.
                    // To get absolute screen coords:
                    const absolutePt = fabric.util.transformPoint({x: screenX, y: screenY}, obj.calcTransformMatrix());
                    const dxfPt = screenToDxf(absolutePt.x, absolutePt.y);
                    
                    if (lastPt) {
                        customEntities += dxfLine(lastPt.x, lastPt.y, dxfPt.x, dxfPt.y, color);
                    }
                    lastPt = dxfPt;
                }
            }
        } else if (obj.type === 'rect') {
            // We get the 4 corners in screen coords
            const aCoords = obj.aCoords; // {tl, tr, br, bl}
            const tl = screenToDxf(aCoords.tl.x, aCoords.tl.y);
            const tr = screenToDxf(aCoords.tr.x, aCoords.tr.y);
            const br = screenToDxf(aCoords.br.x, aCoords.br.y);
            const bl = screenToDxf(aCoords.bl.x, aCoords.bl.y);
            customEntities += dxfLine(tl.x, tl.y, tr.x, tr.y, color);
            customEntities += dxfLine(tr.x, tr.y, br.x, br.y, color);
            customEntities += dxfLine(br.x, br.y, bl.x, bl.y, color);
            customEntities += dxfLine(bl.x, bl.y, tl.x, tl.y, color);
        } else if (obj.type === 'i-text' || obj.type === 'text') {
            // Text object
            // Fabric text origins are usually top-left or center.
            const center = obj.getCenterPoint();
            const pt = screenToDxf(center.x, center.y);
            // Height in DXF units. If fontSize is 20px on screen, in DXF it's 20 / scale.
            const dxfHeight = (obj.fontSize * obj.scaleY) / viewState.scale;
            customEntities += dxfText(obj.text, pt.x, pt.y, dxfHeight, color);
        }
    }
    
    // 2. Measurements
    for (const m of measurements) {
        customEntities += dxfLine(m.p1.x, m.p1.y, m.p2.x, m.p2.y, m.color);
        const midX = (m.p1.x + m.p2.x) / 2;
        const midY = (m.p1.y + m.p2.y) / 2;
        customEntities += dxfText(m.distance.toFixed(2), midX, midY + 50, 100, m.color);
    }
    
    // 3. Couplings
    const cSizeX = 100, cSizeY = 40;
    for (const c of virtualCouplings) {
        const cx = c.x, cy = c.y;
        const color = c.color || document.getElementById('cople-color-picker')?.value || '#ef4444';
        const p1 = rotatePt(cx, cy, cx - cSizeX/2, cy - cSizeY/2, c.angle || 0);
        const p2 = rotatePt(cx, cy, cx + cSizeX/2, cy - cSizeY/2, c.angle || 0);
        const p3 = rotatePt(cx, cy, cx + cSizeX/2, cy + cSizeY/2, c.angle || 0);
        const p4 = rotatePt(cx, cy, cx - cSizeX/2, cy + cSizeY/2, c.angle || 0);
        
        customEntities += dxfLine(p1.x, p1.y, p2.x, p2.y, color);
        customEntities += dxfLine(p2.x, p2.y, p3.x, p3.y, color);
        customEntities += dxfLine(p3.x, p3.y, p4.x, p4.y, color);
        customEntities += dxfLine(p4.x, p4.y, p1.x, p1.y, color);
    }
    
    // 4. Piping Symbols
    const sSize = 140; // Equivalent to SYM_SIZE = 14
    for (const sym of pipingSymbols) {
        const cx = sym.dxfX, cy = sym.dxfY;
        const color = sym.color || '#06b6d4';
        const a = sym.angle || 0;
        
        const drawLine = (x1, y1, x2, y2) => {
            const p1 = rotatePt(cx, cy, cx + x1, cy + y1, a);
            const p2 = rotatePt(cx, cy, cx + x2, cy + y2, a);
            customEntities += dxfLine(p1.x, p1.y, p2.x, p2.y, color);
        };
        
        if (sym.type === 'tee') {
            drawLine(-sSize, 0, sSize, 0);
            drawLine(0, 0, 0, -sSize); // Y axis is inverted in canvas vs DXF? Actually, DXF Y is up. In our rotatePt, y is DXF y.
        } else if (sym.type === 'codo') {
            drawLine(-sSize, 0, 0, 0);
            drawLine(0, 0, 0, -sSize);
        } else if (sym.type === 'reductor') {
            drawLine(-sSize, -sSize*0.6, sSize, -sSize*0.35);
            drawLine(sSize, -sSize*0.35, sSize, sSize*0.35);
            drawLine(sSize, sSize*0.35, -sSize, sSize*0.6);
            drawLine(-sSize, sSize*0.6, -sSize, -sSize*0.6);
        } else if (sym.type === 'brida') {
            drawLine(-sSize*0.25, -sSize, -sSize*0.25, sSize);
            drawLine(sSize*0.25, -sSize, sSize*0.25, sSize);
        } else if (sym.type === 'tapon') {
            drawLine(-sSize, 0, 0, 0);
            drawLine(0, -sSize*0.7, 0, sSize*0.7);
        }
        
        // Add text label
        let label = sym.type === 'tapon' ? 'Tapón' : sym.type.charAt(0).toUpperCase() + sym.type.slice(1);
        if (sym.d1 && sym.d2) label += ` ${sym.d1}x${sym.d2}`;
        else if (sym.d1) label += ` ${sym.d1}`;
        else if (sym.d2) label += ` ${sym.d2}`;
        
        const pL = rotatePt(cx, cy, cx, cy + sSize + 50, a);
        customEntities += dxfText(label, pL.x, pL.y, 80, color);
    }
    
    // 2. Inject customEntities into rawDxfContent before the ENDSEC of ENTITIES
    const secStartIndex = rawDxfContent.toUpperCase().indexOf('ENTITIES');
    if (secStartIndex === -1) {
        alert('No se pudo encontrar la sección ENTITIES en el archivo original.');
        return;
    }
    
    // Find the next ENDSEC after ENTITIES
    const searchString = rawDxfContent.substring(secStartIndex);
    const endsecMatch = searchString.match(/0\s*(\r?\n)\s*ENDSEC/i);
    
    if (!endsecMatch) {
        alert('No se pudo encontrar el fin de la sección ENTITIES.');
        return;
    }
    
    const injectionIndex = secStartIndex + endsecMatch.index;
    
    // Construct final DXF string
    const finalDxf = rawDxfContent.substring(0, injectionIndex) 
                   + customEntities 
                   + rawDxfContent.substring(injectionIndex);
                   
    // Trigger download
    const blob = new Blob([finalDxf], { type: 'application/dxf' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = currentFileName ? currentFileName.replace('.dxf', '_modificado.dxf') : 'plano_modificado.dxf';
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
function requestDrawDxf() {
    if (!renderPending) {
        renderPending = true;
        requestAnimationFrame(() => {
            drawDxf();
            renderPending = false;
        });
    }
}

// ─── Drawing ───
function drawDxf() {
    if (!dxfData) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    
    ctx.translate(viewState.x, viewState.y);
    ctx.scale(viewState.scale, -viewState.scale);
    
    ctx.lineWidth = 1 / viewState.scale;
    
    for (const ent of dxfData.entities) {
        ctx.strokeStyle = getEntityColor(ent);
        drawEntity(ent);
    }
    
    ctx.restore();
    
    // Draw overlays (in screen coords)
    drawCouplings();
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
        
        const dFontSize = Math.max(8, 14 * scaleFactor);
        const dCrossSize = Math.max(3, 8 * scaleFactor);
        const dLineWidth = Math.max(1, 2 * scaleFactor);
        const dPad = Math.max(2, 6 * scaleFactor);
        
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
    if ((currentTool === 'measure' || currentTool.startsWith('sym-')) && currentSnapPoint) {
        ctx.save();
        const sp = dxfToScreen(currentSnapPoint.x, currentSnapPoint.y);
        ctx.strokeStyle = '#22c55e'; // Green for snap
        ctx.lineWidth = 2;
        const sSize = 5;
        ctx.strokeRect(sp.x - sSize, sp.y - sSize, sSize * 2, sSize * 2);
        ctx.restore();
    }
}

function findClosestSnapPoint(mouseDxfPt, maxScreenDist) {
    if (!dxfData || !dxfData.entities) return null;
    
    let closestPt = null;
    let minDistSq = Infinity;
    const maxDxfDistSq = Math.pow(maxScreenDist / viewState.scale, 2);
    
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
    }
    return closestPt;
}

function drawCross(x, y, size, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
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
        
        const d1Input = document.getElementById('float-d1');
        const d2Input = document.getElementById('float-d2');
        const d2Container = document.getElementById('float-d2-container');
        
        if (d1Input) d1Input.value = sym.d1 || '';
        
        if (sym.type === 'codo' || sym.type === 'tapon') {
            if (d2Container) d2Container.style.display = 'none';
        } else {
            if (d2Container) d2Container.style.display = 'block';
            if (d2Input) d2Input.value = sym.d2 || '';
        }
        
        const colorInput = document.getElementById('float-color');
        if (colorInput) colorInput.value = sym.color || '#06b6d4';
        
        renderRecentColors();
    } else {
        panel.style.display = 'none';
    }
}

document.getElementById('float-d1')?.addEventListener('change', (e) => {
    if (selectedSymbolIndex >= 0) {
        pipingSymbols[selectedSymbolIndex].d1 = e.target.value;
        saveAnnotations();
        requestDrawDxf();
    }
});

document.getElementById('float-d2')?.addEventListener('change', (e) => {
    if (selectedSymbolIndex >= 0) {
        pipingSymbols[selectedSymbolIndex].d2 = e.target.value;
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
        
        let scaleFactor = Math.min(1.0, viewState.scale / 15.0);
        if (isNaN(scaleFactor) || scaleFactor <= 0.01) scaleFactor = 1.0;
        ctx.scale(scaleFactor, scaleFactor);
        
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
        
        // Scale down symbol visually when zoomed out to avoid clutter
        let scaleFactor = Math.min(1.0, viewState.scale / 15.0);
        if (isNaN(scaleFactor) || scaleFactor <= 0.01) scaleFactor = 1.0;
        ctx.scale(scaleFactor, scaleFactor);
        
        const s = SYM_SIZE;
        
        ctx.beginPath();
        if (sym.type === 'tee') {
            ctx.moveTo(-s, 0); ctx.lineTo(s, 0);   // horizontal pipe
            ctx.moveTo(0, 0);  ctx.lineTo(0, s);    // branch down
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
        if (sym.type) {
            label = sym.type === 'tapon' ? 'Tapón' : sym.type.charAt(0).toUpperCase() + sym.type.slice(1);
        }
        if (sym.d1 && sym.d2) {
            label += ` ${sym.d1}x${sym.d2}`;
        } else if (sym.d1) {
            label += ` ${sym.d1}`;
        } else if (sym.d2) {
            label += ` ${sym.d2}`;
        }
        
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

function distSquared(v, w) {
    return (v.x - w.x)*(v.x - w.x) + (v.y - w.y)*(v.y - w.y);
}

// ─── Clear measurements ───
document.getElementById('btn-clear-measures')?.addEventListener('click', () => {
    measurements = [];
    measurePending = null;
    virtualCouplings.length = 0; // Clear couplings as well
    saveAnnotations();
    const infoMeasure = document.getElementById('info-measure');
    if (infoMeasure) infoMeasure.style.display = 'none';
    drawDxf();
});

// ─── Color Picker Logic ───
document.getElementById('measure-color-picker')?.addEventListener('input', (e) => {
    currentMeasureColor = e.target.value;
    
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
//  TOOL SWITCHING (exported for annotations.js)
// ══════════════════════════════════════════════════

// (Tool switching is handled via setToolChangeCallback)

// ══════════════════════════════════════════════════
//  BOM PANEL
// ══════════════════════════════════════════════════

document.getElementById('btn-bom')?.addEventListener('click', () => {
    if (!dxfData) {
        alert('Carga un archivo DXF primero.');
        return;
    }
    
    bomData = generateBOM(dxfData, virtualCouplings, pipingSymbols);
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

canvas.addEventListener('mousedown', (e) => {
    if (currentTool === 'measure') {
        handleMeasureClick(e);
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
        const dxfPt = currentSnapPoint ? { ...currentSnapPoint } : canvasToDxf(cx, cy);
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
        const pt = screenToDxf(e.clientX, e.clientY);
        currentMousePt = pt;
        
        const cx = document.getElementById('cursor-x');
        const cy = document.getElementById('cursor-y');
        if (cx) cx.textContent = `X: ${pt.x.toFixed(2)}`;
        if (cy) cy.textContent = `Y: ${pt.y.toFixed(2)}`;
        
        if (currentTool === 'measure' || currentTool.startsWith('sym-') || symDragging) {
            currentSnapPoint = findClosestSnapPoint(pt, 15); // 15px snap radius
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
