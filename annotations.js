import { jsPDF } from 'jspdf';

let fCanvas;
let currentMode = 'pan';

// Callback to notify main.js of tool changes (set externally to avoid circular imports)
let onToolChangeCallback = null;

export function getFabricObjects() {
    return fCanvas ? fCanvas.getObjects() : [];
}

export function setToolChangeCallback(cb) {
    onToolChangeCallback = cb;
}

export function setupAnnotations() {
    const canvasEl = document.getElementById('annotation-canvas');
    fCanvas = new fabric.Canvas(canvasEl, {
        isDrawingMode: false,
        selection: false,
        hoverCursor: 'default'
    });

    fCanvas.setBackgroundColor('transparent', fCanvas.renderAll.bind(fCanvas));

    // ─── Tool Buttons ───
    document.getElementById('btn-pan').addEventListener('click', (e) => setMode('pan', e.target.closest('.btn')));
    document.getElementById('btn-measure').addEventListener('click', (e) => setMode('measure', e.target.closest('.btn')));
    document.getElementById('btn-cople').addEventListener('click', (e) => setMode('cople', e.target.closest('.btn')));
    document.getElementById('btn-draw').addEventListener('click', (e) => setMode('draw', e.target.closest('.btn')));
    document.getElementById('btn-rect').addEventListener('click', (e) => setMode('rect', e.target.closest('.btn')));
    document.getElementById('btn-text').addEventListener('click', (e) => setMode('text', e.target.closest('.btn')));
    
    document.getElementById('btn-delete').addEventListener('click', (e) => setMode('delete', e.target.closest('.btn')));
    document.getElementById('btn-sum').addEventListener('click', (e) => setMode('sum', e.target.closest('.btn')));
    
    // ─── Symbols ───
    document.getElementById('btn-sym-tee').addEventListener('click', (e) => setMode('sym-tee', e.target.closest('.btn')));
    document.getElementById('btn-sym-tee-lat')?.addEventListener('click', (e) => setMode('sym-tee-lat', e.target.closest('.btn')));
    document.getElementById('btn-sym-codo').addEventListener('click', (e) => setMode('sym-codo', e.target.closest('.btn')));
    document.getElementById('btn-sym-reductor').addEventListener('click', (e) => setMode('sym-reductor', e.target.closest('.btn')));
    document.getElementById('btn-sym-brida').addEventListener('click', (e) => setMode('sym-brida', e.target.closest('.btn')));
    document.getElementById('btn-sym-tapon')?.addEventListener('click', (e) => setMode('sym-tapon', e.target.closest('.btn')));
    document.getElementById('btn-sym-move').addEventListener('click', (e) => setMode('sym-move', e.target.closest('.btn')));
    
    // Allow deleting Fabric objects with Backspace/Delete keys
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Delete' || e.key === 'Backspace') {
            const activeObjects = fCanvas.getActiveObjects();
            if (activeObjects.length) {
                // Prevent browser navigation for Backspace
                if (e.key === 'Backspace' && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                }
                fCanvas.discardActiveObject();
                activeObjects.forEach((obj) => fCanvas.remove(obj));
            }
        }
    });

    // Helper to merge canvases
    function getMergedCanvas() {
        const dxfCanvas = document.getElementById('dxf-canvas');
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = dxfCanvas.width;
        tempCanvas.height = dxfCanvas.height;
        const ctx = tempCanvas.getContext('2d');
        
        ctx.fillStyle = '#0f1117';
        ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
        ctx.drawImage(dxfCanvas, 0, 0);
        ctx.drawImage(fCanvas.getElement(), 0, 0);
        return tempCanvas;
    }

    document.getElementById('btn-export').addEventListener('click', () => {
        const tempCanvas = getMergedCanvas();
        const link = document.createElement('a');
        link.download = 'plano_anotado.png';
        link.href = tempCanvas.toDataURL('image/png');
        link.click();
    });



    // ─── Shape drawing (Rect) ───
    let isDrawingShape = false;
    let shapeStart = null;
    let currentShape = null;

    fCanvas.on('mouse:down', (o) => {
        if (currentMode === 'rect') {
            isDrawingShape = true;
            const pointer = fCanvas.getPointer(o.e);
            shapeStart = { x: pointer.x, y: pointer.y };
            currentShape = new fabric.Rect({
                left: pointer.x,
                top: pointer.y,
                width: 0,
                height: 0,
                fill: 'transparent',
                stroke: '#ef4444',
                strokeWidth: 3,
                strokeDashArray: [5, 5],
                selectable: true
            });
            fCanvas.add(currentShape);
        } else if (currentMode === 'text') {
            const pointer = fCanvas.getPointer(o.e);
            const text = new fabric.IText('Nota...', {
                left: pointer.x,
                top: pointer.y,
                fontFamily: 'Inter',
                fill: '#10b981',
                fontSize: 24,
                fontWeight: 'bold'
            });
            fCanvas.add(text);
            fCanvas.setActiveObject(text);
            text.enterEditing();
            text.selectAll();
            setMode('pan', document.getElementById('btn-pan'));
        }
    });

    fCanvas.on('mouse:move', (o) => {
        if (!isDrawingShape) return;
        const pointer = fCanvas.getPointer(o.e);
        
        if (currentMode === 'rect') {
            if (pointer.x < shapeStart.x) currentShape.set({ left: pointer.x });
            if (pointer.y < shapeStart.y) currentShape.set({ top: pointer.y });
            currentShape.set({
                width: Math.abs(pointer.x - shapeStart.x),
                height: Math.abs(pointer.y - shapeStart.y)
            });
            fCanvas.renderAll();
        }
    });

    fCanvas.on('mouse:up', () => {
        if (isDrawingShape) {
            isDrawingShape = false;
            if (currentShape && currentShape.width < 5 && currentShape.height < 5) {
                fCanvas.remove(currentShape);
            } else if (currentShape) {
                currentShape.setCoords();
            }
            currentShape = null;
        }
    });
    
    // Save DXF coordinates when a symbol is dragged
    fCanvas.on('object:modified', (e) => {
        const obj = e.target;
        if (obj && obj.isPipingSymbol && window.canvasToDxf) {
            const pt = window.canvasToDxf(obj.left, obj.top);
            obj.dxfX = pt.x;
            obj.dxfY = pt.y;
            // Base scale is preserved, only scale relative to viewState changes
        }
    });
}

// ─── Piping Symbols ───
// Called by main.js from the dxf-canvas click handler (canvas-relative coords)
export function placeSymbolAt(type, canvasX, canvasY) {
    if (!fCanvas || !window.canvasToDxf) return;
    
    const dxfPt = window.canvasToDxf(canvasX, canvasY);
    const color = '#06b6d4'; // Cyan default
    let obj;
    
    // We create simple SVG paths for symbols
    if (type === 'tee') {
        obj = new fabric.Path('M -15 0 L 15 0 M 0 0 L 0 20', { stroke: color, strokeWidth: 3, fill: 'transparent' });
    } else if (type === 'codo') {
        obj = new fabric.Path('M -10 -10 L -10 10 L 10 10', { stroke: color, strokeWidth: 3, fill: 'transparent' });
    } else if (type === 'reductor') {
        obj = new fabric.Polygon([ {x: -15, y: -10}, {x: 15, y: -5}, {x: 15, y: 5}, {x: -15, y: 10} ], { stroke: color, strokeWidth: 2, fill: 'transparent' });
    } else if (type === 'brida') {
        obj = new fabric.Path('M -5 -15 L -5 15 M 5 -15 L 5 15', { stroke: color, strokeWidth: 3, fill: 'transparent' });
    }
    
    if (obj) {
        obj.set({
            left: canvasX,
            top: canvasY,
            originX: 'center',
            originY: 'center',
            selectable: true,
            cornerColor: '#fbbf24',
            cornerStrokeColor: '#fbbf24',
            borderColor: '#fbbf24',
            transparentCorners: false,
            snapAngle: 90,
            snapThreshold: 10
        });
        
        obj.isPipingSymbol = true;
        obj.dxfX = dxfPt.x;
        obj.dxfY = dxfPt.y;
        obj.baseScaleX = obj.scaleX;
        obj.baseScaleY = obj.scaleY;
        
        if (window.viewStateScale) {
            obj.createdDxfScale = window.viewStateScale;
        }
        
        fCanvas.add(obj);
        fCanvas.setActiveObject(obj);
        fCanvas.renderAll();
    }
}

// Called by main.js during drawDxf()
window.syncFabricSymbols = function(currentScale) {
    if (!fCanvas) return;
    window.viewStateScale = currentScale;
    
    let needsRender = false;
    fCanvas.getObjects().forEach(obj => {
        if (obj.isPipingSymbol && obj.dxfX !== undefined && window.dxfToScreen) {
            const sp = window.dxfToScreen(obj.dxfX, obj.dxfY);
            
            // If scale changes, we want the symbol to scale with the drawing
            // But we have to relative to its creation scale
            let newScale = 1;
            if (obj.createdDxfScale) {
                newScale = currentScale / obj.createdDxfScale;
            }
            
            obj.set({ 
                left: sp.x, 
                top: sp.y,
                scaleX: (obj.baseScaleX || 1) * newScale,
                scaleY: (obj.baseScaleY || 1) * newScale
            });
            obj.setCoords();
            needsRender = true;
        }
    });
    
    if (needsRender) {
        fCanvas.renderAll();
    }
};

window.getFabricSymbolsData = function() {
    if (!fCanvas) return [];
    const symbols = [];
    fCanvas.getObjects().forEach(obj => {
        if (obj.isPipingSymbol) {
            symbols.push({
                type: obj.type, // fabric type
                path: obj.path, // for path objects
                points: obj.points, // for polygon
                dxfX: obj.dxfX,
                dxfY: obj.dxfY,
                angle: obj.angle,
                createdDxfScale: obj.createdDxfScale,
                baseScaleX: obj.baseScaleX,
                baseScaleY: obj.baseScaleY
            });
        }
    });
    return symbols;
};

window.loadFabricSymbolsData = function(symbolsData) {
    if (!fCanvas || !symbolsData || !window.dxfToScreen) return;
    
    symbolsData.forEach(data => {
        let obj;
        if (data.type === 'path' && data.path) {
            obj = new fabric.Path(data.path, {
                stroke: '#06b6d4', strokeWidth: 3, fill: 'transparent'
            });
        } else if (data.type === 'polygon' && data.points) {
            obj = new fabric.Polygon(data.points, {
                stroke: '#06b6d4', strokeWidth: 2, fill: 'transparent'
            });
        }
        
        if (obj) {
            const sp = window.dxfToScreen(data.dxfX, data.dxfY);
            obj.set({
                left: sp.x,
                top: sp.y,
                originX: 'center',
                originY: 'center',
                cornerColor: '#fbbf24',
                cornerStrokeColor: '#fbbf24',
                borderColor: '#fbbf24',
                transparentCorners: false,
                snapAngle: 90,
                snapThreshold: 10,
                angle: data.angle || 0
            });
            
            obj.isPipingSymbol = true;
            obj.dxfX = data.dxfX;
            obj.dxfY = data.dxfY;
            obj.createdDxfScale = data.createdDxfScale;
            obj.baseScaleX = data.baseScaleX;
            obj.baseScaleY = data.baseScaleY;
            
            fCanvas.add(obj);
        }
    });
    fCanvas.renderAll();
};

export function setMode(mode, btnElement) {
    currentMode = mode;
    
    // Notify main.js via callback (no circular import)
    if (onToolChangeCallback) onToolChangeCallback(mode);
    
    // UI Update
    document.querySelectorAll('.tool-btn').forEach(btn => btn.classList.remove('active'));
    if (btnElement) btnElement.classList.add('active');

    // Fabric state update
    fCanvas.isDrawingMode = (mode === 'draw');
    fCanvas.selection = (mode === 'pan');

    const fabricWrapper = document.querySelector('.canvas-container');
    
    if (mode === 'draw') {
        fCanvas.freeDrawingBrush.color = '#eab308';
        fCanvas.freeDrawingBrush.width = 4;
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'auto';
    } else if (mode === 'sym-move') {
        fCanvas.forEachObject(obj => obj.set('selectable', false));
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'none';
    } else if (mode === 'rect' || mode === 'text') {
        // rect/text need fabric to intercept the click
        fCanvas.forEachObject(obj => obj.set('selectable', false));
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'auto';
    } else {
        // pan, measure, cople, delete, sum, sym-tee/codo/reductor/brida
        // let clicks pass through to the DXF canvas
        fCanvas.forEachObject(obj => obj.set('selectable', mode === 'pan'));
        if (fabricWrapper) fabricWrapper.style.pointerEvents = 'none';
    }
}

export function resizeAnnotations(width, height) {
    if (fCanvas) {
        fCanvas.setWidth(width);
        fCanvas.setHeight(height);
        fCanvas.renderAll();
    }
}
