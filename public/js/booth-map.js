// ================= js/booth-map.js =================
window.boothMapEditor = window.boothMapEditor || {
    initialized: false,
    activeTab: 'editor',
    tool: 'select',
    viewBox: { x: 0, y: 0, width: 1600, height: 900 },
    previewViewBox: { x: 0, y: 0, width: 1600, height: 900 },
    selectedItemIds: [],
    pointerMode: '',
    pointerStartClient: null,
    pointerStartPoint: null,
    pointerStartViewBox: null,
    pointerStartItems: null,
    resizeContext: null,
    drawStartPoint: null,
    draftRect: null,
    polygonDraftPoints: [],
    polygonHoverPoint: null,
    polygonAxisLock: '',
    polygonLengthInput: '',
    selectionRect: null,
    marqueeAppend: false,
    dragMoved: false,
    scaleStartPoint: null,
    runtimeByBoothCode: {},
    snapEnabled: true,
    snapTolerance: 12,
    tempIdSeed: 1,
    removedPersistedCodes: [],
    presetDragKey: '',
    alignToolsExpanded: false,
    previewTextRulesExpanded: false,
    previewPointerMode: '',
    previewPointerStartClient: null,
    previewPointerStartViewBox: null,
    searchHighlightItemId: ''
};

window.getBoothMapState = function() {
    return window.boothMapEditor;
}

window.getBoothMapSvg = function() {
    return document.getElementById('booth-map-svg');
}

window.getBoothMapRuntimeSvg = function() {
    return document.getElementById('booth-map-runtime-svg');
}

window.getBoothMapBackgroundApiUrl = function(map = currentBoothMap) {
    if (!map?.background_image_key || !map?.id) return '';
    return `/api/booth-map-asset/${encodeURIComponent(map.background_image_key)}?mapId=${Number(map.id)}`;
}

window.getBoothMapProjectId = function() {
    return Number(document.getElementById('global-project-select')?.value || 0);
}

window.getBoothMapStrokeWidth = function() {
    const normalized = Number(currentBoothMap?.default_stroke_width || 2);
    if (!Number.isFinite(normalized)) return 2;
    return Number(Math.min(Math.max(normalized, 1), 12).toFixed(2));
}

window.getBoothMapSnapTolerance = function() {
    const normalized = Number(window.getBoothMapState().snapTolerance || 0);
    if (!Number.isFinite(normalized)) return 12;
    return Number(Math.min(Math.max(normalized, 0), 120).toFixed(0));
}

window.getBoothMapSvgPointFromElement = function(svg, event) {
    if (!svg) return { x: 0, y: 0 };
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(ctm.inverse());
    return {
        x: Number(transformed.x.toFixed(2)),
        y: Number(transformed.y.toFixed(2))
    };
}

window.getBoothMapViewportClientSize = function(target = 'editor') {
    const svg = target === 'preview' ? window.getBoothMapRuntimeSvg() : window.getBoothMapSvg();
    const fallback = target === 'preview'
        ? { width: 960, height: 640 }
        : { width: 1200, height: 760 };
    return {
        width: Math.max(Number(svg?.clientWidth || 0), fallback.width),
        height: Math.max(Number(svg?.clientHeight || 0), fallback.height)
    };
}

window.createBoothMapFitViewBox = function(canvasWidth, canvasHeight) {
    return window.clampBoothMapViewBox({
        x: 0,
        y: 0,
        width: Number(canvasWidth || 1600),
        height: Number(canvasHeight || 900)
    }, {
        canvas_width: Number(canvasWidth || 1600),
        canvas_height: Number(canvasHeight || 900)
    });
}

window.createBoothMapInitialViewBox = function(canvasWidth, canvasHeight, target = 'editor') {
    const safeCanvasWidth = Math.max(Number(canvasWidth || 1600), 1);
    const safeCanvasHeight = Math.max(Number(canvasHeight || 900), 1);
    const clientSize = window.getBoothMapViewportClientSize(target);
    const viewportRatio = clientSize.width / Math.max(clientSize.height, 1);
    const desiredEditorScale = target === 'editor' ? 2.2 : 1.6;
    let width = Math.min(safeCanvasWidth, clientSize.width * desiredEditorScale);
    let height = width / Math.max(viewportRatio, 0.01);
    if (height > safeCanvasHeight) {
        height = safeCanvasHeight;
        width = height * viewportRatio;
    }
    return window.clampBoothMapViewBox({
        x: 0,
        y: 0,
        width,
        height
    }, {
        canvas_width: safeCanvasWidth,
        canvas_height: safeCanvasHeight
    });
}

window.clampBoothMapViewBox = function(viewBox, map = currentBoothMap) {
    const canvasWidth = Number(map?.canvas_width || 1600);
    const canvasHeight = Number(map?.canvas_height || 900);
    const safeWidth = Math.min(Math.max(Number(viewBox?.width || canvasWidth), 180), canvasWidth * 4);
    const safeHeight = Math.min(Math.max(Number(viewBox?.height || canvasHeight), 120), canvasHeight * 4);
    const minX = Math.min(0, canvasWidth - safeWidth);
    const minY = Math.min(0, canvasHeight - safeHeight);
    return {
        x: Number(Math.min(Math.max(Number(viewBox?.x || 0), minX), canvasWidth).toFixed(2)),
        y: Number(Math.min(Math.max(Number(viewBox?.y || 0), minY), canvasHeight).toFixed(2)),
        width: Number(safeWidth.toFixed(2)),
        height: Number(safeHeight.toFixed(2))
    };
}

window.markBoothMapItemsDirty = function(itemIds = [], isDirty = true) {
    const idSet = new Set((Array.isArray(itemIds) ? itemIds : []).map((id) => String(id)));
    (currentBoothMapItems || []).forEach((item) => {
        if (idSet.has(String(item.id))) {
            item._dirty = !!isDirty;
        }
    });
}

window.markAllBoothMapItemsDirty = function(isDirty = true) {
    (currentBoothMapItems || []).forEach((item) => {
        item._dirty = !!isDirty;
    });
}

window.initializeBoothMapItemsState = function(items = []) {
    return (Array.isArray(items) ? items : []).map((item) => ({
        ...item,
        hall: window.normalizeHallLabel(item?.hall || ''),
        shape_type: String(item?.shape_type || 'rect').trim() || 'rect',
        points_json: Array.isArray(item?.points_json) ? item.points_json : [],
        area: Number(item?.area || 0),
        _dirty: false,
        _persistedBoothCode: window.normalizeBoothCode(item.booth_code)
    }));
}

window.cloneBoothMapLabelStyle = function(labelStyle) {
    return JSON.parse(JSON.stringify(labelStyle || {}));
}

window.getBoothMapItemSizePx = function(item) {
    const scale = window.getBoothMapScale() || 40;
    return {
        widthPx: Number((Number(item?.width_m || 0) * scale).toFixed(2)),
        heightPx: Number((Number(item?.height_m || 0) * scale).toFixed(2))
    };
}

window.getBoothMapItemBounds = function(item, overridePosition = null) {
    const { widthPx, heightPx } = window.getBoothMapItemSizePx(item);
    const x = Number(overridePosition?.x ?? item?.x ?? 0);
    const y = Number(overridePosition?.y ?? item?.y ?? 0);
    return {
        id: String(item?.id || ''),
        x,
        y,
        width: widthPx,
        height: heightPx,
        left: x,
        top: y,
        right: x + widthPx,
        bottom: y + heightPx,
        centerX: x + widthPx / 2,
        centerY: y + heightPx / 2
    };
}

window.getSelectedBoothMapItems = function() {
    const state = window.getBoothMapState();
    const selectedIds = new Set((state.selectedItemIds || []).map((id) => String(id)));
    return (currentBoothMapItems || []).filter((item) => selectedIds.has(String(item.id)));
}

window.findDuplicateBoothMapItemByCode = function(boothCode, excludeItemId = '') {
    const normalizedCode = window.normalizeBoothCode(boothCode);
    if (!normalizedCode) return null;
    const excluded = String(excludeItemId || '');
    return (currentBoothMapItems || []).find((item) => {
        if (String(item.id) === excluded) return false;
        return window.isSameBoothCode(item.booth_code, normalizedCode);
    }) || null;
}

window.getBoothMapSelectionCount = function() {
    return window.getSelectedBoothMapItems().length;
}

window.setSelectedBoothMapItems = function(itemIds = []) {
    const state = window.getBoothMapState();
    const existingIds = new Set((currentBoothMapItems || []).map((item) => String(item.id)));
    state.selectedItemIds = Array.from(new Set((Array.isArray(itemIds) ? itemIds : []).map((id) => String(id))))
        .filter((id) => existingIds.has(id));
    state.selectedItemId = state.selectedItemIds[0] || '';
}

window.isBoothMapItemSelected = function(itemId) {
    const selectedIds = new Set((window.getBoothMapState().selectedItemIds || []).map((id) => String(id)));
    return selectedIds.has(String(itemId));
}

window.syncBoothMapItemsStrokeWidth = function() {
    const strokeWidth = window.getBoothMapStrokeWidth();
    (currentBoothMapItems || []).forEach((item) => {
        item.stroke_width = strokeWidth;
    });
}

window.getBoothMapSelectionBounds = function(items, positionMap = {}) {
    const boundsList = (Array.isArray(items) ? items : [])
        .map((item) => window.getBoothMapItemBounds(item, positionMap[String(item.id)]))
        .filter(Boolean);
    if (boundsList.length === 0) return null;
    const left = Math.min(...boundsList.map((item) => item.left));
    const top = Math.min(...boundsList.map((item) => item.top));
    const right = Math.max(...boundsList.map((item) => item.right));
    const bottom = Math.max(...boundsList.map((item) => item.bottom));
    return {
        left,
        top,
        right,
        bottom,
        width: right - left,
        height: bottom - top,
        centerX: (left + right) / 2,
        centerY: (top + bottom) / 2
    };
}

window.getBoothMapSnapAdjustment = function(positionMap = {}) {
    const state = window.getBoothMapState();
    if (!state.snapEnabled || !currentBoothMap) return { dx: 0, dy: 0 };
    const selectedItems = window.getSelectedBoothMapItems();
    const selectionBounds = window.getBoothMapSelectionBounds(selectedItems, positionMap);
    if (!selectionBounds) return { dx: 0, dy: 0 };

    const selectedIds = new Set(selectedItems.map((item) => String(item.id)));
    const otherBounds = (currentBoothMapItems || [])
        .filter((item) => !selectedIds.has(String(item.id)))
        .map((item) => window.getBoothMapItemBounds(item));

    const tolerance = window.getBoothMapSnapTolerance();
    const xSources = [selectionBounds.left, selectionBounds.centerX, selectionBounds.right];
    const ySources = [selectionBounds.top, selectionBounds.centerY, selectionBounds.bottom];
    const xTargets = [0, Number(currentBoothMap.canvas_width || 1600) / 2, Number(currentBoothMap.canvas_width || 1600)];
    const yTargets = [0, Number(currentBoothMap.canvas_height || 900) / 2, Number(currentBoothMap.canvas_height || 900)];

    otherBounds.forEach((bounds) => {
        xTargets.push(bounds.left, bounds.centerX, bounds.right);
        yTargets.push(bounds.top, bounds.centerY, bounds.bottom);
    });

    let bestDx = 0;
    let bestDy = 0;
    let bestXDistance = tolerance + 1;
    let bestYDistance = tolerance + 1;

    xSources.forEach((source) => {
        xTargets.forEach((target) => {
            const delta = Number((target - source).toFixed(2));
            const distance = Math.abs(delta);
            if (distance <= tolerance && distance < bestXDistance) {
                bestXDistance = distance;
                bestDx = delta;
            }
        });
    });

    ySources.forEach((source) => {
        yTargets.forEach((target) => {
            const delta = Number((target - source).toFixed(2));
            const distance = Math.abs(delta);
            if (distance <= tolerance && distance < bestYDistance) {
                bestYDistance = distance;
                bestDy = delta;
            }
        });
    });

    return { dx: bestDx, dy: bestDy };
}

window.rotateBoothMapDeltaToLocal = function(dx, dy, rotationDeg) {
    const radians = (Number(rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: Number((dx * cos + dy * sin).toFixed(2)),
        y: Number((-dx * sin + dy * cos).toFixed(2))
    };
}

window.rotateBoothMapDeltaToGlobal = function(localDx, localDy, rotationDeg) {
    const radians = (Number(rotationDeg || 0) * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
        x: Number((localDx * cos - localDy * sin).toFixed(2)),
        y: Number((localDx * sin + localDy * cos).toFixed(2))
    };
}

window.validateBoothMapItems = function(itemsToValidate = [], options = {}) {
    const errors = [];
    const comparisonItems = Array.isArray(options.comparisonItems) ? options.comparisonItems : (currentBoothMapItems || []);
    const incomingIds = new Set((Array.isArray(itemsToValidate) ? itemsToValidate : []).map((item) => String(item.id)));
    const localSeenCodes = new Set();
    const comparisonCodeMap = new Map();
    comparisonItems.forEach((item) => {
        const boothCode = window.normalizeBoothCode(item.booth_code);
        if (!boothCode) return;
        if (!comparisonCodeMap.has(boothCode)) comparisonCodeMap.set(boothCode, []);
        comparisonCodeMap.get(boothCode).push(String(item.id));
    });

    (Array.isArray(itemsToValidate) ? itemsToValidate : []).forEach((item) => {
        const boothCode = window.normalizeBoothCode(item.booth_code);
        const hall = window.normalizeHallLabel(window.resolveBoothMapHallValue ? window.resolveBoothMapHallValue(item) : (item.hall || ''));
        const boothType = String(item.booth_type || '').trim();
        if (!boothCode || boothCode.startsWith('TMP-')) {
            errors.push('请先为当前展位填写正式展位号');
            return;
        }
        if (localSeenCodes.has(boothCode)) {
            errors.push(`展位号重复：${boothCode}`);
            return;
        }
        localSeenCodes.add(boothCode);
        const duplicateIds = (comparisonCodeMap.get(boothCode) || []).filter((id) => id !== String(item.id) && !incomingIds.has(id));
        if (duplicateIds.length > 0) {
            errors.push(`展位号重复：${boothCode}`);
            return;
        }
        if (!hall) errors.push(`展位 ${boothCode} 缺少馆号`);
        if (!Number(item.width_m || 0) || !Number(item.height_m || 0)) {
            errors.push(`展位 ${boothCode} 的长宽必须大于 0`);
        }
        if (boothType !== '光地' && !String(item.opening_type || '').trim()) {
            errors.push('标摊或豪标必须选择开口类型');
        }
        if (boothType === '光地' && String(item.opening_type || '').trim()) {
            errors.push('光地不允许设置开口类型');
        }
    });

    return Array.from(new Set(errors));
}

window.escapeBoothMapText = function(text) {
    return window.escapeHtml ? window.escapeHtml(text) : String(text || '');
}

window.BOOTH_MAP_TEXT_FONT_FAMILY = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC","Source Han Sans SC",sans-serif';

window.getBoothMapTextFontFamily = function() {
    return window.BOOTH_MAP_TEXT_FONT_FAMILY;
}

window.measureBoothMapText = function(text, fontSize, letterSpacingEm = 0) {
    window.boothMapMeasureCanvas = window.boothMapMeasureCanvas || document.createElement('canvas');
    const ctx = window.boothMapMeasureCanvas.getContext('2d');
    const normalized = String(text || '');
    ctx.font = `${Number(fontSize || 12)}px ${window.getBoothMapTextFontFamily()}`;
    const baseWidth = ctx.measureText(normalized).width;
    if (!normalized || normalized.length <= 1 || !Number.isFinite(Number(letterSpacingEm))) return baseWidth;
    return baseWidth + (normalized.length - 1) * Number(fontSize || 12) * Number(letterSpacingEm || 0);
}

window.fitBoothMapSingleLine = function(text, fontSize, maxWidth, letterSpacingEm = 0) {
    const normalized = String(text || '').trim();
    if (!normalized) return '';
    if (window.measureBoothMapText(normalized, fontSize, letterSpacingEm) <= maxWidth) return normalized;
    let output = normalized;
    while (output.length > 1 && window.measureBoothMapText(`${output}…`, fontSize, letterSpacingEm) > maxWidth) {
        output = output.slice(0, -1);
    }
    return `${output}…`;
}

window.fitBoothMapCompanyLines = function(text, fontSize, maxWidth, maxLines = 2, letterSpacingEm = 0) {
    const normalized = String(text || '').trim();
    if (!normalized) return [];
    const chars = Array.from(normalized);
    const lines = [];
    let currentLine = '';
    chars.forEach((char) => {
        const candidate = currentLine + char;
        if (!currentLine || window.measureBoothMapText(candidate, fontSize, letterSpacingEm) <= maxWidth) {
            currentLine = candidate;
            return;
        }
        lines.push(currentLine);
        currentLine = char;
    });
    if (currentLine) lines.push(currentLine);
    if (lines.length <= maxLines) return lines;
    const output = lines.slice(0, maxLines);
    output[maxLines - 1] = window.fitBoothMapSingleLine(output[maxLines - 1] + lines.slice(maxLines).join(''), fontSize, maxWidth, letterSpacingEm);
    return output;
}

window.fitBoothMapCompanyBlock = function(text, fontSize, maxWidth, maxHeight, maxLines = 2, letterSpacingEm = 0) {
    const safeWidth = Math.max(Number(maxWidth || 0), 18);
    const safeHeight = Math.max(Number(maxHeight || 0), 12);
    let nextFontSize = Math.max(Number(fontSize || 12), 1);
    while (nextFontSize >= 1) {
        const lines = window.fitBoothMapCompanyLines(text, nextFontSize, safeWidth, maxLines, letterSpacingEm);
        const lineHeight = nextFontSize * 0.98;
        if (lines.length * lineHeight <= safeHeight || nextFontSize <= 1) {
            return {
                lines,
                fontSize: Number(nextFontSize.toFixed(2)),
                lineHeight: Number(lineHeight.toFixed(2))
            };
        }
        nextFontSize -= 1;
    }
    return {
        lines: [],
        fontSize: 1,
        lineHeight: 0.98
    };
}

window.fitBoothMapSingleLineBlock = function(text, fontSize, maxWidth, maxHeight, letterSpacingEm = 0, minFontSize = 1) {
    const normalized = String(text || '').trim();
    const safeWidth = Math.max(Number(maxWidth || 0), 8);
    const safeHeight = Math.max(Number(maxHeight || 0), 6);
    let nextFontSize = Math.max(Number(fontSize || 12), Number(minFontSize || 1));
    while (nextFontSize >= Number(minFontSize || 1)) {
        const lineHeight = nextFontSize * 0.98;
        const fullFits = window.measureBoothMapText(normalized, nextFontSize, letterSpacingEm) <= safeWidth && lineHeight <= safeHeight;
        if (fullFits || nextFontSize <= Number(minFontSize || 1)) {
            const textValue = fullFits ? normalized : window.fitBoothMapSingleLine(normalized, nextFontSize, safeWidth, letterSpacingEm);
            return {
                text: textValue,
                fontSize: Number(nextFontSize.toFixed(2)),
                lineHeight: Number(lineHeight.toFixed(2))
            };
        }
        nextFontSize = Number((nextFontSize - 0.5).toFixed(2));
    }
    return {
        text: window.fitBoothMapSingleLine(normalized, Number(minFontSize || 1), safeWidth, letterSpacingEm),
        fontSize: Number(Number(minFontSize || 1).toFixed(2)),
        lineHeight: Number((Number(minFontSize || 1) * 0.98).toFixed(2))
    };
}

window.getBoothMapRuntimeItem = function(boothCode) {
    const state = window.getBoothMapState();
    return state.runtimeByBoothCode[window.normalizeBoothCode(boothCode)] || null;
}

window.createDefaultBoothMapLabelStyle = function(widthPx, heightPx) {
    const shortSide = Math.max(Math.min(Number(widthPx || 0), Number(heightPx || 0)), 32);
    return {
        boothNo: {
            anchorX: 0.5,
            anchorY: 0.2,
            fontSize: Math.max(1, Math.min(Math.round(shortSide * 0.18), 26)),
            rotation: 0,
            visible: true
        },
        company: {
            anchorX: 0.5,
            anchorY: 0.58,
            fontSize: Math.max(1, Math.min(Math.round(shortSide * 0.14), 24)),
            rotation: widthPx / Math.max(heightPx, 1) <= 0.8 ? 90 : 0,
            visible: true
        }
    };
}

window.normalizeBoothMapLabelStyle = function(labelStyle, widthPx, heightPx) {
    const defaults = window.createDefaultBoothMapLabelStyle(widthPx, heightPx);
    const safeStyle = labelStyle && typeof labelStyle === 'object' ? labelStyle : {};
    const clamp = (value, min, max, fallback) => {
        const normalized = Number(value);
        if (!Number.isFinite(normalized)) return fallback;
        return Math.min(Math.max(normalized, min), max);
    };
    const normalizeBlock = (blockKey) => {
        const raw = safeStyle[blockKey] && typeof safeStyle[blockKey] === 'object' ? safeStyle[blockKey] : {};
        const fallback = defaults[blockKey];
        return {
            anchorX: Number(clamp(raw.anchorX, 0.05, 0.95, fallback.anchorX).toFixed(3)),
            anchorY: Number(clamp(raw.anchorY, 0.05, 0.95, fallback.anchorY).toFixed(3)),
            fontSize: Number(clamp(raw.fontSize, 1, 36, fallback.fontSize).toFixed(2)),
            rotation: Number(clamp(raw.rotation, -180, 180, fallback.rotation).toFixed(2)),
            visible: raw.visible === undefined ? true : Number(raw.visible) !== 0
        };
    };
    return {
        boothNo: normalizeBlock('boothNo'),
        company: normalizeBlock('company')
    };
}

window.createDefaultBoothMapDisplayConfig = function(map = currentBoothMap) {
    return {
        background: {
            boxX: 0,
            boxY: 0,
            boxWidth: Number(map?.canvas_width || 1600),
            boxHeight: Number(map?.canvas_height || 900),
            naturalWidth: 0,
            naturalHeight: 0
        },
        standard: {
            boothNo: { anchorX: 0.02, anchorY: 0.93, fontSize: 18, visible: true },
            company: { anchorX: 0.5, anchorY: 0.5, fontSize: 14, visible: true }
        },
        ground: {
            boothNo: { anchorX: 0.02, anchorY: 0.93, fontSize: 20, visible: true },
            company: { anchorX: 0.5, anchorY: 0.5, fontSize: 16, visible: true },
            size: { anchorX: 0.98, anchorY: 0.02, fontSize: 13, visible: true }
        }
    };
}

window.normalizeBoothMapDisplayConfig = function(rawConfig, map = currentBoothMap) {
    const defaults = window.createDefaultBoothMapDisplayConfig(map);
    const safeConfig = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
    const isNear = (value, target, tolerance = 0.015) => Math.abs(Number(value) - Number(target)) <= tolerance;
    const getAnchorBounds = (blockKey, axis) => {
        if (axis === 'x' && blockKey === 'boothNo') return { min: -0.05, max: 0.95 };
        if (axis === 'x' && blockKey === 'size') return { min: 0.05, max: 1.05 };
        if (axis === 'y' && blockKey === 'size') return { min: -0.2, max: 0.95 };
        if (axis === 'y' && blockKey === 'boothNo') return { min: 0.05, max: 1.6 };
        return { min: 0.05, max: 0.95 };
    };
    const normalizeBlock = (source, fallback, blockKey = '', legacyDefaults = null) => {
        const rawAnchorX = Number(source?.anchorX);
        const rawAnchorY = Number(source?.anchorY);
        const shouldMigrateLegacyPosition = legacyDefaults
            && Number.isFinite(rawAnchorX)
            && Number.isFinite(rawAnchorY)
            && isNear(rawAnchorX, legacyDefaults.anchorX)
            && isNear(rawAnchorY, legacyDefaults.anchorY);
        const effectiveAnchorX = shouldMigrateLegacyPosition ? fallback.anchorX : (source?.anchorX ?? fallback.anchorX);
        const effectiveAnchorY = shouldMigrateLegacyPosition ? fallback.anchorY : (source?.anchorY ?? fallback.anchorY);
        const anchorXBounds = getAnchorBounds(blockKey, 'x');
        const anchorYBounds = getAnchorBounds(blockKey, 'y');
        return {
            anchorX: Number(Math.min(Math.max(Number(effectiveAnchorX), anchorXBounds.min), anchorXBounds.max).toFixed(3)),
            anchorY: Number(Math.min(Math.max(Number(effectiveAnchorY), anchorYBounds.min), anchorYBounds.max).toFixed(3)),
            fontSize: Number(Math.min(Math.max(Number(source?.fontSize ?? fallback.fontSize), 1), 36).toFixed(2)),
            visible: source?.visible === undefined ? fallback.visible : Number(source.visible) !== 0
        };
    };
    const canvasWidth = Number(map?.canvas_width || 1600);
    const canvasHeight = Number(map?.canvas_height || 900);
    const rawBackground = safeConfig.background && typeof safeConfig.background === 'object' ? safeConfig.background : {};
    const boxX = Number(rawBackground.boxX);
    const boxY = Number(rawBackground.boxY);
    const boxWidth = Number(rawBackground.boxWidth);
    const boxHeight = Number(rawBackground.boxHeight);
    const naturalWidth = Number(rawBackground.naturalWidth);
    const naturalHeight = Number(rawBackground.naturalHeight);
    const normalizedNaturalWidth = Math.max(Number.isFinite(naturalWidth) ? naturalWidth : defaults.background.naturalWidth, 0);
    const normalizedNaturalHeight = Math.max(Number.isFinite(naturalHeight) ? naturalHeight : defaults.background.naturalHeight, 0);
    const normalizedBoxX = Number.isFinite(boxX) ? boxX : defaults.background.boxX;
    const normalizedBoxY = Number.isFinite(boxY) ? boxY : defaults.background.boxY;
    let normalizedBoxWidth = Math.max(Number.isFinite(boxWidth) ? boxWidth : defaults.background.boxWidth, 1);
    let normalizedBoxHeight = Math.max(Number.isFinite(boxHeight) ? boxHeight : defaults.background.boxHeight, 1);
    const shouldExpandLegacyBackgroundBox = normalizedNaturalWidth > 0
        && normalizedNaturalHeight > 0
        && Math.abs(canvasWidth - normalizedNaturalWidth) <= 2
        && Math.abs(canvasHeight - normalizedNaturalHeight) <= 2
        && Math.abs(normalizedBoxX) <= 1
        && Math.abs(normalizedBoxY) <= 1
        && normalizedBoxWidth < canvasWidth * 0.75
        && normalizedBoxHeight < canvasHeight * 0.75;
    if (shouldExpandLegacyBackgroundBox) {
        normalizedBoxWidth = canvasWidth;
        normalizedBoxHeight = canvasHeight;
    }
    return {
        background: {
            boxX: Number(normalizedBoxX.toFixed(2)),
            boxY: Number(normalizedBoxY.toFixed(2)),
            boxWidth: Number(normalizedBoxWidth.toFixed(2)),
            boxHeight: Number(normalizedBoxHeight.toFixed(2)),
            naturalWidth: Number(normalizedNaturalWidth.toFixed(2)),
            naturalHeight: Number(normalizedNaturalHeight.toFixed(2)),
            canvasWidth: Number(canvasWidth.toFixed(2)),
            canvasHeight: Number(canvasHeight.toFixed(2))
        },
        standard: {
            boothNo: normalizeBlock(safeConfig.standard?.boothNo, defaults.standard.boothNo, 'boothNo', { anchorX: 0.07, anchorY: 0.93 }),
            company: normalizeBlock(safeConfig.standard?.company, defaults.standard.company, 'company', { anchorX: 0.5, anchorY: 0.6 })
        },
        ground: {
            boothNo: normalizeBlock(safeConfig.ground?.boothNo, defaults.ground.boothNo, 'boothNo', { anchorX: 0.07, anchorY: 0.93 }),
            company: normalizeBlock(safeConfig.ground?.company, defaults.ground.company, 'company', { anchorX: 0.5, anchorY: 0.58 }),
            size: normalizeBlock(safeConfig.ground?.size, defaults.ground.size, 'size', { anchorX: 0.93, anchorY: 0.08 })
        }
    };
}

window.ensureCurrentBoothMapDisplayConfig = function() {
    if (!currentBoothMap) return window.createDefaultBoothMapDisplayConfig();
    currentBoothMap.display_config = window.normalizeBoothMapDisplayConfig(currentBoothMap.display_config, currentBoothMap);
    return currentBoothMap.display_config;
}

window.getBoothMapBackgroundConfig = function(map = currentBoothMap) {
    if (!map) return window.createDefaultBoothMapDisplayConfig().background;
    map.display_config = window.normalizeBoothMapDisplayConfig(map.display_config, map);
    return map.display_config.background;
}

window.getBoothMapRenderedBackgroundRect = function(map = currentBoothMap) {
    const config = window.getBoothMapBackgroundConfig(map);
    const boxX = Number(config.boxX || 0);
    const boxY = Number(config.boxY || 0);
    const boxWidth = Math.max(Number(config.boxWidth || 0), 1);
    const boxHeight = Math.max(Number(config.boxHeight || 0), 1);
    const naturalWidth = Number(config.naturalWidth || 0);
    const naturalHeight = Number(config.naturalHeight || 0);
    if (naturalWidth <= 0 || naturalHeight <= 0) {
        return {
            x: boxX,
            y: boxY,
            width: boxWidth,
            height: boxHeight
        };
    }
    const scale = Math.min(boxWidth / naturalWidth, boxHeight / naturalHeight);
    const width = naturalWidth * scale;
    const height = naturalHeight * scale;
    return {
        x: Number((boxX + ((boxWidth - width) / 2)).toFixed(2)),
        y: Number((boxY + ((boxHeight - height) / 2)).toFixed(2)),
        width: Number(width.toFixed(2)),
        height: Number(height.toFixed(2))
    };
}

window.updateBoothMapBackgroundFromImageMeta = function(imageMeta = {}, options = {}) {
    if (!currentBoothMap) return;
    const keepPlacement = options.keepPlacement !== false;
    const config = window.ensureCurrentBoothMapDisplayConfig();
    const background = window.getBoothMapBackgroundConfig(currentBoothMap);
    const canvasWidth = Number(currentBoothMap.canvas_width || 1600);
    const canvasHeight = Number(currentBoothMap.canvas_height || 900);
    const naturalWidth = Math.max(Number(imageMeta.width || 0), 0);
    const naturalHeight = Math.max(Number(imageMeta.height || 0), 0);
    const hadPlacement = Number(background.naturalWidth || 0) > 0 && Number(background.naturalHeight || 0) > 0;
    config.background = {
        boxX: keepPlacement && hadPlacement ? Number(background.boxX || 0) : 0,
        boxY: keepPlacement && hadPlacement ? Number(background.boxY || 0) : 0,
        boxWidth: keepPlacement && hadPlacement ? Number(background.boxWidth || canvasWidth) : canvasWidth,
        boxHeight: keepPlacement && hadPlacement ? Number(background.boxHeight || canvasHeight) : canvasHeight,
        naturalWidth,
        naturalHeight
    };
    currentBoothMap.display_config = window.normalizeBoothMapDisplayConfig(config);
    window.setBoothMapDirty(true);
}

window.remapBoothMapCalibrationToNaturalCanvas = function(previousRect, imageMeta = {}) {
    if (!currentBoothMap?.calibration_json?.start || !currentBoothMap?.calibration_json?.end) return;
    const rectWidth = Math.max(Number(previousRect?.width || 0), 1);
    const rectHeight = Math.max(Number(previousRect?.height || 0), 1);
    const naturalWidth = Math.max(Number(imageMeta.width || 0), 1);
    const naturalHeight = Math.max(Number(imageMeta.height || 0), 1);
    const mapPoint = (point) => ({
        x: Number((((Number(point?.x || 0) - Number(previousRect?.x || 0)) / rectWidth) * naturalWidth).toFixed(2)),
        y: Number((((Number(point?.y || 0) - Number(previousRect?.y || 0)) / rectHeight) * naturalHeight).toFixed(2))
    });
    currentBoothMap.calibration_json = {
        ...currentBoothMap.calibration_json,
        start: mapPoint(currentBoothMap.calibration_json.start),
        end: mapPoint(currentBoothMap.calibration_json.end)
    };
}

window.migrateBoothMapWorkspaceToNaturalImage = function(previousRect, imageMeta = {}) {
    if (!currentBoothMap || !previousRect) return;
    const rectWidth = Math.max(Number(previousRect.width || 0), 1);
    const rectHeight = Math.max(Number(previousRect.height || 0), 1);
    const naturalWidth = Math.max(Number(imageMeta.width || 0), 320);
    const naturalHeight = Math.max(Number(imageMeta.height || 0), 320);
    const mapX = (value) => Number((((Number(value || 0) - Number(previousRect.x || 0)) / rectWidth) * naturalWidth).toFixed(2));
    const mapY = (value) => Number((((Number(value || 0) - Number(previousRect.y || 0)) / rectHeight) * naturalHeight).toFixed(2));

    const oldCalibration = currentBoothMap.calibration_json && typeof currentBoothMap.calibration_json === 'object'
        ? currentBoothMap.calibration_json
        : {};
    const oldStart = oldCalibration.start;
    const oldEnd = oldCalibration.end;
    let nextScale = Number(currentBoothMap.scale_pixels_per_meter || 0);
    if (oldStart && oldEnd && Number(oldCalibration.meters || 0) > 0) {
        const nextStart = { x: mapX(oldStart.x), y: mapY(oldStart.y) };
        const nextEnd = { x: mapX(oldEnd.x), y: mapY(oldEnd.y) };
        const nextDistance = Math.hypot(nextEnd.x - nextStart.x, nextEnd.y - nextStart.y);
        nextScale = Number((nextDistance / Number(oldCalibration.meters || 1)).toFixed(4));
        currentBoothMap.calibration_json = {
            ...oldCalibration,
            start: nextStart,
            end: nextEnd
        };
    }

    currentBoothMap.canvas_width = naturalWidth;
    currentBoothMap.canvas_height = naturalHeight;
    if (nextScale > 0) {
        currentBoothMap.scale_pixels_per_meter = nextScale;
    }

    (currentBoothMapItems || []).forEach((item) => {
        item.x = mapX(item.x);
        item.y = mapY(item.y);
        item._dirty = true;
    });

    const state = window.getBoothMapState();
    state.viewBox = window.createBoothMapInitialViewBox(naturalWidth, naturalHeight, 'editor');
    state.previewViewBox = {
        x: 0,
        y: 0,
        width: Number(naturalWidth.toFixed(2)),
        height: Number(naturalHeight.toFixed(2))
    };
}

window.readImageFileMeta = function(file) {
    return new Promise((resolve, reject) => {
        if (!(file instanceof File)) {
            reject(new Error('未读取到有效图片文件'));
            return;
        }
        const objectUrl = URL.createObjectURL(file);
        const image = new Image();
        image.onload = function() {
            const result = {
                width: Number(image.naturalWidth || image.width || 0),
                height: Number(image.naturalHeight || image.height || 0)
            };
            URL.revokeObjectURL(objectUrl);
            resolve(result);
        };
        image.onerror = function() {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('底图尺寸读取失败'));
        };
        image.src = objectUrl;
    });
}

window.getBoothMapDisplayConfigForMap = function(map = null) {
    if (!map) return window.ensureCurrentBoothMapDisplayConfig();
    map.display_config = window.normalizeBoothMapDisplayConfig(map.display_config, map);
    return map.display_config;
}

window.mergeBoothMapTextBlock = function(baseBlock, overrideBlock = null) {
    const fallback = baseBlock && typeof baseBlock === 'object' ? baseBlock : {};
    const override = overrideBlock && typeof overrideBlock === 'object' ? overrideBlock : {};
    return {
        ...fallback,
        anchorX: Number.isFinite(Number(override.anchorX)) ? Number(override.anchorX) : Number(fallback.anchorX ?? 0.5),
        anchorY: Number.isFinite(Number(override.anchorY)) ? Number(override.anchorY) : Number(fallback.anchorY ?? 0.5),
        fontSize: Number.isFinite(Number(override.fontSize)) ? Number(override.fontSize) : Number(fallback.fontSize ?? 12),
        rotation: Number.isFinite(Number(override.rotation)) ? Number(override.rotation) : Number(fallback.rotation ?? 0),
        visible: override.visible === undefined ? (fallback.visible !== false) : Number(override.visible) !== 0
    };
}

window.getBoothMapTextConfigForItem = function(item, map = null) {
    const config = window.getBoothMapDisplayConfigForMap(map);
    return window.cloneBoothMapLabelStyle(
        String(item?.booth_type || '').trim() === '光地' ? config.ground : config.standard
    ) || {};
}

window.extractHallFromBoothMapName = function(name) {
    return window.resolveHallFromMapName(name);
}

window.resolveBoothMapHallValue = function(item) {
    const itemHall = window.normalizeHallLabel(item?.hall || '');
    if (itemHall) return itemHall;
    const currentMapHall = window.extractHallFromBoothMapName(currentBoothMap?.name || '');
    if (currentMapHall) return currentMapHall;
    return window.normalizeHallLabel(currentBoothMap?.name || '');
}

window.getBoothMapDefaultShapeRatios = function(shapeType) {
    if (shapeType === 'trapezoid') {
        return [
            { x: 0.15, y: 0 },
            { x: 0.85, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ];
    }
    return [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
    ];
}

window.getBoothMapNormalizedPoints = function(item) {
    const rawPoints = Array.isArray(item?.points_json) ? item.points_json : [];
    const normalized = rawPoints
        .map((point) => ({
            x: Number(point?.x),
            y: Number(point?.y)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (normalized.length >= 3) return normalized;
    return window.getBoothMapDefaultShapeRatios(String(item?.shape_type || 'rect').trim());
}

window.getBoothMapLocalPoints = function(item, widthPx = null, heightPx = null) {
    const size = widthPx === null || heightPx === null ? window.getBoothMapItemSizePx(item) : { widthPx, heightPx };
    return window.getBoothMapNormalizedPoints(item).map((point) => ({
        x: Number((point.x * size.widthPx).toFixed(2)),
        y: Number((point.y * size.heightPx).toFixed(2))
    }));
}

window.getBoothMapPointsMarkup = function(points) {
    return (Array.isArray(points) ? points : []).map((point) => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`).join(' ');
}

window.calculateBoothMapPolygonAreaRatio = function(points) {
    const normalized = Array.isArray(points) ? points : [];
    if (normalized.length < 3) return 1;
    let sum = 0;
    normalized.forEach((point, index) => {
        const next = normalized[(index + 1) % normalized.length];
        sum += Number(point.x || 0) * Number(next.y || 0) - Number(next.x || 0) * Number(point.y || 0);
    });
    return Number((Math.abs(sum) / 2).toFixed(6));
}

window.getBoothMapAreaRatioForItem = function(item) {
    return window.calculateBoothMapPolygonAreaRatio(window.getBoothMapNormalizedPoints(item));
}

window.calculateBoothMapItemArea = function(item) {
    const widthMeters = Number(item?.width_m || 0);
    const heightMeters = Number(item?.height_m || 0);
    if (!Number.isFinite(widthMeters) || !Number.isFinite(heightMeters) || widthMeters <= 0 || heightMeters <= 0) {
        return 0;
    }
    return Number((widthMeters * heightMeters * window.getBoothMapAreaRatioForItem(item)).toFixed(2));
}

window.formatBoothMapMetricText = function(value) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return '0';
    return String(Number(normalized.toFixed(2)));
}

window.clearBoothMapPolygonDraft = function() {
    const state = window.getBoothMapState();
    state.polygonDraftPoints = [];
    state.polygonHoverPoint = null;
    state.polygonAxisLock = '';
    state.polygonLengthInput = '';
}

window.updateBoothMapPolygonStatus = function() {
    const state = window.getBoothMapState();
    const statusEl = document.getElementById('booth-map-polygon-status');
    if (!statusEl) return;
    if (state.tool !== 'polygon') {
        statusEl.innerText = '自由多边形：Shift 保持水平/垂直，H/V 锁定方向，A 取消锁定，输入数字后回车可按米数落点。';
        return;
    }
    const axisText = state.polygonAxisLock === 'horizontal'
        ? '当前锁定：水平'
        : (state.polygonAxisLock === 'vertical' ? '当前锁定：垂直' : '当前锁定：自动');
    const lengthText = state.polygonLengthInput ? `，待输入边长：${state.polygonLengthInput}m` : '';
    statusEl.innerText = `${axisText}${lengthText}。Shift 保持水平/垂直，H/V 切换方向，A 取消锁定，输入数字后回车可按米数落点。`;
}

window.getBoothMapConstrainedPolygonPoint = function(rawPoint, options = {}) {
    const state = window.getBoothMapState();
    const draftPoints = Array.isArray(state.polygonDraftPoints) ? state.polygonDraftPoints : [];
    const lastPoint = draftPoints[draftPoints.length - 1];
    const nextPoint = {
        x: Number(rawPoint?.x || 0),
        y: Number(rawPoint?.y || 0)
    };
    if (!lastPoint) return nextPoint;
    const axisLock = options.axisLock || state.polygonAxisLock || '';
    if (axisLock === 'horizontal') {
        nextPoint.y = lastPoint.y;
        return nextPoint;
    }
    if (axisLock === 'vertical') {
        nextPoint.x = lastPoint.x;
        return nextPoint;
    }
    if (options.constrainAxis) {
        const dx = Math.abs(nextPoint.x - lastPoint.x);
        const dy = Math.abs(nextPoint.y - lastPoint.y);
        if (dx >= dy) nextPoint.y = lastPoint.y;
        else nextPoint.x = lastPoint.x;
    }
    return nextPoint;
}

window.commitBoothMapPolygonPoint = function(rawPoint, options = {}) {
    const state = window.getBoothMapState();
    const constrainedPoint = window.getBoothMapConstrainedPolygonPoint(rawPoint, options);
    state.polygonDraftPoints = [...(state.polygonDraftPoints || []), constrainedPoint];
    state.polygonHoverPoint = null;
    state.polygonLengthInput = '';
    window.updateBoothMapPolygonStatus();
    return constrainedPoint;
}

window.placeBoothMapPolygonPointByLength = function() {
    const state = window.getBoothMapState();
    const draftPoints = Array.isArray(state.polygonDraftPoints) ? state.polygonDraftPoints : [];
    if (draftPoints.length === 0) return window.showToast('请先落下起点，再输入边长', 'error');
    const meters = Number(state.polygonLengthInput);
    if (!Number.isFinite(meters) || meters <= 0) return window.showToast('请输入有效的边长（米）', 'error');
    const lastPoint = draftPoints[draftPoints.length - 1];
    const hoverPoint = state.polygonHoverPoint;
    if (!hoverPoint) return window.showToast('请先移动鼠标确定方向，再输入边长', 'error');
    const dx = Number(hoverPoint.x || 0) - Number(lastPoint.x || 0);
    const dy = Number(hoverPoint.y || 0) - Number(lastPoint.y || 0);
    const distance = Math.hypot(dx, dy);
    const scale = window.getBoothMapScale();
    if (distance <= 0 || scale <= 0) return window.showToast('请先移动鼠标确定方向，再输入边长', 'error');
    const lengthPx = meters * scale;
    const nextPoint = {
        x: Number((lastPoint.x + (dx / distance) * lengthPx).toFixed(2)),
        y: Number((lastPoint.y + (dy / distance) * lengthPx).toFixed(2))
    };
    window.commitBoothMapPolygonPoint(nextPoint, { axisLock: state.polygonAxisLock });
    window.renderCurrentBoothMap();
    window.showToast(`已按 ${window.formatBoothMapMetricText(meters)} 米落点`);
}

window.handleBoothMapEditorKeydown = function(event) {
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const state = window.getBoothMapState();
    if (state.tool !== 'polygon') return;
    const key = String(event.key || '').toLowerCase();
    if (/^[0-9]$/.test(key)) {
        state.polygonLengthInput += key;
        window.updateBoothMapPolygonStatus();
        event.preventDefault();
        return;
    }
    if (key === '.') {
        if (!state.polygonLengthInput.includes('.')) {
            state.polygonLengthInput += state.polygonLengthInput ? '.' : '0.';
            window.updateBoothMapPolygonStatus();
        }
        event.preventDefault();
        return;
    }
    if (key === 'backspace') {
        if (state.polygonLengthInput) {
            state.polygonLengthInput = state.polygonLengthInput.slice(0, -1);
            window.updateBoothMapPolygonStatus();
            event.preventDefault();
            return;
        }
    }
    if (key === 'enter') {
        if (state.polygonLengthInput) {
            window.placeBoothMapPolygonPointByLength();
            event.preventDefault();
        }
        return;
    }
    if (key === 'h') {
        state.polygonAxisLock = 'horizontal';
        window.updateBoothMapPolygonStatus();
        window.renderCurrentBoothMap();
        event.preventDefault();
        return;
    }
    if (key === 'v') {
        state.polygonAxisLock = 'vertical';
        window.updateBoothMapPolygonStatus();
        window.renderCurrentBoothMap();
        event.preventDefault();
        return;
    }
    if (key === 'a') {
        state.polygonAxisLock = '';
        window.updateBoothMapPolygonStatus();
        window.renderCurrentBoothMap();
        event.preventDefault();
        return;
    }
    if (key === 'escape') {
        if (state.polygonLengthInput) {
            state.polygonLengthInput = '';
            window.updateBoothMapPolygonStatus();
        } else {
            window.clearBoothMapPolygonDraft();
            window.setBoothMapTool('select');
        }
        window.renderCurrentBoothMap();
        event.preventDefault();
    }
}

window.toggleBoothMapPreviewTextRules = function(forceExpanded) {
    const state = window.getBoothMapState();
    state.previewTextRulesExpanded = typeof forceExpanded === 'boolean' ? forceExpanded : !state.previewTextRulesExpanded;
    const bodyEl = document.getElementById('booth-map-preview-text-rules');
    const textEl = document.getElementById('booth-map-preview-text-toggle-text');
    bodyEl?.classList.toggle('hidden', !state.previewTextRulesExpanded);
    if (textEl) textEl.innerText = state.previewTextRulesExpanded ? '收起' : '展开';
}

window.startBoothMapPolygonTool = function() {
    if (!currentBoothMap) return window.showToast('请先新建或选择一个画布', 'error');
    if (window.getBoothMapScale() <= 0) return window.showToast('请先设置比例尺，再绘制自由多边形', 'error');
    window.clearBoothMapPolygonDraft();
    window.setBoothMapTool('polygon');
    window.renderCurrentBoothMap();
    window.showToast('自由多边形已开启：在画布中逐点点击，回到首点即可闭合', 'info');
}

window.buildBoothMapPolygonItem = function(points = []) {
    if (!currentBoothMap) return null;
    const safePoints = (Array.isArray(points) ? points : [])
        .map((point) => ({
            x: Number(point?.x),
            y: Number(point?.y)
        }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
    if (safePoints.length < 3) return null;
    const left = Math.min(...safePoints.map((point) => point.x));
    const top = Math.min(...safePoints.map((point) => point.y));
    const right = Math.max(...safePoints.map((point) => point.x));
    const bottom = Math.max(...safePoints.map((point) => point.y));
    const widthPx = right - left;
    const heightPx = bottom - top;
    const scale = window.getBoothMapScale();
    if (widthPx <= 0 || heightPx <= 0 || scale <= 0) return null;
    const normalizedPoints = safePoints.map((point) => ({
        x: Number(((point.x - left) / Math.max(widthPx, 1)).toFixed(4)),
        y: Number(((point.y - top) / Math.max(heightPx, 1)).toFixed(4))
    }));
    const nextItem = {
        id: `tmp-${Date.now()}-${window.getBoothMapState().tempIdSeed++}`,
        project_id: currentBoothMap.project_id,
        map_id: currentBoothMap.id,
        booth_code: `TMP-${window.getBoothMapState().tempIdSeed}`,
        hall: window.resolveBoothMapHallValue({}),
        booth_type: '光地',
        opening_type: '',
        width_m: Number((widthPx / scale).toFixed(2)),
        height_m: Number((heightPx / scale).toFixed(2)),
        x: Number(left.toFixed(2)),
        y: Number(top.toFixed(2)),
        rotation: 0,
        stroke_width: window.getBoothMapStrokeWidth(),
        shape_type: 'polygon',
        points_json: normalizedPoints,
        label_style: {},
        z_index: (currentBoothMapItems || []).length + 1,
        hidden: 0,
        _dirty: true,
        _persistedBoothCode: ''
    };
    nextItem.area = window.calculateBoothMapItemArea(nextItem);
    return nextItem;
}

window.completeBoothMapPolygonDraft = function() {
    const state = window.getBoothMapState();
    const nextItem = window.buildBoothMapPolygonItem(state.polygonDraftPoints || []);
    if (!nextItem) {
        window.clearBoothMapPolygonDraft();
        window.renderCurrentBoothMap();
        return window.showToast('自由多边形闭合失败，请重新绘制', 'error');
    }
    currentBoothMapItems.push(nextItem);
    window.setSelectedBoothMapItems([String(nextItem.id)]);
    window.clearBoothMapPolygonDraft();
    window.setBoothMapDirty(true);
    window.setBoothMapTool('select');
    window.renderCurrentBoothMap();
    window.showToast('自由多边形展位已生成，请在右侧补充展位信息');
}

window.getBoothMapDraftSegmentMetric = function(startPoint, endPoint) {
    const scale = window.getBoothMapScale();
    if (!startPoint || !endPoint || scale <= 0) return '';
    const lengthMeters = Math.hypot(Number(endPoint.x || 0) - Number(startPoint.x || 0), Number(endPoint.y || 0) - Number(startPoint.y || 0)) / scale;
    return `${window.formatBoothMapMetricText(lengthMeters)}m`;
}

window.renderBoothMapPolygonDraft = function() {
    const state = window.getBoothMapState();
    const points = Array.isArray(state.polygonDraftPoints) ? state.polygonDraftPoints : [];
    if (points.length === 0) return '';
    const hoverPoint = state.polygonHoverPoint;
    const livePoints = hoverPoint ? [...points, hoverPoint] : [...points];
    const pointMarkup = livePoints.map((point) => `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`).join(' ');
    const guideSegments = [];
    for (let index = 1; index < livePoints.length; index += 1) {
        const start = livePoints[index - 1];
        const end = livePoints[index];
        const midX = (Number(start.x || 0) + Number(end.x || 0)) / 2;
        const midY = (Number(start.y || 0) + Number(end.y || 0)) / 2;
        guideSegments.push(`
            <text
                x="${midX.toFixed(2)}"
                y="${(midY - 10).toFixed(2)}"
                font-size="13"
                font-weight="700"
                fill="#1d4ed8"
                text-anchor="middle"
                dominant-baseline="middle"
            >${window.escapeBoothMapText(window.getBoothMapDraftSegmentMetric(start, end))}</text>
        `);
    }
    const closingHint = points.length >= 3 && hoverPoint ? `
        <line
            x1="${Number(hoverPoint.x || 0).toFixed(2)}"
            y1="${Number(hoverPoint.y || 0).toFixed(2)}"
            x2="${Number(points[0].x || 0).toFixed(2)}"
            y2="${Number(points[0].y || 0).toFixed(2)}"
            stroke="#60a5fa"
            stroke-width="2"
            stroke-dasharray="6 6"
        ></line>
    ` : '';
    return `
        <polyline
            points="${pointMarkup}"
            fill="none"
            stroke="#2563eb"
            stroke-width="3"
            stroke-dasharray="8 6"
            stroke-linejoin="round"
        ></polyline>
        ${closingHint}
        ${guideSegments.join('')}
        ${points.map((point, index) => `
            <circle
                cx="${Number(point.x || 0).toFixed(2)}"
                cy="${Number(point.y || 0).toFixed(2)}"
                r="${index === 0 ? 8 : 6}"
                fill="${index === 0 ? '#dbeafe' : '#ffffff'}"
                stroke="${index === 0 ? '#1d4ed8' : '#2563eb'}"
                stroke-width="2"
            ></circle>
        `).join('')}
    `;
}

window.updateBoothMapRemovedPersistedCodes = function(boothCodes = []) {
    const state = window.getBoothMapState();
    const existing = new Set((state.removedPersistedCodes || []).map((code) => String(code || '').trim().toUpperCase()).filter(Boolean));
    (Array.isArray(boothCodes) ? boothCodes : []).forEach((code) => {
        const normalized = String(code || '').trim().toUpperCase();
        if (normalized) existing.add(normalized);
    });
    state.removedPersistedCodes = Array.from(existing);
}

window.clearBoothMapRemovedPersistedCodes = function() {
    window.getBoothMapState().removedPersistedCodes = [];
}

window.getBoothMapSavableSummary = function() {
    const dirtyItems = (currentBoothMapItems || []).filter((item) => !!item._dirty);
    const savableItems = [];
    const blockedItems = [];
    dirtyItems.forEach((item) => {
        const errors = window.validateBoothMapItems([item], {
            comparisonItems: currentBoothMapItems || []
        });
        if (errors.length === 0) {
            savableItems.push(item);
        } else {
            blockedItems.push({
                item,
                error: errors[0]
            });
        }
    });
    return { dirtyItems, savableItems, blockedItems };
}

window.updateBoothMapSaveSummary = function() {
    const indicatorEl = document.getElementById('booth-map-save-indicator');
    const buttonTextEl = document.getElementById('booth-map-save-button-text');
    const summary = window.getBoothMapSavableSummary();
    const removedCount = (window.getBoothMapState().removedPersistedCodes || []).length;
    let text = `可保存 ${summary.savableItems.length} 个展位`;
    if (summary.blockedItems.length > 0) {
        text += `，待完善 ${summary.blockedItems.length} 个`;
    }
    if (removedCount > 0) {
        text += `，待同步删除 ${removedCount} 个`;
    }
    if (!boothMapDirty && summary.savableItems.length === 0 && summary.blockedItems.length === 0 && removedCount === 0) {
        text = '当前无待保存修改';
    }
    if (indicatorEl) indicatorEl.innerText = text;
    if (buttonTextEl) {
        buttonTextEl.innerText = summary.savableItems.length > 0
            ? `一键保存（${summary.savableItems.length}）`
            : '一键保存';
    }
}

window.populateBoothMapDisplayConfigFields = function() {
    const config = window.ensureCurrentBoothMapDisplayConfig();
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    const setChecked = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.checked = !!value;
    };
    setValue('bm-global-standard-code-font', config.standard.boothNo.fontSize);
    setValue('bm-global-standard-company-font', config.standard.company.fontSize);
    setValue('bm-global-standard-code-x', config.standard.boothNo.anchorX);
    setValue('bm-global-standard-code-y', config.standard.boothNo.anchorY);
    setValue('bm-global-standard-company-x', config.standard.company.anchorX);
    setValue('bm-global-standard-company-y', config.standard.company.anchorY);
    setValue('bm-global-ground-code-font', config.ground.boothNo.fontSize);
    setValue('bm-global-ground-company-font', config.ground.company.fontSize);
    setValue('bm-global-ground-code-x', config.ground.boothNo.anchorX);
    setValue('bm-global-ground-code-y', config.ground.boothNo.anchorY);
    setValue('bm-global-ground-company-x', config.ground.company.anchorX);
    setValue('bm-global-ground-company-y', config.ground.company.anchorY);
    setValue('bm-global-ground-size-font', config.ground.size.fontSize);
    setValue('bm-global-ground-size-x', config.ground.size.anchorX);
    setValue('bm-global-ground-size-y', config.ground.size.anchorY);
    setChecked('bm-global-ground-size-visible', config.ground.size.visible);
}

window.createBoothMapItemFromPreset = function(presetKey, dropPoint) {
    if (!currentBoothMap) return null;
    const scale = window.getBoothMapScale();
    if (scale <= 0) {
        window.showToast('请先设置比例尺，再拖入预置展位', 'error');
        return null;
    }
    const presetMap = {
        'rect-3x3': { width_m: 3, height_m: 3, shape_type: 'rect', booth_type: '标摊', opening_type: '单开口' },
        'rect-3x6': { width_m: 3, height_m: 6, shape_type: 'rect', booth_type: '标摊', opening_type: '双开口' },
        'rect-custom': { width_m: 4, height_m: 4, shape_type: 'rect', booth_type: '光地', opening_type: '' },
        trapezoid: { width_m: 6, height_m: 6, shape_type: 'trapezoid', booth_type: '光地', opening_type: '' }
    };
    const preset = presetMap[presetKey];
    if (!preset) return null;
    const widthPx = preset.width_m * scale;
    const heightPx = preset.height_m * scale;
    const normalizedPoints = window.getBoothMapDefaultShapeRatios(preset.shape_type);
    const nextItem = {
        id: `tmp-${Date.now()}-${window.getBoothMapState().tempIdSeed++}`,
        project_id: currentBoothMap.project_id,
        map_id: currentBoothMap.id,
        booth_code: `TMP-${window.getBoothMapState().tempIdSeed}`,
        hall: window.resolveBoothMapHallValue({}),
        booth_type: preset.booth_type,
        opening_type: preset.opening_type,
        width_m: preset.width_m,
        height_m: preset.height_m,
        area: Number((preset.width_m * preset.height_m * window.calculateBoothMapPolygonAreaRatio(normalizedPoints)).toFixed(2)),
        x: Number((dropPoint.x - widthPx / 2).toFixed(2)),
        y: Number((dropPoint.y - heightPx / 2).toFixed(2)),
        rotation: 0,
        stroke_width: window.getBoothMapStrokeWidth(),
        shape_type: preset.shape_type,
        points_json: normalizedPoints,
        label_style: {},
        z_index: (currentBoothMapItems || []).length + 1,
        hidden: 0,
        _dirty: true,
        _persistedBoothCode: ''
    };
    return nextItem;
}

window.updateCurrentBoothMapName = function(value) {
    if (!currentBoothMap) return;
    currentBoothMap.name = String(value || '').trim();
    window.setBoothMapDirty(true);
    window.renderBoothMapSelectOptions();
    window.renderCurrentBoothMap();
}

window.updateBoothMapDisplayConfig = function(scopeKey, blockKey, field, value) {
    if (!currentBoothMap) return;
    const config = window.ensureCurrentBoothMapDisplayConfig();
    const block = config?.[scopeKey]?.[blockKey];
    if (!block) return;
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return;
    if (field === 'fontSize') {
        block[field] = Number(Math.min(Math.max(normalized, 1), 36).toFixed(2));
    } else {
        const minAnchor = field === 'anchorX' && blockKey === 'boothNo'
            ? -0.05
            : (field === 'anchorY' && blockKey === 'size' ? -0.2 : 0.05);
        const maxAnchor = field === 'anchorY' && blockKey === 'boothNo'
            ? 1.6
            : (field === 'anchorX' && blockKey === 'size' ? 1.05 : 0.95);
        block[field] = Number(Math.min(Math.max(normalized, minAnchor), maxAnchor).toFixed(3));
    }
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.formatBoothMapExportTimestamp = function(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

window.getBoothMapExportFileName = function() {
    const mapName = String(currentBoothMap?.name || 'booth-map').trim() || 'booth-map';
    const timestamp = window.formatBoothMapExportTimestamp(new Date()).replace(/[: ]/g, '-');
    return `${mapName.replace(/[\\/:*?"<>|]+/g, '_')}-${timestamp}.jpg`;
}

window.buildBoothMapPreviewExportSvg = async function() {
    if (!currentBoothMap) return window.showToast('请先选择一个画布', 'error');
    const exportTime = window.formatBoothMapExportTimestamp(new Date());
    const mapTitle = String(currentBoothMap.name || '未命名画布');
    const canvasWidth = Number(currentBoothMap.canvas_width || 1600);
    const canvasHeight = Number(currentBoothMap.canvas_height || 900);
    const footerHeight = 92;
    const backgroundRect = window.getBoothMapRenderedBackgroundRect(currentBoothMap);
    const backgroundDataUrl = currentBoothMap.background_image_key
        ? await window.getAuthorizedAssetDataUrl(window.getBoothMapBackgroundApiUrl(currentBoothMap))
        : '';
    const mapBodyMarkup = `
        <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"></rect>
        ${backgroundDataUrl ? `<image href="${backgroundDataUrl}" x="${backgroundRect.x}" y="${backgroundRect.y}" width="${backgroundRect.width}" height="${backgroundRect.height}" preserveAspectRatio="none" opacity="0.96"></image>` : ''}
        ${(currentBoothMapItems || []).sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0)).map((item) => window.renderBoothMapItem(item, 'preview')).join('')}
    `;
    const serializedSvg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight + footerHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight + footerHeight}">
            <rect x="0" y="0" width="${canvasWidth}" height="${canvasHeight + footerHeight}" fill="#ffffff"></rect>
            <g>${mapBodyMarkup}</g>
            <rect x="0" y="${canvasHeight}" width="${canvasWidth}" height="${footerHeight}" fill="#ffffff"></rect>
            <line x1="0" y1="${canvasHeight}" x2="${canvasWidth}" y2="${canvasHeight}" stroke="#cbd5e1" stroke-width="1"></line>
            <text x="28" y="${canvasHeight + 34}" font-size="24" font-weight="700" fill="#0f172a">${window.escapeBoothMapText(mapTitle)}</text>
            <text x="28" y="${canvasHeight + 66}" font-size="16" font-weight="500" fill="#64748b">导出时间：${window.escapeBoothMapText(exportTime)}</text>
            <text x="${canvasWidth - 28}" y="${canvasHeight + 66}" font-size="16" font-weight="500" fill="#64748b" text-anchor="end">福州渔博会展位图终版预览</text>
        </svg>
    `.trim();

    return { serializedSvg, canvasWidth, canvasHeight, footerHeight };
}

window.renderBoothMapPreviewExportJpg = async function() {
    const svgData = await window.buildBoothMapPreviewExportSvg();
    if (!svgData || !svgData.serializedSvg) return null;

    const { serializedSvg, canvasWidth, canvasHeight, footerHeight } = svgData;
    const svgBlob = new Blob([serializedSvg], { type: 'image/svg+xml;charset=utf-8' });
    const svgUrl = URL.createObjectURL(svgBlob);

    try {
        const image = new Image();
        await new Promise((resolve, reject) => {
            image.onload = () => resolve();
            image.onerror = () => reject(new Error('导出图片生成失败'));
            image.src = svgUrl;
        });

        const canvas = document.createElement('canvas');
        canvas.width = canvasWidth;
        canvas.height = canvasHeight + footerHeight;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('浏览器不支持图片导出');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

        const jpgBlob = await new Promise((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error('JPG 导出失败'));
            }, 'image/jpeg', 0.94);
        });

        return {
            jpgBlob,
            previewUrl: URL.createObjectURL(jpgBlob),
            width: canvas.width,
            height: canvas.height
        };
    } finally {
        URL.revokeObjectURL(svgUrl);
    }
}

window.confirmExportBoothMapPreviewAsJpg = function(previewUrl) {
    if (!previewUrl) return;
    window.openPrintModal({
        title: '导出预览',
        shellClass: 'bg-white shadow-2xl w-full max-w-6xl flex flex-col max-h-[95vh] rounded-3xl overflow-hidden',
        contentClass: 'bg-slate-100 overflow-y-auto flex-1 p-6',
        contentHtml: `
            <div class="space-y-4">
                <div class="text-sm text-slate-600 leading-6">
                    请先确认底图、展位状态、文字排版和底部导出时间是否正确，再执行 JPG 导出。
                </div>
                <div class="rounded-3xl border border-slate-200 bg-white overflow-hidden shadow-sm">
                    <img src="${previewUrl}" alt="展位图导出预览" class="block w-full h-auto">
                </div>
            </div>
        `,
        primaryText: '确认导出 JPG',
        primaryClass: 'px-4 py-2 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 shadow',
        primaryAction: () => {
            const link = document.createElement('a');
            link.href = previewUrl;
            link.download = window.getBoothMapExportFileName();
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.showToast('终版预览 JPG 已导出');
            setTimeout(() => window.closeModal('print-modal'), 0);
        },
        secondaryText: '取消',
        secondaryClass: 'px-4 py-2 bg-slate-200 text-slate-700 rounded-xl font-bold hover:bg-slate-300 shadow',
        secondaryAction: () => window.closeModal('print-modal')
    });
    currentPrintObjectUrl = previewUrl;
}

window.exportBoothMapPreviewAsJpg = async function() {
    if (!currentBoothMap) return window.showToast('请先选择一个画布', 'error');
    if (!(currentBoothMapItems || []).length) return window.showToast('当前没有可导出的展位内容', 'error');

    try {
        await window.withButtonLoading('btn-export-booth-map-preview', async () => {
            const exportResult = await window.renderBoothMapPreviewExportJpg();
            if (!exportResult?.previewUrl) throw new Error('导出预览生成失败');
            window.confirmExportBoothMapPreviewAsJpg(exportResult.previewUrl);
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.toggleBoothMapGroundSizeVisible = function(checked) {
    if (!currentBoothMap) return;
    const config = window.ensureCurrentBoothMapDisplayConfig();
    config.ground.size.visible = !!checked;
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.getBoothMapScale = function() {
    const scale = Number(currentBoothMap?.scale_pixels_per_meter || 0);
    return scale > 0 ? scale : 0;
}

window.ensureBoothMapEditorInitialized = function() {
    const state = window.getBoothMapState();
    if (state.initialized) return;
    const svg = window.getBoothMapSvg();
    const runtimeSvg = window.getBoothMapRuntimeSvg();
    if (!svg) return;

    const handlePointerMove = (event) => window.onBoothMapPointerMove(event);
    const handlePointerUp = () => window.onBoothMapPointerUp();
    const handlePreviewPointerMove = (event) => window.onBoothMapPreviewPointerMove(event);
    const handlePreviewPointerUp = () => window.onBoothMapPreviewPointerUp();

    svg.addEventListener('pointerdown', (event) => window.onBoothMapPointerDown(event));
    svg.addEventListener('pointermove', handlePointerMove);
    svg.addEventListener('wheel', (event) => window.onBoothMapWheel(event), { passive: false });
    runtimeSvg?.addEventListener('pointerdown', (event) => window.onBoothMapPreviewPointerDown(event));
    runtimeSvg?.addEventListener('pointermove', handlePreviewPointerMove);
    runtimeSvg?.addEventListener('wheel', (event) => window.onBoothMapPreviewWheel(event), { passive: false });
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointerup', handlePreviewPointerUp);
    document.addEventListener('keydown', (event) => window.handleBoothMapEditorKeydown(event));

    state.initialized = true;
    window.setBoothMapTool('select');
    window.switchBoothMapTab('editor');
    window.updateBoothMapPolygonStatus();
}

window.initBoothMapPage = async function() {
    window.ensureBoothMapEditorInitialized();
    window.switchBoothMapTab(window.currentBoothMapPanel || 'editor', { syncNav: false });
    await window.loadBoothMaps();
}

window.setBoothMapDirty = function(isDirty = true) {
    boothMapDirty = !!isDirty;
    const runtimeEl = document.getElementById('booth-map-preview-status');
    if (runtimeEl && boothMapDirty) {
        runtimeEl.innerText = '有未保存修改';
        runtimeEl.className = 'text-xs font-bold text-amber-700 bg-amber-100 px-3 py-2 rounded-full';
    }
    window.updateBoothMapSaveSummary();
}

window.switchBoothMapTab = function(tabId, options = {}) {
    const state = window.getBoothMapState();
    state.activeTab = tabId === 'preview' ? 'preview' : (tabId === 'canvas' ? 'canvas' : 'editor');
    window.currentBoothMapPanel = state.activeTab;
    const canvasBtn = document.getElementById('booth-map-tab-canvas');
    const editorBtn = document.getElementById('booth-map-tab-editor');
    const previewBtn = document.getElementById('booth-map-tab-preview');
    const canvasPanel = document.getElementById('booth-map-tab-panel-canvas');
    const editorPanel = document.getElementById('booth-map-tab-panel-editor');
    const previewPanel = document.getElementById('booth-map-tab-panel-preview');
    if (canvasBtn) canvasBtn.className = state.activeTab === 'canvas' ? 'btn-soft-primary px-4 py-2 text-sm' : 'btn-secondary px-4 py-2 text-sm';
    if (editorBtn) editorBtn.className = state.activeTab === 'editor' ? 'btn-soft-primary px-4 py-2 text-sm' : 'btn-secondary px-4 py-2 text-sm';
    if (previewBtn) previewBtn.className = state.activeTab === 'preview' ? 'btn-soft-primary px-4 py-2 text-sm' : 'btn-secondary px-4 py-2 text-sm';
    canvasPanel?.classList.toggle('hidden', state.activeTab !== 'canvas');
    editorPanel?.classList.toggle('hidden', state.activeTab !== 'editor');
    previewPanel?.classList.toggle('hidden', state.activeTab !== 'preview');
    if (window.currentSectionId === 'booth-map') {
        const activeLabel = state.activeTab === 'canvas' ? '管理画布' : (state.activeTab === 'preview' ? '终版预览' : '编辑展位图');
        document.getElementById('current-page-title').innerText = `展位图管理 · ${activeLabel}`;
        if (options.syncNav !== false) {
            window.isBoothMapNavExpanded = true;
            window.renderNav?.();
        }
    }
}

window.setBoothMapTool = function(tool) {
    const state = window.getBoothMapState();
    if (state.tool === 'polygon' && tool !== 'polygon' && (state.polygonDraftPoints || []).length > 0) {
        window.clearBoothMapPolygonDraft();
    }
    state.tool = tool;
    document.querySelectorAll('.booth-map-toolbar-btn[data-tool]').forEach((button) => {
        button.setAttribute('data-active', button.dataset.tool === tool ? 'true' : 'false');
    });
    if (tool !== 'polygon') {
        state.polygonHoverPoint = null;
    }
    window.renderCurrentBoothMap();
}

window.toggleBoothMapAlignTools = function() {
    const state = window.getBoothMapState();
    state.alignToolsExpanded = !state.alignToolsExpanded;
    const bodyEl = document.getElementById('booth-map-align-tools');
    const textEl = document.getElementById('booth-map-align-toggle-text');
    bodyEl?.classList.toggle('hidden', !state.alignToolsExpanded);
    if (textEl) textEl.innerText = state.alignToolsExpanded ? '收起' : '展开';
}

window.handleBoothMapPresetDragStart = function(event, presetKey) {
    const state = window.getBoothMapState();
    state.presetDragKey = String(presetKey || '').trim();
    if (event?.dataTransfer) {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData('text/plain', state.presetDragKey);
    }
}

window.handleBoothMapStageDragOver = function(event) {
    event.preventDefault();
    if (event?.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}

window.handleBoothMapStageDrop = function(event) {
    event.preventDefault();
    if (!currentBoothMap) return window.showToast('请先新建或选择一个画布', 'error');
    const state = window.getBoothMapState();
    const presetKey = event?.dataTransfer?.getData('text/plain') || state.presetDragKey;
    if (!presetKey) return;
    const point = window.getBoothMapSvgPoint(event);
    const nextItem = window.createBoothMapItemFromPreset(presetKey, point);
    state.presetDragKey = '';
    if (!nextItem) return;
    currentBoothMapItems.push(nextItem);
    window.setSelectedBoothMapItems([String(nextItem.id)]);
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
    window.showToast('已拖入一个新展位，请在右侧完善信息');
}

window.persistCurrentBoothMapMeta = async function() {
    if (!currentBoothMapId || !currentBoothMap) throw new Error('请先选择一个画布');
    const name = String(currentBoothMap.name || '').trim();
    if (!name) throw new Error('请填写画布名称');
    const state = window.getBoothMapState();
    const zoom = Number((Number(currentBoothMap.canvas_width || 1600) / Math.max(Number(state.viewBox.width || 1), 1)).toFixed(4));
    const data = await window.readApiSuccessJson(
        await window.apiFetch('/api/update-booth-map', {
            method: 'POST',
            body: JSON.stringify({
                id: currentBoothMapId,
                projectId: window.getBoothMapProjectId(),
                name,
                scale_pixels_per_meter: Number(currentBoothMap.scale_pixels_per_meter || 0),
                default_stroke_width: window.getBoothMapStrokeWidth(),
                canvas_width: currentBoothMap.canvas_width,
                canvas_height: currentBoothMap.canvas_height,
                viewport_x: Number(state.viewBox.x || 0),
                viewport_y: Number(state.viewBox.y || 0),
                viewport_zoom: zoom,
                calibration_json: currentBoothMap.calibration_json || {},
                display_config_json: window.ensureCurrentBoothMapDisplayConfig()
            })
        }),
        '保存画布失败',
        {}
    );
    currentBoothMap.updated_at = data.updated_at || currentBoothMap.updated_at;
    boothMapDirty = (currentBoothMapItems || []).some((item) => item._dirty) || (window.getBoothMapState().removedPersistedCodes || []).length > 0;
    window.renderCurrentBoothMap();
    return data;
}

window.saveCurrentBoothMapMeta = async function() {
    if (!currentBoothMapId || !currentBoothMap) return window.showToast('请先选择一个画布', 'error');
    try {
        await window.persistCurrentBoothMapMeta();
        window.showToast('画布属性已保存');
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.createBoothMap = async function() {
    const projectId = window.getBoothMapProjectId();
    const name = document.getElementById('new-booth-map-name')?.value.trim();
    if (!projectId) return window.showToast('请先选择项目', 'error');
    if (!name) return window.showToast('请填写画布名称', 'error');
    try {
        await window.withButtonLoading('btn-create-booth-map', async () => {
            const data = await window.readApiSuccessJson(
                await window.apiFetch('/api/create-booth-map', {
                    method: 'POST',
                    body: JSON.stringify({ projectId, name })
                }),
                '新建画布失败',
                {}
            );
            document.getElementById('new-booth-map-name').value = '';
            await window.loadBoothMaps(data.id);
            window.showToast('画布创建成功');
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.loadBoothMaps = async function(preferredMapId = currentBoothMapId) {
    const projectId = window.getBoothMapProjectId();
    const selectEl = document.getElementById('booth-map-select');
    if (!projectId) {
        boothMaps = [];
        currentBoothMap = null;
        currentBoothMapItems = [];
        currentBoothMapRuntimeItems = [];
        currentBoothMapId = null;
        if (selectEl) selectEl.innerHTML = '<option value="">请先选择项目</option>';
        window.renderCurrentBoothMap();
        return;
    }

    let data = {};
    try {
        data = await window.readApiSuccessJson(
            await window.apiFetch(`/api/booth-maps?projectId=${projectId}`),
            '加载画布列表失败',
            {}
        );
    } catch (error) {
        if (selectEl && !(boothMaps || []).length) {
            selectEl.innerHTML = '<option value="">加载画布失败，请重试</option>';
        }
        window.showToast(error.message || '加载画布列表失败', 'error');
        return;
    }
    boothMaps = Array.isArray(data.items) ? data.items : [];
    window.renderBoothMapSelectOptions();

    const targetMapId = Number(preferredMapId || 0);
    const nextMap = boothMaps.find((item) => Number(item.id) === targetMapId) || boothMaps[0] || null;
    if (nextMap) {
        await window.selectBoothMap(nextMap.id, { force: true });
        return;
    }

    currentBoothMap = null;
    currentBoothMapItems = [];
    currentBoothMapRuntimeItems = [];
    currentBoothMapId = null;
    boothMapDirty = false;
    window.renderCurrentBoothMap();
}

window.renderBoothMapSelectOptions = function() {
    const selectEl = document.getElementById('booth-map-select');
    if (!selectEl) return;
    const options = ['<option value="">请选择画布</option>'];
    (boothMaps || []).forEach((item) => {
        options.push(`<option value="${Number(item.id)}" ${Number(item.id) === Number(currentBoothMapId) ? 'selected' : ''}>${window.escapeBoothMapText(item.name)}</option>`);
    });
    selectEl.innerHTML = options.join('');
}

window.deleteBoothMap = async function(mapId) {
    const map = (boothMaps || []).find((item) => Number(item.id) === Number(mapId));
    if (!map) return;
    if (!confirm(`确定删除画布【${map.name}】吗？未被订单引用的地图展位也会一起移除。`)) return;
    try {
        await window.readApiSuccessJson(
            await window.apiFetch('/api/delete-booth-map', {
                method: 'POST',
                body: JSON.stringify({ id: mapId, projectId: window.getBoothMapProjectId() })
            }),
            '删除画布失败',
            {}
        );
        if (Number(currentBoothMapId) === Number(mapId)) {
            currentBoothMap = null;
            currentBoothMapItems = [];
            currentBoothMapRuntimeItems = [];
            currentBoothMapId = null;
        }
        boothMapDirty = false;
        await window.loadBoothMaps();
        window.showToast('画布删除成功');
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.deleteCurrentBoothMap = function() {
    if (!currentBoothMapId) return window.showToast('请先选择一个画布', 'error');
    return window.deleteBoothMap(currentBoothMapId);
}

window.handleBoothMapSelectChange = async function(mapId) {
    const normalizedMapId = Number(mapId || 0);
    if (!normalizedMapId) {
        currentBoothMap = null;
        currentBoothMapItems = [];
        currentBoothMapRuntimeItems = [];
        currentBoothMapId = null;
        boothMapDirty = false;
        window.renderCurrentBoothMap();
        return;
    }
    await window.selectBoothMap(normalizedMapId);
}

window.resetBoothMapViewBox = function(canvasWidth, canvasHeight) {
    const state = window.getBoothMapState();
    state.viewBox = window.createBoothMapInitialViewBox(canvasWidth, canvasHeight, 'editor');
}

window.showBoothMapFitView = function() {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    state.viewBox = window.createBoothMapFitViewBox(currentBoothMap.canvas_width, currentBoothMap.canvas_height);
    window.applyBoothMapViewBox();
}

window.showBoothMapEditorView = function() {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    state.viewBox = window.createBoothMapInitialViewBox(currentBoothMap.canvas_width, currentBoothMap.canvas_height, 'editor');
    window.applyBoothMapViewBox();
}

window.shouldApplyStoredBoothMapViewBox = function(map = currentBoothMap) {
    if (!map) return false;
    const zoom = Number(map.viewport_zoom || 0);
    if (!(zoom > 0)) return false;
    const canvasWidth = Number(map.canvas_width || 1600);
    const canvasHeight = Number(map.canvas_height || 900);
    const storedWidth = canvasWidth / Math.max(zoom, 0.1);
    const storedHeight = canvasHeight / Math.max(zoom, 0.1);
    const background = window.getBoothMapBackgroundConfig(map);
    const hasNaturalBackground = Number(background.naturalWidth || 0) > 0 && Number(background.naturalHeight || 0) > 0;
    const isFullCanvasViewport = storedWidth >= canvasWidth * 0.92 && storedHeight >= canvasHeight * 0.92;
    const isLargeCanvas = canvasWidth > 2200 || canvasHeight > 1600;
    if (hasNaturalBackground && isLargeCanvas && isFullCanvasViewport) {
        return false;
    }
    return true;
}

window.selectBoothMap = async function(mapId, options = {}) {
    const force = !!options.force;
    if (boothMapDirty && !force && Number(currentBoothMapId) !== Number(mapId)) {
        const shouldContinue = confirm('当前展位图有未保存修改，确定切换到其他画布吗？');
        if (!shouldContinue) return;
    }
    const projectId = window.getBoothMapProjectId();
    if (!projectId || !mapId) return;
    let data = {};
    try {
        data = await window.readApiSuccessJson(
            await window.apiFetch(`/api/booth-map-detail?id=${mapId}&projectId=${projectId}`),
            '加载展位图失败',
            {}
        );
    } catch (error) {
        window.showToast(error.message || '加载展位图失败', 'error');
        return;
    }

    currentBoothMap = data.map;
    currentBoothMapItems = window.initializeBoothMapItemsState(data.items);
    currentBoothMapId = Number(data.map?.id || 0);
    boothMapDirty = false;
    const state = window.getBoothMapState();
    state.scaleStartPoint = null;
    state.drawStartPoint = null;
    state.draftRect = null;
    state.polygonDraftPoints = [];
    state.polygonHoverPoint = null;
    state.selectionRect = null;
    state.pointerMode = '';
    state.pointerStartPoint = null;
    state.pointerStartItems = null;
    state.resizeContext = null;
    state.dragMoved = false;
    state.removedPersistedCodes = [];
    state.previewViewBox = {
        x: 0,
        y: 0,
        width: Number(currentBoothMap.canvas_width || 1600),
        height: Number(currentBoothMap.canvas_height || 900)
    };
    window.setSelectedBoothMapItems(currentBoothMapItems[0]?.id ? [String(currentBoothMapItems[0].id)] : []);
    window.resetBoothMapViewBox(currentBoothMap.canvas_width, currentBoothMap.canvas_height);
    if (window.shouldApplyStoredBoothMapViewBox(currentBoothMap)) {
        const zoom = Number(currentBoothMap.viewport_zoom || 1);
        state.viewBox = {
            x: Number(currentBoothMap.viewport_x || 0),
            y: Number(currentBoothMap.viewport_y || 0),
            width: Number(currentBoothMap.canvas_width || 1600) / Math.max(zoom, 0.1),
            height: Number(currentBoothMap.canvas_height || 900) / Math.max(zoom, 0.1)
        };
    }

    await window.refreshBoothMapRuntime({ silent: true });
    window.renderBoothMapSelectOptions();
    window.renderCurrentBoothMap();
}

window.refreshBoothMapRuntime = async function(options = {}) {
    if (!currentBoothMapId) {
        currentBoothMapRuntimeItems = [];
        window.getBoothMapState().runtimeByBoothCode = {};
        window.renderCurrentBoothMap();
        return;
    }
    let data = {};
    try {
        data = await window.readApiSuccessJson(
            await window.apiFetch(`/api/booth-map-runtime-view?id=${currentBoothMapId}&projectId=${window.getBoothMapProjectId()}`),
            '刷新运行态失败',
            {}
        );
    } catch (error) {
        if (!options.silent) window.showToast(error.message || '刷新运行态失败', 'error');
        return;
    }
    currentBoothMapRuntimeItems = Array.isArray(data.items) ? data.items : [];
    const state = window.getBoothMapState();
    state.runtimeByBoothCode = Object.fromEntries(
        currentBoothMapRuntimeItems.map((item) => [window.normalizeBoothCode(item.booth_code), item])
    );
    const runtimeEl = document.getElementById('booth-map-preview-status');
    if (runtimeEl && !boothMapDirty) {
        runtimeEl.innerText = '运行态已刷新';
        runtimeEl.className = 'text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-full';
    }
    window.renderCurrentBoothMap();
    if (!options.silent) {
        window.showToast('运行态已刷新');
    }
}

window.getBoothMapSvgPoint = function(event) {
    return window.getBoothMapSvgPointFromElement(window.getBoothMapSvg(), event);
}

window.applyBoothMapViewBox = function() {
    const svg = window.getBoothMapSvg();
    const state = window.getBoothMapState();
    if (!svg || !currentBoothMap) return;
    state.viewBox = window.clampBoothMapViewBox(state.viewBox, currentBoothMap);
    svg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.width} ${state.viewBox.height}`);
}

window.applyBoothMapPreviewViewBox = function() {
    const svg = window.getBoothMapRuntimeSvg();
    const state = window.getBoothMapState();
    if (!svg || !currentBoothMap) return;
    state.previewViewBox = window.clampBoothMapViewBox(state.previewViewBox, currentBoothMap);
    svg.setAttribute('viewBox', `${state.previewViewBox.x} ${state.previewViewBox.y} ${state.previewViewBox.width} ${state.previewViewBox.height}`);
}

window.focusBoothMapViewBoxOnItem = function(item, target = 'editor', options = {}) {
    if (!item || !currentBoothMap) return;
    const state = window.getBoothMapState();
    const baseViewBox = target === 'preview' ? state.previewViewBox : state.viewBox;
    const bounds = window.getBoothMapItemBounds(item);
    const targetSvg = target === 'preview' ? window.getBoothMapRuntimeSvg() : window.getBoothMapSvg();
    const aspectRatio = targetSvg && targetSvg.clientWidth > 0 && targetSvg.clientHeight > 0
        ? (targetSvg.clientWidth / targetSvg.clientHeight)
        : Math.max(baseViewBox.width, 1) / Math.max(baseViewBox.height, 1);
    let nextWidth = baseViewBox.width;
    let nextHeight = baseViewBox.height;

    if (options.zoomToItem) {
        nextWidth = Math.max(bounds.width * 4.5, 240);
        nextHeight = Math.max(bounds.height * 4.5, 180);
        if ((nextWidth / Math.max(nextHeight, 1)) > aspectRatio) {
            nextHeight = nextWidth / Math.max(aspectRatio, 0.1);
        } else {
            nextWidth = nextHeight * aspectRatio;
        }
        nextWidth = Math.min(Math.max(nextWidth, 180), Number(currentBoothMap.canvas_width || 1600));
        nextHeight = Math.min(Math.max(nextHeight, 120), Number(currentBoothMap.canvas_height || 900));
    }

    const nextViewBox = {
        x: Number((bounds.centerX - nextWidth / 2).toFixed(2)),
        y: Number((bounds.centerY - nextHeight / 2).toFixed(2)),
        width: Number(nextWidth.toFixed(2)),
        height: Number(nextHeight.toFixed(2))
    };
    if (target === 'preview') {
        state.previewViewBox = window.clampBoothMapViewBox(nextViewBox, currentBoothMap);
        window.applyBoothMapPreviewViewBox();
    } else {
        state.viewBox = window.clampBoothMapViewBox(nextViewBox, currentBoothMap);
        window.applyBoothMapViewBox();
    }
}

window.onBoothMapWheel = function(event) {
    if (!currentBoothMap) return;
    event.preventDefault();
    const state = window.getBoothMapState();
    const pointer = window.getBoothMapSvgPoint(event);
    const zoomFactor = event.deltaY < 0 ? 0.88 : 1.14;
    const nextWidth = Math.min(Math.max(state.viewBox.width * zoomFactor, 180), Number(currentBoothMap.canvas_width || 1600) * 4);
    const nextHeight = Math.min(Math.max(state.viewBox.height * zoomFactor, 120), Number(currentBoothMap.canvas_height || 900) * 4);
    state.viewBox.x = pointer.x - ((pointer.x - state.viewBox.x) * (nextWidth / state.viewBox.width));
    state.viewBox.y = pointer.y - ((pointer.y - state.viewBox.y) * (nextHeight / state.viewBox.height));
    state.viewBox.width = Number(nextWidth.toFixed(2));
    state.viewBox.height = Number(nextHeight.toFixed(2));
    window.applyBoothMapViewBox();
}

window.onBoothMapPreviewWheel = function(event) {
    if (!currentBoothMap) return;
    event.preventDefault();
    const state = window.getBoothMapState();
    const svg = window.getBoothMapRuntimeSvg();
    const pointer = window.getBoothMapSvgPointFromElement(svg, event);
    const zoomFactor = event.deltaY < 0 ? 0.88 : 1.14;
    const nextWidth = Math.min(Math.max(state.previewViewBox.width * zoomFactor, 180), Number(currentBoothMap.canvas_width || 1600) * 4);
    const nextHeight = Math.min(Math.max(state.previewViewBox.height * zoomFactor, 120), Number(currentBoothMap.canvas_height || 900) * 4);
    state.previewViewBox.x = pointer.x - ((pointer.x - state.previewViewBox.x) * (nextWidth / state.previewViewBox.width));
    state.previewViewBox.y = pointer.y - ((pointer.y - state.previewViewBox.y) * (nextHeight / state.previewViewBox.height));
    state.previewViewBox.width = Number(nextWidth.toFixed(2));
    state.previewViewBox.height = Number(nextHeight.toFixed(2));
    window.applyBoothMapPreviewViewBox();
}

window.onBoothMapPreviewPointerDown = function(event) {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    state.previewPointerMode = 'pan';
    state.previewPointerStartClient = { x: event.clientX, y: event.clientY };
    state.previewPointerStartViewBox = { ...state.previewViewBox };
}

window.onBoothMapPreviewPointerMove = function(event) {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    const svg = window.getBoothMapRuntimeSvg();
    if (!svg || state.previewPointerMode !== 'pan' || !state.previewPointerStartClient || !state.previewPointerStartViewBox) return;
    const dx = (event.clientX - state.previewPointerStartClient.x) * (state.previewPointerStartViewBox.width / Math.max(svg.clientWidth, 1));
    const dy = (event.clientY - state.previewPointerStartClient.y) * (state.previewPointerStartViewBox.height / Math.max(svg.clientHeight, 1));
    state.previewViewBox.x = Number((state.previewPointerStartViewBox.x - dx).toFixed(2));
    state.previewViewBox.y = Number((state.previewPointerStartViewBox.y - dy).toFixed(2));
    window.applyBoothMapPreviewViewBox();
}

window.onBoothMapPreviewPointerUp = function() {
    const state = window.getBoothMapState();
    state.previewPointerMode = '';
    state.previewPointerStartClient = null;
    state.previewPointerStartViewBox = null;
}

window.onBoothMapPointerDown = function(event) {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    const svg = window.getBoothMapSvg();
    const point = window.getBoothMapSvgPoint(event);
    const resizeHandleEl = event.target.closest('[data-resize-handle]');
    const itemGroup = event.target.closest('[data-item-id]');
    const isAdditiveSelection = event.shiftKey || event.ctrlKey || event.metaKey;
    const shouldPanWithModifier = event.altKey || event.metaKey;

    if (state.tool === 'pan' || shouldPanWithModifier) {
        state.pointerMode = 'pan';
        state.pointerStartClient = { x: event.clientX, y: event.clientY };
        state.pointerStartViewBox = { ...state.viewBox };
        return;
    }

    if (state.tool === 'scale') {
        if (!state.scaleStartPoint) {
            state.scaleStartPoint = point;
            window.renderCurrentBoothMap();
            window.showToast('已记录第一点，请点击第二点完成比例尺标定', 'info');
            return;
        }
        const distance = Math.hypot(point.x - state.scaleStartPoint.x, point.y - state.scaleStartPoint.y);
        const metersText = prompt('请输入这段线的实际长度（米）', '3');
        if (metersText === null) {
            state.scaleStartPoint = null;
            window.renderCurrentBoothMap();
            return;
        }
        const meters = Number(metersText);
        if (!Number.isFinite(meters) || meters <= 0 || distance <= 0) {
            state.scaleStartPoint = null;
            window.renderCurrentBoothMap();
            return window.showToast('比例尺长度无效，请重新标定', 'error');
        }
        currentBoothMap.scale_pixels_per_meter = Number((distance / meters).toFixed(4));
        currentBoothMap.calibration_json = {
            start: state.scaleStartPoint,
            end: point,
            meters: Number(meters.toFixed(2))
        };
        state.scaleStartPoint = null;
        window.setBoothMapDirty(true);
        window.renderCurrentBoothMap();
        window.showToast('比例尺已更新');
        return;
    }

    if (state.tool === 'draw') {
        if (window.getBoothMapScale() <= 0) {
            return window.showToast('请先设置比例尺，再绘制展位', 'error');
        }
        state.drawStartPoint = point;
        state.draftRect = { x: point.x, y: point.y, width: 0, height: 0 };
        return;
    }

    if (state.tool === 'polygon') {
        if (window.getBoothMapScale() <= 0) {
            return window.showToast('请先设置比例尺，再绘制自由多边形', 'error');
        }
        const constrainedPoint = window.getBoothMapConstrainedPolygonPoint(point, { constrainAxis: event.shiftKey });
        const svgUnitsPerClientPx = state.viewBox.width / Math.max(svg?.clientWidth || 1, 1);
        const closeTolerance = Math.max(svgUnitsPerClientPx * 12, 10);
        const draftPoints = Array.isArray(state.polygonDraftPoints) ? state.polygonDraftPoints : [];
        if (draftPoints.length >= 3) {
            const firstPoint = draftPoints[0];
            const distanceToFirst = Math.hypot(constrainedPoint.x - firstPoint.x, constrainedPoint.y - firstPoint.y);
            if (distanceToFirst <= closeTolerance) {
                window.completeBoothMapPolygonDraft();
                return;
            }
        }
        if (state.polygonLengthInput) {
            state.polygonHoverPoint = constrainedPoint;
            window.placeBoothMapPolygonPointByLength();
            return;
        }
        window.commitBoothMapPolygonPoint(constrainedPoint, { axisLock: state.polygonAxisLock, constrainAxis: event.shiftKey });
        window.renderCurrentBoothMap();
        if (state.polygonDraftPoints.length === 1) {
            window.showToast('已记录起点，继续点击其余顶点；回到首点即可闭合', 'info');
        }
        return;
    }

    if (resizeHandleEl && itemGroup) {
        const itemId = String(itemGroup.getAttribute('data-item-id') || '');
        window.setSelectedBoothMapItems([itemId]);
        const selectedItem = window.getSelectedBoothMapItem();
        if (!selectedItem) return;
        state.pointerMode = 'resize';
        state.pointerStartPoint = point;
        state.resizeContext = {
            handle: String(resizeHandleEl.getAttribute('data-resize-handle') || ''),
            itemId,
            startX: Number(selectedItem.x || 0),
            startY: Number(selectedItem.y || 0),
            startWidthPx: window.getBoothMapItemSizePx(selectedItem).widthPx,
            startHeightPx: window.getBoothMapItemSizePx(selectedItem).heightPx,
            rotation: Number(selectedItem.rotation || 0)
        };
        window.renderCurrentBoothMap();
        return;
    }

    if (itemGroup) {
        const itemId = String(itemGroup.getAttribute('data-item-id') || '');
        if (isAdditiveSelection) {
            if (window.isBoothMapItemSelected(itemId)) {
                window.setSelectedBoothMapItems((state.selectedItemIds || []).filter((candidate) => String(candidate) !== itemId));
            } else {
                window.setSelectedBoothMapItems([...(state.selectedItemIds || []), itemId]);
            }
        } else if (!window.isBoothMapItemSelected(itemId) || window.getBoothMapSelectionCount() <= 1) {
            window.setSelectedBoothMapItems([itemId]);
        }

        const selectedItems = window.getSelectedBoothMapItems();
        if (!isAdditiveSelection && selectedItems.length > 0 && window.isBoothMapItemSelected(itemId)) {
            state.pointerMode = 'item';
            state.pointerStartPoint = point;
            state.pointerStartItems = Object.fromEntries(
                selectedItems.map((item) => [String(item.id), { x: Number(item.x || 0), y: Number(item.y || 0) }])
            );
            state.dragMoved = false;
        }
        window.renderCurrentBoothMap();
        return;
    }

    state.pointerMode = 'marquee';
    state.pointerStartPoint = point;
    state.selectionRect = { x: point.x, y: point.y, width: 0, height: 0 };
    state.marqueeAppend = isAdditiveSelection;
    state.dragMoved = false;
    if (!isAdditiveSelection) {
        window.setSelectedBoothMapItems([]);
    }
    window.renderCurrentBoothMap();
}

window.onBoothMapPointerMove = function(event) {
    if (!currentBoothMap) return;
    const state = window.getBoothMapState();
    const svg = window.getBoothMapSvg();
    if (!svg) return;

    if (state.tool === 'polygon' && (state.polygonDraftPoints || []).length > 0) {
        state.polygonHoverPoint = window.getBoothMapConstrainedPolygonPoint(window.getBoothMapSvgPoint(event), { constrainAxis: event.shiftKey });
        window.renderCurrentBoothMap();
    }

    if (state.pointerMode === 'pan' && state.pointerStartClient && state.pointerStartViewBox) {
        const dx = (event.clientX - state.pointerStartClient.x) * (state.pointerStartViewBox.width / Math.max(svg.clientWidth, 1));
        const dy = (event.clientY - state.pointerStartClient.y) * (state.pointerStartViewBox.height / Math.max(svg.clientHeight, 1));
        state.viewBox.x = Number((state.pointerStartViewBox.x - dx).toFixed(2));
        state.viewBox.y = Number((state.pointerStartViewBox.y - dy).toFixed(2));
        window.applyBoothMapViewBox();
        return;
    }

    if (state.pointerMode === 'item' && state.pointerStartPoint && state.pointerStartItems) {
        const selectedItems = window.getSelectedBoothMapItems();
        if (selectedItems.length === 0) return;
        const point = window.getBoothMapSvgPoint(event);
        const dx = Number((point.x - state.pointerStartPoint.x).toFixed(2));
        const dy = Number((point.y - state.pointerStartPoint.y).toFixed(2));
        const nextPositions = Object.fromEntries(
            selectedItems.map((item) => {
                const start = state.pointerStartItems[String(item.id)] || { x: Number(item.x || 0), y: Number(item.y || 0) };
                return [String(item.id), {
                    x: Number((start.x + dx).toFixed(2)),
                    y: Number((start.y + dy).toFixed(2))
                }];
            })
        );
        const snapAdjustment = window.getBoothMapSnapAdjustment(nextPositions);
        selectedItems.forEach((item) => {
            const nextPosition = nextPositions[String(item.id)];
            item.x = Number((nextPosition.x + snapAdjustment.dx).toFixed(2));
            item.y = Number((nextPosition.y + snapAdjustment.dy).toFixed(2));
            item._dirty = true;
        });
        state.dragMoved = state.dragMoved || Math.abs(dx) > 0.8 || Math.abs(dy) > 0.8;
        window.setBoothMapDirty(true);
        window.renderCurrentBoothMap();
        return;
    }

    if (state.pointerMode === 'resize' && state.pointerStartPoint && state.resizeContext) {
        const item = window.getSelectedBoothMapItem();
        if (!item) return;
        const scale = window.getBoothMapScale() || 40;
        const point = window.getBoothMapSvgPoint(event);
        const globalDx = Number((point.x - state.pointerStartPoint.x).toFixed(2));
        const globalDy = Number((point.y - state.pointerStartPoint.y).toFixed(2));
        const localDelta = window.rotateBoothMapDeltaToLocal(globalDx, globalDy, state.resizeContext.rotation);
        const minSizePx = Math.max(scale * 0.6, 24);
        let widthPx = state.resizeContext.startWidthPx;
        let heightPx = state.resizeContext.startHeightPx;
        let offsetLocalX = 0;
        let offsetLocalY = 0;
        const handle = state.resizeContext.handle;

        if (handle.includes('e')) {
            widthPx = Math.max(minSizePx, state.resizeContext.startWidthPx + localDelta.x);
        }
        if (handle.includes('s')) {
            heightPx = Math.max(minSizePx, state.resizeContext.startHeightPx + localDelta.y);
        }
        if (handle.includes('w')) {
            widthPx = Math.max(minSizePx, state.resizeContext.startWidthPx - localDelta.x);
            offsetLocalX = state.resizeContext.startWidthPx - widthPx;
        }
        if (handle.includes('n')) {
            heightPx = Math.max(minSizePx, state.resizeContext.startHeightPx - localDelta.y);
            offsetLocalY = state.resizeContext.startHeightPx - heightPx;
        }

        const globalOffset = window.rotateBoothMapDeltaToGlobal(offsetLocalX, offsetLocalY, state.resizeContext.rotation);
        item.x = Number((state.resizeContext.startX + globalOffset.x).toFixed(2));
        item.y = Number((state.resizeContext.startY + globalOffset.y).toFixed(2));
        item.width_m = Number((widthPx / scale).toFixed(2));
        item.height_m = Number((heightPx / scale).toFixed(2));
        item.area = window.calculateBoothMapItemArea(item);
        item._dirty = true;
        window.setBoothMapDirty(true);
        window.renderCurrentBoothMap();
        return;
    }

    if (state.pointerMode === 'marquee' && state.pointerStartPoint && state.selectionRect) {
        const point = window.getBoothMapSvgPoint(event);
        state.selectionRect = {
            x: Math.min(state.pointerStartPoint.x, point.x),
            y: Math.min(state.pointerStartPoint.y, point.y),
            width: Number(Math.abs(point.x - state.pointerStartPoint.x).toFixed(2)),
            height: Number(Math.abs(point.y - state.pointerStartPoint.y).toFixed(2))
        };
        state.dragMoved = state.dragMoved || state.selectionRect.width > 3 || state.selectionRect.height > 3;
        window.renderCurrentBoothMap();
        return;
    }

    if (state.drawStartPoint && state.draftRect) {
        const point = window.getBoothMapSvgPoint(event);
        state.draftRect = {
            x: Math.min(state.drawStartPoint.x, point.x),
            y: Math.min(state.drawStartPoint.y, point.y),
            width: Number(Math.abs(point.x - state.drawStartPoint.x).toFixed(2)),
            height: Number(Math.abs(point.y - state.drawStartPoint.y).toFixed(2))
        };
        window.renderCurrentBoothMap();
    }
}

window.onBoothMapPointerUp = function() {
    const state = window.getBoothMapState();
    if (state.drawStartPoint && state.draftRect && currentBoothMap) {
        const scale = window.getBoothMapScale();
        if (state.draftRect.width >= 8 && state.draftRect.height >= 8 && scale > 0) {
            const widthMeters = Number((state.draftRect.width / scale).toFixed(2));
            const heightMeters = Number((state.draftRect.height / scale).toFixed(2));
            const nextTempCode = `TMP-${state.tempIdSeed++}`;
            const labelStyle = window.normalizeBoothMapLabelStyle(null, state.draftRect.width, state.draftRect.height);
            const nextItem = {
                id: `tmp-${Date.now()}-${state.tempIdSeed}`,
                project_id: currentBoothMap.project_id,
                map_id: currentBoothMap.id,
                booth_code: nextTempCode,
                hall: '',
                booth_type: '标摊',
                opening_type: '单开口',
                width_m: widthMeters,
                height_m: heightMeters,
                area: Number((widthMeters * heightMeters).toFixed(2)),
                x: state.draftRect.x,
                y: state.draftRect.y,
                rotation: 0,
                stroke_width: window.getBoothMapStrokeWidth(),
                shape_type: 'rect',
                points_json: [],
                label_style: labelStyle,
                z_index: currentBoothMapItems.length + 1,
                hidden: 0,
                _dirty: true,
                _persistedBoothCode: ''
            };
            currentBoothMapItems.push(nextItem);
            window.setSelectedBoothMapItems([String(nextItem.id)]);
            window.setBoothMapDirty(true);
            window.showToast('矩形展位已生成，请在右侧完善馆号和展位号');
        }
    }

    if (state.pointerMode === 'marquee') {
        const selectionRect = state.selectionRect;
        if (selectionRect && (selectionRect.width >= 6 || selectionRect.height >= 6)) {
            const matchedIds = (currentBoothMapItems || [])
                .filter((item) => {
                    const bounds = window.getBoothMapItemBounds(item);
                    return !(
                        bounds.right < selectionRect.x
                        || bounds.left > selectionRect.x + selectionRect.width
                        || bounds.bottom < selectionRect.y
                        || bounds.top > selectionRect.y + selectionRect.height
                    );
                })
                .map((item) => String(item.id));
            window.setSelectedBoothMapItems(state.marqueeAppend ? [...(state.selectedItemIds || []), ...matchedIds] : matchedIds);
        }
    }

    state.pointerMode = '';
    state.pointerStartClient = null;
    state.pointerStartViewBox = null;
    state.pointerStartPoint = null;
    state.pointerStartItems = null;
    state.resizeContext = null;
    state.drawStartPoint = null;
    state.draftRect = null;
    state.selectionRect = null;
    state.marqueeAppend = false;
    state.dragMoved = false;
    window.renderCurrentBoothMap();
}

window.getSelectedBoothMapItem = function() {
    return window.getSelectedBoothMapItems()[0] || null;
}

window.populateBoothMapPropertyPanel = function() {
    const selectedItems = window.getSelectedBoothMapItems();
    const item = selectedItems.length === 1 ? selectedItems[0] : null;
    const setValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value ?? '';
    };
    const setDisabled = (id, disabled) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.disabled = !!disabled;
        el.classList.toggle('opacity-60', !!disabled);
        el.classList.toggle('cursor-not-allowed', !!disabled);
    };
    const titleEl = document.getElementById('booth-map-selection-title');
    const metaEl = document.getElementById('booth-map-selection-meta');
    const openingWrap = document.getElementById('bm-field-opening-wrap');
    const snapToggleEl = document.getElementById('bm-toggle-snap');
    const canEditSingle = selectedItems.length === 1;
    const selectionCount = selectedItems.length;
    const summary = window.getBoothMapSavableSummary();
    const saveStateText = selectionCount === 1
        ? (selectedItems[0]._dirty ? `未保存${window.validateBoothMapItems([selectedItems[0]], { comparisonItems: currentBoothMapItems || [] }).length ? '（待完善）' : '（可保存）'}` : '已保存')
        : (selectionCount > 1 ? `已选择 ${selectionCount} 个展位` : '未选择展位');

    setValue('bm-field-global-stroke-width', window.getBoothMapStrokeWidth());
    setValue('bm-field-snap-distance', window.getBoothMapSnapTolerance());
    setValue('bm-field-selection-count', selectionCount);
    setValue('bm-field-save-state', saveStateText);
    window.populateBoothMapDisplayConfigFields();
    if (snapToggleEl) {
        snapToggleEl.innerText = window.getBoothMapState().snapEnabled ? '吸附已开启' : '吸附已关闭';
        snapToggleEl.className = window.getBoothMapState().snapEnabled
            ? 'btn-soft-primary w-full px-3 py-2.5 text-sm justify-center'
            : 'btn-secondary w-full px-3 py-2.5 text-sm justify-center';
    }
    ['bm-field-code', 'bm-field-type', 'bm-field-opening', 'bm-field-width', 'bm-field-height'].forEach((id) => setDisabled(id, !canEditSingle));

    if (!item) {
        if (titleEl) titleEl.innerText = selectionCount > 1 ? `已选择 ${selectionCount} 个展位` : '未选择展位';
        if (metaEl) {
            metaEl.innerText = selectionCount > 1
                ? '可以拖动整组展位移动位置，并使用上方对齐工具快速整理布局。'
                : '单击可单选，按住 Shift 可多选，拖拽空白区域可框选。';
        }
        ['bm-field-code', 'bm-field-type', 'bm-field-opening', 'bm-field-width', 'bm-field-height', 'bm-field-area'].forEach((id) => setValue(id, ''));
        if (openingWrap) openingWrap.classList.remove('hidden');
        window.updateBoothMapSaveSummary();
        return;
    }

    if (titleEl) titleEl.innerText = item.booth_code || '未命名展位';
    if (metaEl) {
        metaEl.innerText = summary.blockedItems.find((entry) => String(entry.item.id) === String(item.id))?.error
            || '可直接拖动当前展位移动位置，也可拖边线调整大小。';
    }
    setValue('bm-field-code', item.booth_code || '');
    setValue('bm-field-type', item.booth_type || '标摊');
    setValue('bm-field-opening', item.opening_type || '单开口');
    setValue('bm-field-width', item.width_m || '');
    setValue('bm-field-height', item.height_m || '');
    setValue('bm-field-area', item.area || '');
    if (openingWrap) {
        openingWrap.classList.toggle('hidden', String(item.booth_type || '') === '光地');
    }
    window.updateBoothMapSaveSummary();
}

window.updateBoothMapGlobalStrokeWidth = function(value) {
    if (!currentBoothMap) return;
    const normalized = Number(value);
    currentBoothMap.default_stroke_width = Number.isFinite(normalized)
        ? Number(Math.min(Math.max(normalized, 1), 12).toFixed(2))
        : 2;
    window.syncBoothMapItemsStrokeWidth();
    window.markAllBoothMapItemsDirty(true);
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.toggleBoothMapSnap = function() {
    const state = window.getBoothMapState();
    state.snapEnabled = !state.snapEnabled;
    window.renderCurrentBoothMap();
}

window.updateBoothMapSnapTolerance = function(value) {
    const normalized = Number(value);
    window.getBoothMapState().snapTolerance = Number.isFinite(normalized)
        ? Number(Math.min(Math.max(normalized, 0), 120).toFixed(0))
        : 12;
    window.renderCurrentBoothMap();
}

window.updateSelectedBoothMapField = function(field, value) {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length !== 1) return;
    const item = selectedItems[0];
    if (!item) return;
    if (field === 'booth_code') {
        const nextBoothCode = String(value || '').trim().toUpperCase();
        const duplicateItem = window.findDuplicateBoothMapItemByCode(nextBoothCode, item.id);
        if (nextBoothCode && !nextBoothCode.startsWith('TMP-') && duplicateItem) {
            const inputEl = document.getElementById('bm-field-code');
            if (inputEl) inputEl.value = item.booth_code || '';
            window.showToast(`展位号重复：${nextBoothCode}`, 'error');
            return;
        }
        item.booth_code = nextBoothCode;
    } else if (field === 'booth_type') {
        item.booth_type = String(value || '').trim();
        if (item.booth_type === '光地') {
            item.opening_type = '';
        } else if (!item.opening_type) {
            item.opening_type = '单开口';
        }
    } else if (field === 'opening_type') {
        item.opening_type = String(value || '').trim();
    } else if (field === 'width_m' || field === 'height_m') {
        const normalized = Number(value);
        item[field] = Number.isFinite(normalized) && normalized > 0 ? Number(normalized.toFixed(2)) : 0;
        item.area = window.calculateBoothMapItemArea(item);
    }
    item._dirty = true;
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.updateSelectedLabelStyle = function(blockKey, field, value) {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length !== 1) return;
    const item = selectedItems[0];
    if (!item) return;
    item.label_style = item.label_style || window.createDefaultBoothMapLabelStyle(item.width_m * Math.max(window.getBoothMapScale(), 40), item.height_m * Math.max(window.getBoothMapScale(), 40));
    const block = item.label_style[blockKey];
    if (!block) return;
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return;
    block[field] = Number(field === 'fontSize'
        ? Math.min(Math.max(normalized, 1), 36).toFixed(2)
        : Math.min(Math.max(normalized, field.startsWith('anchor') ? 0.05 : -180), field.startsWith('anchor') ? 0.95 : 180).toFixed(field.startsWith('anchor') ? 3 : 2)
    );
    if (field === 'fontSize') block[field] = Number(block[field]);
    item._dirty = true;
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.rotateSelectedBoothMapItem = function(delta) {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length === 0) return;
    selectedItems.forEach((item) => {
        item.rotation = (((Number(item.rotation || 0) + Number(delta || 0)) % 360) + 360) % 360;
        item._dirty = true;
    });
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.deleteSelectedBoothMapItem = function() {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length === 0) return;
    const occupiedItems = selectedItems.filter((item) => {
        if (Number(item.active_order_count || 0) > 0) return true;
        const runtimeItem = window.getBoothMapRuntimeItem(item.booth_code);
        return ['reserved', 'deposit', 'full_paid'].includes(String(runtimeItem?.status_code || ''));
    });
    if (occupiedItems.length > 0) {
        const previewText = occupiedItems.slice(0, 5).map((item) => item.booth_code || '未命名').join('、');
        const suffix = occupiedItems.length > 5 ? ' 等' : '';
        window.showToast(`以下展位已被订单占用，不能删除：${previewText}${suffix}`, 'error');
        return;
    }
    const confirmText = selectedItems.length === 1
        ? `确定删除展位 [${selectedItems[0].booth_code || '未命名'}] 吗？`
        : `确定删除已选中的 ${selectedItems.length} 个展位吗？`;
    if (!confirm(confirmText)) return;
    window.updateBoothMapRemovedPersistedCodes(selectedItems.map((item) => item._persistedBoothCode));
    const selectedIds = new Set(selectedItems.map((item) => String(item.id)));
    currentBoothMapItems = (currentBoothMapItems || []).filter((candidate) => !selectedIds.has(String(candidate.id)));
    window.setSelectedBoothMapItems([]);
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.alignSelectedBoothMapItems = function(mode) {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length < 2) {
        return window.showToast('请至少选择两个展位后再执行对齐', 'error');
    }
    const selectionBounds = window.getBoothMapSelectionBounds(selectedItems);
    if (!selectionBounds) return;
    selectedItems.forEach((item) => {
        const bounds = window.getBoothMapItemBounds(item);
        if (mode === 'left') {
            item.x = Number(selectionBounds.left.toFixed(2));
        } else if (mode === 'hcenter') {
            item.x = Number((selectionBounds.centerX - bounds.width / 2).toFixed(2));
        } else if (mode === 'right') {
            item.x = Number((selectionBounds.right - bounds.width).toFixed(2));
        } else if (mode === 'top') {
            item.y = Number(selectionBounds.top.toFixed(2));
        } else if (mode === 'vcenter') {
            item.y = Number((selectionBounds.centerY - bounds.height / 2).toFixed(2));
        } else if (mode === 'bottom') {
            item.y = Number((selectionBounds.bottom - bounds.height).toFixed(2));
        }
        item._dirty = true;
    });
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.distributeSelectedBoothMapItems = function(axis) {
    const selectedItems = window.getSelectedBoothMapItems();
    if (selectedItems.length < 3) {
        return window.showToast('请至少选择三个展位后再执行等间距分布', 'error');
    }
    const sortedItems = [...selectedItems].sort((a, b) => {
        const aBounds = window.getBoothMapItemBounds(a);
        const bBounds = window.getBoothMapItemBounds(b);
        return axis === 'vertical' ? aBounds.top - bBounds.top : aBounds.left - bBounds.left;
    });
    const boundsList = sortedItems.map((item) => window.getBoothMapItemBounds(item));
    const totalSize = boundsList.reduce((sum, bounds) => sum + (axis === 'vertical' ? bounds.height : bounds.width), 0);
    const startEdge = axis === 'vertical' ? boundsList[0].top : boundsList[0].left;
    const endEdge = axis === 'vertical' ? boundsList[boundsList.length - 1].bottom : boundsList[boundsList.length - 1].right;
    const gap = (endEdge - startEdge - totalSize) / Math.max(sortedItems.length - 1, 1);
    let cursor = startEdge;
    sortedItems.forEach((item, index) => {
        const bounds = boundsList[index];
        if (axis === 'vertical') {
            item.y = Number(cursor.toFixed(2));
            cursor += bounds.height + gap;
        } else {
            item.x = Number(cursor.toFixed(2));
            cursor += bounds.width + gap;
        }
        item._dirty = true;
    });
    window.setBoothMapDirty(true);
    window.renderCurrentBoothMap();
}

window.copySelectedBoothMapItem = function() {
    const item = window.getSelectedBoothMapItem();
    if (!item) return window.showToast('请先选择一个展位', 'error');
    const { widthPx } = window.getBoothMapItemSizePx(item);
    const offset = Math.max(window.getBoothMapSnapTolerance(), 18);
    const nextId = `tmp-${Date.now()}-${window.getBoothMapState().tempIdSeed++}`;
    const nextItem = {
        ...item,
        id: nextId,
        booth_code: `TMP-${window.getBoothMapState().tempIdSeed}`,
        x: Number((Number(item.x || 0) + widthPx + offset).toFixed(2)),
        y: Number((Number(item.y || 0) + offset).toFixed(2)),
        z_index: (currentBoothMapItems || []).length + 1,
        label_style: window.cloneBoothMapLabelStyle(item.label_style),
        points_json: JSON.parse(JSON.stringify(item.points_json || [])),
        _dirty: true,
        _persistedBoothCode: ''
    };
    currentBoothMapItems.push(nextItem);
    window.setSelectedBoothMapItems([String(nextItem.id)]);
    window.setBoothMapDirty(true);
    window.showToast('已复制一个新展位，请修改展位号后保存');
    window.renderCurrentBoothMap();
}

window.searchCurrentBoothMapItem = function() {
    if (!currentBoothMap) return window.showToast('请先选择一个画布', 'error');
    const state = window.getBoothMapState();
    const keyword = window.normalizeBoothCode(document.getElementById('booth-map-search-input')?.value || '');
    if (!keyword) return window.showToast('请输入要搜索的展位号', 'error');
    const exactItem = window.findItemByBoothCode(currentBoothMapItems, keyword);
    const fuzzyItem = window.findItemByBoothCodeIncludes(currentBoothMapItems, keyword);
    const matchedItem = exactItem || fuzzyItem;
    if (!matchedItem) {
        state.searchHighlightItemId = '';
        window.renderCurrentBoothMap();
        return window.showToast(`当前画布未找到展位：${keyword}`, 'error');
    }
    state.searchHighlightItemId = String(matchedItem.id);
    window.setSelectedBoothMapItems([String(matchedItem.id)]);
    window.focusBoothMapViewBoxOnItem(matchedItem, 'editor', { zoomToItem: true });
    window.renderCurrentBoothMap();
    window.showToast(`已定位到展位：${matchedItem.booth_code}`);
}

window.getBoothMapLabelYOffsetFromEdge = function(anchorY, shortSide, baseAnchorY, rangeMultiplier = 0.42) {
    const travel = Math.max(shortSide * rangeMultiplier, 8);
    return Number(((Number(anchorY) - Number(baseAnchorY)) * travel).toFixed(2));
}

window.getBoothMapPolygonHorizontalRanges = function(points = [], y = 0) {
    const safePoints = Array.isArray(points) ? points : [];
    if (safePoints.length < 3) return [];
    const scanY = Number(y);
    const intersections = [];
    safePoints.forEach((point, index) => {
        const next = safePoints[(index + 1) % safePoints.length];
        const y1 = Number(point?.y);
        const y2 = Number(next?.y);
        const x1 = Number(point?.x);
        const x2 = Number(next?.x);
        if (![x1, y1, x2, y2].every(Number.isFinite)) return;
        if (Math.abs(y1 - y2) < 0.0001) return;
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        const adjustedY = scanY === maxY ? scanY - 0.01 : scanY;
        if (adjustedY < minY || adjustedY >= maxY) return;
        const ratio = (adjustedY - y1) / (y2 - y1);
        intersections.push(x1 + (x2 - x1) * ratio);
    });
    intersections.sort((a, b) => a - b);
    const ranges = [];
    for (let index = 0; index + 1 < intersections.length; index += 2) {
        const left = Number(intersections[index]);
        const right = Number(intersections[index + 1]);
        if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) continue;
        ranges.push({
            left: Number(left.toFixed(2)),
            right: Number(right.toFixed(2)),
            width: Number((right - left).toFixed(2))
        });
    }
    return ranges;
}

window.findBoothMapPolygonLabelPlacement = function(localPoints = [], options = {}) {
    const safePoints = Array.isArray(localPoints) ? localPoints : [];
    if (safePoints.length < 3) return null;
    const prefer = String(options.prefer || 'bottom-left');
    const paddingX = Math.max(Number(options.paddingX || 0), 0);
    const paddingY = Math.max(Number(options.paddingY || 0), 0);
    const targetWidth = Math.max(Number(options.targetWidth || 0), 0);
    const textHeight = Math.max(Number(options.textHeight || 0), 8);
    const minWidth = Math.max(Number(options.minWidth || 12), 12);
    const shortSide = Math.max(Number(options.shortSide || 0), 12);
    const defaultAnchorX = Number(options.defaultAnchorX ?? 0.02);
    const defaultAnchorY = Number(options.defaultAnchorY ?? 0.93);
    const anchorX = Number(options.anchorX ?? defaultAnchorX);
    const anchorY = Number(options.anchorY ?? defaultAnchorY);
    const lockPosition = !!options.lockPosition;
    const minY = Math.min(...safePoints.map((point) => Number(point.y || 0)));
    const maxY = Math.max(...safePoints.map((point) => Number(point.y || 0)));
    const sampleCount = 28;
    const isBottom = prefer.startsWith('bottom');
    const isLeft = prefer.endsWith('left');
    const sampleOffsets = isBottom
        ? [0, -textHeight * 0.45, -textHeight * 0.9]
        : [0, textHeight * 0.45, textHeight * 0.9];
    const candidates = [];

    for (let index = 0; index < sampleCount; index += 1) {
        const progress = sampleCount === 1 ? 0 : index / (sampleCount - 1);
        const startY = isBottom
            ? maxY - paddingY - textHeight * 0.28
            : minY + paddingY + textHeight * 0.18;
        const y = isBottom
            ? startY - progress * Math.max(maxY - minY - paddingY * 2 - textHeight, 1)
            : startY + progress * Math.max(maxY - minY - paddingY * 2 - textHeight, 1);
        const sampledRanges = sampleOffsets.map((offset) => {
            const sampleY = Number((y + offset).toFixed(2));
            const ranges = window.getBoothMapPolygonHorizontalRanges(safePoints, sampleY);
            return ranges.length ? (isLeft ? ranges[0] : ranges[ranges.length - 1]) : null;
        });
        if (sampledRanges.some((range) => !range)) continue;
        const left = Math.max(...sampledRanges.map((range) => Number(range.left || 0)));
        const right = Math.min(...sampledRanges.map((range) => Number(range.right || 0)));
        const usableWidth = Math.max(right - left - paddingX * 2, 0);
        const candidate = {
            range: {
                left: Number(left.toFixed(2)),
                right: Number(right.toFixed(2)),
                width: Number((right - left).toFixed(2))
            },
            y: Number(y.toFixed(2)),
            usableWidth: Number(usableWidth.toFixed(2)),
            fits: usableWidth >= Math.max(targetWidth, minWidth)
        };
        candidates.push(candidate);
    }

    if (!candidates.length) return null;
    const fittingCandidates = candidates.filter((candidate) => candidate.fits);
    let best = null;
    if (fittingCandidates.length > 0) {
        if (prefer === 'top-right') {
            best = fittingCandidates.sort((a, b) => {
                if (b.range.right !== a.range.right) return b.range.right - a.range.right;
                return a.y - b.y;
            })[0];
        } else {
            best = fittingCandidates[0];
        }
    } else {
        best = candidates.sort((a, b) => {
            if (b.usableWidth !== a.usableWidth) return b.usableWidth - a.usableWidth;
            if (prefer === 'top-right') {
                if (b.range.right !== a.range.right) return b.range.right - a.range.right;
                return a.y - b.y;
            }
            return b.y - a.y;
        })[0];
    }
    if (!best) return null;
    const deltaX = lockPosition ? 0 : (anchorX - defaultAnchorX);
    const deltaY = lockPosition ? 0 : (anchorY - defaultAnchorY);
    const travelX = Math.max(shortSide * 0.45, 10);
    const travelY = Math.max(shortSide * 0.5, 10);
    const leftLimit = best.range.left + paddingX;
    const rightLimit = best.range.right - paddingX;
    const baseX = isLeft ? leftLimit : rightLimit;
    const shiftedX = isLeft
        ? Math.min(Math.max(baseX + deltaX * travelX, leftLimit), rightLimit)
        : Math.max(Math.min(baseX + deltaX * travelX, rightLimit), leftLimit);
    return {
        x: Number(shiftedX.toFixed(2)),
        y: Number((best.y + deltaY * travelY).toFixed(2)),
        maxWidth: Math.max(best.usableWidth, minWidth),
        range: best.range
    };
}

window.renderBoothMapItemText = function(item, widthPx, heightPx, runtimeItem, mode = 'editor', map = null, clipPathId = '') {
    const shortSide = Math.max(Math.min(widthPx, heightPx), 16);
    const paddingX = Math.max(2.5, Math.min(widthPx, heightPx) * 0.038);
    const paddingY = Math.max(2.5, Math.min(widthPx, heightPx) * 0.034);
    const edgeInsetX = Math.max(0.8, Math.min(widthPx, heightPx) * 0.012);
    const edgeInsetY = Math.max(0.4, Math.min(widthPx, heightPx) * 0.008);
    const textConfig = window.getBoothMapTextConfigForItem(item, map);
    const boothNoConfig = textConfig.boothNo;
    const companyConfig = textConfig.company;
    const sizeConfig = textConfig.size || { anchorX: 0.93, anchorY: 0.08, fontSize: 13, visible: false };
    const isSpecialShape = String(item.shape_type || 'rect').trim() !== 'rect';
    const boothNoLetterSpacing = isSpecialShape ? -0.08 : -0.14;
    const companyLetterSpacing = -0.08;
    const fontFamily = window.getBoothMapTextFontFamily();
    const localPoints = isSpecialShape ? window.getBoothMapLocalPoints(item, widthPx, heightPx) : [];
    const boothPlacement = isSpecialShape
        ? window.findBoothMapPolygonLabelPlacement(localPoints, {
            prefer: 'bottom-left',
            paddingX,
            paddingY,
            targetWidth: window.measureBoothMapText(item.booth_code || '', boothNoConfig.fontSize, boothNoLetterSpacing),
            textHeight: boothNoConfig.fontSize,
            minWidth: 18,
            shortSide,
            anchorX: boothNoConfig.anchorX,
            anchorY: boothNoConfig.anchorY,
            defaultAnchorX: 0.02,
            defaultAnchorY: 0.93,
            lockPosition: true
        })
        : null;
    const boothLine = window.fitBoothMapSingleLineBlock(
        item.booth_code || '',
        boothNoConfig.fontSize,
        Math.max(isSpecialShape ? Number(boothPlacement?.maxWidth || 20) : widthPx - edgeInsetX * 1.2, 20),
        Math.max(shortSide * (isSpecialShape ? 0.34 : 0.46), 10),
        boothNoLetterSpacing
    );
    const companyText = mode === 'preview' ? (runtimeItem?.company_text || '') : '';
    const textMarkup = [];
    const escapedFontFamily = window.escapeAttr ? window.escapeAttr(fontFamily) : fontFamily.replace(/"/g, '&quot;');

    if (boothNoConfig.visible && boothLine.text) {
        const boothAnchor = 'start';
        const boothX = isSpecialShape
            ? Number(boothPlacement?.x || edgeInsetX + (widthPx - edgeInsetX * 2) * boothNoConfig.anchorX)
            : edgeInsetX + (widthPx - edgeInsetX * 2) * boothNoConfig.anchorX;
        const boothY = isSpecialShape
            ? Number(boothPlacement?.y || (heightPx - Math.max(edgeInsetY + shortSide * 0.14, 8)))
            : heightPx - Math.max(edgeInsetY + shortSide * 0.14, 8) + window.getBoothMapLabelYOffsetFromEdge(
                boothNoConfig.anchorY,
                shortSide,
                0.93,
                0.5
            );
        textMarkup.push(`
            <text
                x="${boothX.toFixed(2)}"
                y="${boothY.toFixed(2)}"
                font-size="${boothLine.fontSize}"
                font-weight="800"
                font-family="${escapedFontFamily}"
                fill="#0f172a"
                text-anchor="${boothAnchor}"
                dominant-baseline="ideographic"
                letter-spacing="${boothNoLetterSpacing}em"
            >${window.escapeBoothMapText(boothLine.text)}</text>
        `);
    }

    if (companyConfig.visible && companyText) {
        const availableWidth = Math.max(widthPx - paddingX * 1.8, 18);
        const availableHeight = Math.max(heightPx - paddingY * 2.1, 12);
        const companyBlock = window.fitBoothMapCompanyBlock(companyText, companyConfig.fontSize, availableWidth, availableHeight, 2, companyLetterSpacing);
        const companyLines = companyBlock.lines;
        const baseX = paddingX + (widthPx - paddingX * 2) * companyConfig.anchorX;
        const baseY = paddingY + (heightPx - paddingY * 2) * companyConfig.anchorY;
        companyLines.forEach((line, index) => {
            const lineOffset = (index - (companyLines.length - 1) / 2) * companyBlock.lineHeight;
            textMarkup.push(`
                <text
                    x="${baseX.toFixed(2)}"
                    y="${(baseY + lineOffset).toFixed(2)}"
                    font-size="${companyBlock.fontSize}"
                    font-weight="700"
                    font-family="${escapedFontFamily}"
                    fill="#0f172a"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    letter-spacing="${companyLetterSpacing}em"
                >${window.escapeBoothMapText(line)}</text>
            `);
        });
    }

    if (String(item.booth_type || '').trim() === '光地' && sizeConfig.visible) {
        const sizeText = String(item.shape_type || '').trim() === 'polygon'
            ? `${window.formatBoothMapMetricText(item.area || 0)}㎡`
            : `${window.formatBoothMapMetricText(item.width_m || 0)}*${window.formatBoothMapMetricText(item.height_m || 0)}`;
        const sizePlacement = isSpecialShape
            ? window.findBoothMapPolygonLabelPlacement(localPoints, {
            prefer: 'top-right',
            paddingX,
            paddingY,
            targetWidth: window.measureBoothMapText(sizeText, sizeConfig.fontSize, 0),
            textHeight: sizeConfig.fontSize,
            minWidth: 22,
                shortSide,
                anchorX: sizeConfig.anchorX,
                anchorY: sizeConfig.anchorY,
                defaultAnchorX: 0.98,
                defaultAnchorY: 0.02,
                lockPosition: true
            })
            : null;
        const sizeLine = window.fitBoothMapSingleLineBlock(
            sizeText,
            sizeConfig.fontSize,
            Math.max((isSpecialShape ? Number(sizePlacement?.maxWidth || (widthPx * 0.72)) : widthPx - paddingX * 2), 20),
            Math.max(shortSide * 0.3, 10),
            0
        );
        const sizeX = isSpecialShape
            ? Number(sizePlacement?.x || (edgeInsetX + (widthPx - edgeInsetX * 2) * sizeConfig.anchorX))
            : edgeInsetX + (widthPx - edgeInsetX * 2) * sizeConfig.anchorX;
        const sizeY = isSpecialShape
            ? Number(sizePlacement?.y || Math.max(edgeInsetY + shortSide * 0.08, 5))
            : Math.max(edgeInsetY + shortSide * 0.08, 5) + window.getBoothMapLabelYOffsetFromEdge(
                sizeConfig.anchorY,
                shortSide,
                0.02,
                0.34
            );
        textMarkup.push(`
            <text
                x="${sizeX.toFixed(2)}"
                y="${sizeY.toFixed(2)}"
                font-size="${sizeLine.fontSize}"
                font-weight="700"
                font-family="${escapedFontFamily}"
                fill="#334155"
                text-anchor="end"
                dominant-baseline="hanging"
            >${window.escapeBoothMapText(sizeLine.text)}</text>
        `);
    }

    if (!textMarkup.length) return '';
    if (!clipPathId) return textMarkup.join('');
    return `<g clip-path="url(#${clipPathId})">${textMarkup.join('')}</g>`;
}

window.renderBoothMapResizeHandles = function(widthPx, heightPx) {
    const handleSize = 12;
    const edgeThickness = 14;
    const half = handleSize / 2;
    const handles = [
        { key: 'nw', x: -half, y: -half, cursor: 'nwse-resize' },
        { key: 'ne', x: widthPx - half, y: -half, cursor: 'nesw-resize' },
        { key: 'sw', x: -half, y: heightPx - half, cursor: 'nesw-resize' },
        { key: 'se', x: widthPx - half, y: heightPx - half, cursor: 'nwse-resize' }
    ];
    const edges = [
        { key: 'n', x: widthPx * 0.22, y: -edgeThickness / 2, width: widthPx * 0.56, height: edgeThickness, cursor: 'ns-resize' },
        { key: 's', x: widthPx * 0.22, y: heightPx - edgeThickness / 2, width: widthPx * 0.56, height: edgeThickness, cursor: 'ns-resize' },
        { key: 'w', x: -edgeThickness / 2, y: heightPx * 0.22, width: edgeThickness, height: heightPx * 0.56, cursor: 'ew-resize' },
        { key: 'e', x: widthPx - edgeThickness / 2, y: heightPx * 0.22, width: edgeThickness, height: heightPx * 0.56, cursor: 'ew-resize' }
    ];
    return `
        ${edges.map((edge) => `
            <rect
                data-resize-handle="${edge.key}"
                x="${edge.x.toFixed(2)}"
                y="${edge.y.toFixed(2)}"
                width="${Math.max(edge.width, edgeThickness).toFixed(2)}"
                height="${Math.max(edge.height, edgeThickness).toFixed(2)}"
                fill="transparent"
                style="cursor:${edge.cursor}"
            ></rect>
        `).join('')}
        ${handles.map((handle) => `
            <rect
                data-resize-handle="${handle.key}"
                x="${handle.x.toFixed(2)}"
                y="${handle.y.toFixed(2)}"
                width="${handleSize}"
                height="${handleSize}"
                rx="2"
                ry="2"
                fill="#ffffff"
                stroke="#0f172a"
                stroke-width="2"
                style="cursor:${handle.cursor}"
            ></rect>
        `).join('')}
    `;
}

window.renderBoothMapItem = function(item, mode = 'editor') {
    const state = window.getBoothMapState();
    const { widthPx, heightPx } = window.getBoothMapItemSizePx(item);
    const runtimeItem = window.getBoothMapRuntimeItem(item.booth_code);
    const isSearchHighlighted = mode === 'editor' && String(state.searchHighlightItemId || '') === String(item.id);
    const fillColor = mode === 'preview'
        ? (runtimeItem?.fill_color || '#ffffff')
        : (isSearchHighlighted ? '#fca5a5' : '#e2e8f0');
    const isDirty = mode === 'editor' && !!item._dirty;
    const strokeColor = mode === 'preview'
        ? (runtimeItem?.stroke_color || '#15803d')
        : (isSearchHighlighted ? '#b91c1c' : (isDirty ? '#dc2626' : '#0f172a'));
    const selected = window.isBoothMapItemSelected(item.id);
    const centerX = widthPx / 2;
    const centerY = heightPx / 2;
    const baseStrokeWidth = window.getBoothMapStrokeWidth();
    const localPoints = window.getBoothMapLocalPoints(item, widthPx, heightPx);
    const pointsMarkup = window.getBoothMapPointsMarkup(localPoints);
    const clipPathId = `booth-map-clip-${mode}-${String(item.id || item.booth_code || 'item').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    const clipMarkup = String(item.shape_type || 'rect') === 'rect'
        ? `<clipPath id="${clipPathId}"><rect x="0" y="0" width="${widthPx}" height="${heightPx}"></rect></clipPath>`
        : `<clipPath id="${clipPathId}"><polygon points="${pointsMarkup}"></polygon></clipPath>`;
    const labelMarkup = window.renderBoothMapItemText(item, widthPx, heightPx, runtimeItem, mode, null, clipPathId);
    const shapeMarkup = String(item.shape_type || 'rect') === 'rect'
        ? `
            <rect
                x="0"
                y="0"
                width="${widthPx}"
                height="${heightPx}"
                fill="${fillColor}"
                fill-opacity="0.82"
                stroke="${strokeColor}"
                stroke-width="${mode === 'editor' && (selected || isSearchHighlighted) ? Math.max(baseStrokeWidth + 1.4, 3.4) : baseStrokeWidth}"
                stroke-dasharray="${mode === 'editor' && isDirty ? '10 6' : '0'}"
            ></rect>
        `
        : `
            <polygon
                points="${pointsMarkup}"
                fill="${fillColor}"
                fill-opacity="0.82"
                stroke="${strokeColor}"
                stroke-width="${mode === 'editor' && (selected || isSearchHighlighted) ? Math.max(baseStrokeWidth + 1.4, 3.4) : baseStrokeWidth}"
                stroke-dasharray="${mode === 'editor' && isDirty ? '10 6' : '0'}"
                stroke-linejoin="round"
            ></polygon>
        `;
    const handleMarkup = mode === 'editor' && selected && window.getBoothMapSelectionCount() === 1
        ? window.renderBoothMapResizeHandles(widthPx, heightPx)
        : '';
    return `
        <g data-item-id="${window.escapeBoothMapText(item.id)}" transform="translate(${Number(item.x || 0)} ${Number(item.y || 0)}) rotate(${Number(item.rotation || 0)} ${centerX} ${centerY})">
            <defs>${clipMarkup}</defs>
            ${shapeMarkup}
            ${labelMarkup}
            ${handleMarkup}
        </g>
    `;
}

window.renderCurrentBoothMap = function() {
    const emptyEl = document.getElementById('booth-map-empty-state');
    const previewEmptyEl = document.getElementById('booth-map-preview-empty-state');
    const editorTitleEl = document.getElementById('booth-map-editor-title');
    const previewTitleEl = document.getElementById('booth-map-preview-title');
    const updatedAtEl = document.getElementById('booth-map-updated-at');
    const previewStatusEl = document.getElementById('booth-map-preview-status');
    const currentNameEl = document.getElementById('booth-map-current-name');
    const svg = window.getBoothMapSvg();
    const runtimeSvg = window.getBoothMapRuntimeSvg();
    if (!svg) return;

    if (!currentBoothMap) {
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (previewEmptyEl) previewEmptyEl.classList.remove('hidden');
        if (editorTitleEl) editorTitleEl.innerText = '未选择画布';
        if (previewTitleEl) previewTitleEl.innerText = '未选择画布';
        if (updatedAtEl) updatedAtEl.innerText = '尚未创建画布';
        if (previewStatusEl) {
            previewStatusEl.innerText = '未加载画布';
            previewStatusEl.className = 'text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-full';
        }
        if (currentNameEl) currentNameEl.value = '';
        svg.innerHTML = '';
        if (runtimeSvg) runtimeSvg.innerHTML = '';
        window.updateBoothMapPolygonStatus();
        window.populateBoothMapPropertyPanel();
        window.updateBoothMapSaveSummary();
        return;
    }

    if (emptyEl) emptyEl.classList.add('hidden');
    if (previewEmptyEl) previewEmptyEl.classList.add('hidden');
    if (editorTitleEl) editorTitleEl.innerText = currentBoothMap.name || '未命名画布';
    if (previewTitleEl) previewTitleEl.innerText = currentBoothMap.name || '未命名画布';
    if (updatedAtEl) updatedAtEl.innerText = currentBoothMap.updated_at ? `上次保存：${currentBoothMap.updated_at}` : '尚未保存';
    if (previewStatusEl && !boothMapDirty) {
        previewStatusEl.innerText = currentBoothMapRuntimeItems.length ? '状态已加载' : '等待刷新状态';
        previewStatusEl.className = currentBoothMapRuntimeItems.length
            ? 'text-xs font-bold text-emerald-700 bg-emerald-100 px-3 py-2 rounded-full'
            : 'text-xs font-bold text-slate-500 bg-slate-100 px-3 py-2 rounded-full';
    }
    if (currentNameEl) currentNameEl.value = currentBoothMap.name || '';
    window.updateBoothMapPolygonStatus();
    const backgroundHref = window.getAuthorizedAssetUrl(
        window.getBoothMapBackgroundApiUrl(currentBoothMap),
        () => window.renderCurrentBoothMap()
    );
    const backgroundRect = window.getBoothMapRenderedBackgroundRect(currentBoothMap);

    window.applyBoothMapViewBox();
    svg.innerHTML = `
        <rect x="0" y="0" width="${Number(currentBoothMap.canvas_width || 1600)}" height="${Number(currentBoothMap.canvas_height || 900)}" fill="#ffffff" fill-opacity="0.28" stroke="#cbd5e1" stroke-width="1"></rect>
        ${backgroundHref ? `<image href="${backgroundHref}" x="${backgroundRect.x}" y="${backgroundRect.y}" width="${backgroundRect.width}" height="${backgroundRect.height}" preserveAspectRatio="none" opacity="0.96"></image>` : ''}
        ${currentBoothMap.calibration_json?.start && currentBoothMap.calibration_json?.end ? `
            <line x1="${Number(currentBoothMap.calibration_json.start.x || 0)}" y1="${Number(currentBoothMap.calibration_json.start.y || 0)}" x2="${Number(currentBoothMap.calibration_json.end.x || 0)}" y2="${Number(currentBoothMap.calibration_json.end.y || 0)}" stroke="#0ea5e9" stroke-width="3" stroke-dasharray="12 8"></line>
        ` : ''}
        ${window.getBoothMapState().scaleStartPoint ? `
            <circle cx="${window.getBoothMapState().scaleStartPoint.x}" cy="${window.getBoothMapState().scaleStartPoint.y}" r="10" fill="#0ea5e9" fill-opacity="0.22" stroke="#0284c7" stroke-width="2"></circle>
        ` : ''}
        ${(currentBoothMapItems || []).sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0)).map((item) => window.renderBoothMapItem(item, 'editor')).join('')}
        ${window.getBoothMapState().selectionRect ? `
            <rect
                x="${window.getBoothMapState().selectionRect.x}"
                y="${window.getBoothMapState().selectionRect.y}"
                width="${window.getBoothMapState().selectionRect.width}"
                height="${window.getBoothMapState().selectionRect.height}"
                fill="#93c5fd"
                fill-opacity="0.12"
                stroke="#2563eb"
                stroke-width="2"
                stroke-dasharray="8 6"
            ></rect>
        ` : ''}
        ${window.getBoothMapState().draftRect ? `
            <rect
                x="${window.getBoothMapState().draftRect.x}"
                y="${window.getBoothMapState().draftRect.y}"
                width="${window.getBoothMapState().draftRect.width}"
                height="${window.getBoothMapState().draftRect.height}"
                fill="#93c5fd"
                fill-opacity="0.22"
                stroke="#2563eb"
                stroke-width="2"
                stroke-dasharray="10 6"
            ></rect>
        ` : ''}
        ${window.renderBoothMapPolygonDraft()}
    `;
    if (runtimeSvg) {
        window.applyBoothMapPreviewViewBox();
        runtimeSvg.innerHTML = `
            <rect x="0" y="0" width="${Number(currentBoothMap.canvas_width || 1600)}" height="${Number(currentBoothMap.canvas_height || 900)}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"></rect>
            ${backgroundHref ? `<image href="${backgroundHref}" x="${backgroundRect.x}" y="${backgroundRect.y}" width="${backgroundRect.width}" height="${backgroundRect.height}" preserveAspectRatio="none" opacity="0.96"></image>` : ''}
            ${(currentBoothMapItems || []).sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0)).map((item) => window.renderBoothMapItem(item, 'preview')).join('')}
        `;
        window.applyBoothMapPreviewViewBox();
    }
    window.populateBoothMapPropertyPanel();
    window.updateBoothMapSaveSummary();
}

window.validateBoothMapBeforeSave = function() {
    return window.validateBoothMapItems(currentBoothMapItems || [], {
        comparisonItems: currentBoothMapItems || []
    });
}

window.buildBoothMapItemsPayload = function(items = []) {
    return (Array.isArray(items) ? items : []).map((item, index) => ({
        id: item.id,
        booth_code: window.normalizeBoothCode(item.booth_code),
        previous_booth_code: window.normalizeBoothCode(item._persistedBoothCode),
        hall: window.normalizeHallLabel(window.resolveBoothMapHallValue(item) || ''),
        booth_type: item.booth_type,
        opening_type: item.booth_type === '光地' ? '' : item.opening_type,
        width_m: Number(item.width_m || 0),
        height_m: Number(item.height_m || 0),
        area: window.calculateBoothMapItemArea(item),
        x: Number(item.x || 0),
        y: Number(item.y || 0),
        rotation: Number(item.rotation || 0),
        stroke_width: window.getBoothMapStrokeWidth(),
        shape_type: String(item.shape_type || 'rect').trim() || 'rect',
        points_json: Array.isArray(item.points_json) ? item.points_json : [],
        label_style: item.label_style || {},
        z_index: Number(item.z_index || index + 1),
        hidden: Number(item.hidden || 0)
    }));
}

window.getBlockedBoothMapRemovedCodes = function(boothCodes = []) {
    const state = window.getBoothMapState();
    const runtimeMap = state.runtimeByBoothCode || {};
    return Array.from(new Set((Array.isArray(boothCodes) ? boothCodes : [])
        .map((code) => String(code || '').trim().toUpperCase())
        .filter(Boolean)))
        .filter((code) => ['reserved', 'deposit', 'full_paid'].includes(String(runtimeMap[code]?.status_code || '')));
}

window.persistBoothMapChanges = async function(options = {}) {
    if (!currentBoothMapId || !currentBoothMap) throw new Error('请先新建或选择一个画布');
    const projectId = window.getBoothMapProjectId();
    const state = window.getBoothMapState();
    const items = Array.isArray(options.items) ? options.items : (currentBoothMapItems || []);
    const replaceAll = options.replaceAll !== false;
    const deletedBoothCodes = Array.isArray(options.deletedBoothCodes) ? options.deletedBoothCodes : (state.removedPersistedCodes || []);
    const blockedRemovedCodes = window.getBlockedBoothMapRemovedCodes(deletedBoothCodes);
    if (blockedRemovedCodes.length > 0) {
        const previewText = blockedRemovedCodes.slice(0, 5).join('、');
        const suffix = blockedRemovedCodes.length > 5 ? ' 等' : '';
        throw new Error(`以下展位已被订单占用，不能删除：${previewText}${suffix}。如刚删除过，请刷新画布后重试。`);
    }
    const zoom = Number((Number(currentBoothMap.canvas_width || 1600) / Math.max(Number(state.viewBox.width || 1), 1)).toFixed(4));

    const metaData = await window.readApiSuccessJson(
        await window.apiFetch('/api/update-booth-map', {
            method: 'POST',
            body: JSON.stringify({
                id: currentBoothMapId,
                projectId,
                name: currentBoothMap.name,
                scale_pixels_per_meter: Number(currentBoothMap.scale_pixels_per_meter || 0),
                default_stroke_width: window.getBoothMapStrokeWidth(),
                canvas_width: currentBoothMap.canvas_width,
                canvas_height: currentBoothMap.canvas_height,
                viewport_x: Number(state.viewBox.x || 0),
                viewport_y: Number(state.viewBox.y || 0),
                viewport_zoom: zoom,
                calibration_json: currentBoothMap.calibration_json || {},
                display_config_json: window.ensureCurrentBoothMapDisplayConfig()
            })
        }),
        '保存画布信息失败',
        {}
    );

    const itemData = await window.readApiSuccessJson(
        await window.apiFetch('/api/save-booth-map-items', {
            method: 'POST',
            body: JSON.stringify({
                projectId,
                mapId: currentBoothMapId,
                replaceAll,
                deleted_booth_codes: deletedBoothCodes,
                items: window.buildBoothMapItemsPayload(items)
            })
        }),
        '保存展位图失败',
        {}
    );
    currentBoothMap.updated_at = itemData.updated_at || metaData.updated_at || currentBoothMap.updated_at;
    return itemData;
}

window.saveBoothMap = async function() {
    if (!currentBoothMapId || !currentBoothMap) return window.showToast('请先新建或选择一个画布', 'error');
    const projectId = window.getBoothMapProjectId();
    const name = String(currentBoothMap.name || '').trim();
    if (!name) return window.showToast('请填写画布名称', 'error');
    const errors = window.validateBoothMapBeforeSave();
    if (errors.length > 0) return window.showToast(errors[0], 'error');

    currentBoothMap.name = name;
    currentBoothMap.default_stroke_width = window.getBoothMapStrokeWidth();
    window.syncBoothMapItemsStrokeWidth();

    try {
        await window.withButtonLoading('btn-save-booth-map', async () => {
            const itemData = await window.persistBoothMapChanges({
                items: currentBoothMapItems || [],
                replaceAll: true
            });
            boothMapDirty = false;
            await window.loadBoothMaps(currentBoothMapId);
            window.showToast(`展位图已保存，共同步 ${Number(itemData.synced_booth_count || 0)} 个展位`);
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.saveBoothMapQuick = async function() {
    if (!currentBoothMapId || !currentBoothMap) return window.showToast('请先新建或选择一个画布', 'error');
    const name = String(currentBoothMap.name || '').trim();
    if (!name) return window.showToast('请填写画布名称', 'error');

    const summary = window.getBoothMapSavableSummary();
    const deletedBoothCodes = [...(window.getBoothMapState().removedPersistedCodes || [])];
    const hasDirtyMetaOnly = boothMapDirty && summary.dirtyItems.length === 0 && deletedBoothCodes.length === 0;
    if (summary.savableItems.length === 0 && !hasDirtyMetaOnly && deletedBoothCodes.length === 0) {
        return window.showToast(summary.blockedItems[0]?.error || '当前没有可保存的展位', 'error');
    }

    const canReplaceAll = summary.blockedItems.length === 0;
    const targetItems = canReplaceAll ? (currentBoothMapItems || []) : summary.savableItems;

    try {
        await window.withButtonLoading('btn-save-booth-map', async () => {
            const itemData = await window.persistBoothMapChanges({
                items: targetItems,
                replaceAll: canReplaceAll,
                deletedBoothCodes
            });
            const savedIdSet = new Set(summary.savableItems.map((item) => String(item.id)));
            (currentBoothMapItems || []).forEach((item) => {
                if (canReplaceAll || savedIdSet.has(String(item.id))) {
                    item._dirty = false;
                    item._persistedBoothCode = window.normalizeBoothCode(item.booth_code);
                    item.area = window.calculateBoothMapItemArea(item);
                }
            });
            currentBoothMap.updated_at = itemData.updated_at || currentBoothMap.updated_at;
            if (deletedBoothCodes.length > 0) {
                window.clearBoothMapRemovedPersistedCodes();
            }
            boothMapDirty = (currentBoothMapItems || []).some((item) => item._dirty) || summary.blockedItems.length > 0;
            window.renderCurrentBoothMap();
            if (summary.blockedItems.length > 0) {
                window.showToast(`已保存 ${summary.savableItems.length} 个展位，另有 ${summary.blockedItems.length} 个待完善`, 'info');
            } else if (deletedBoothCodes.length > 0) {
                window.showToast(`已保存 ${summary.savableItems.length} 个展位，并同步删除 ${deletedBoothCodes.length} 个展位`);
            } else if (hasDirtyMetaOnly) {
                window.showToast('画布属性已保存');
            } else {
                window.showToast(`已保存 ${summary.savableItems.length} 个展位`);
            }
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.saveSelectedBoothMapItem = async function() {
    const item = window.getSelectedBoothMapItem();
    if (!item) return window.showToast('请先选择一个展位', 'error');
    const errors = window.validateBoothMapItems([item], {
        comparisonItems: currentBoothMapItems || []
    });
    if (errors.length > 0) return window.showToast(errors[0], 'error');
    try {
        await window.withButtonLoading('btn-save-selected-booth-map-item', async () => {
            const itemData = await window.persistBoothMapChanges({
                items: [item],
                replaceAll: false
            });
            item._dirty = false;
            item._persistedBoothCode = window.normalizeBoothCode(item.booth_code);
            currentBoothMap.updated_at = itemData.updated_at || currentBoothMap.updated_at;
            boothMapDirty = (currentBoothMapItems || []).some((candidate) => candidate._dirty);
            window.renderCurrentBoothMap();
            window.showToast(`展位 ${item.booth_code} 已保存`);
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.uploadBoothMapBackground = async function(input) {
    if (!currentBoothMapId) {
        input.value = '';
        return window.showToast('请先新建或选择一个画布', 'error');
    }
    const file = input?.files?.[0];
    if (!file) return;
    try {
        await window.withButtonLoading('btn-upload-booth-map-background', async () => {
            const previousAssetUrl = window.getBoothMapBackgroundApiUrl(currentBoothMap);
            const imageMeta = await window.readImageFileMeta(file);
            const previousBackgroundConfig = window.getBoothMapBackgroundConfig(currentBoothMap);
            const hadPlacement = Number(previousBackgroundConfig.naturalWidth || 0) > 0 && Number(previousBackgroundConfig.naturalHeight || 0) > 0;
            const previousBackgroundRect = window.getBoothMapRenderedBackgroundRect(currentBoothMap);
            const shouldPromoteWorkspaceToImage = (
                Math.abs(Number(currentBoothMap.canvas_width || 0) - Number(imageMeta.width || 0)) > 1
                || Math.abs(Number(currentBoothMap.canvas_height || 0) - Number(imageMeta.height || 0)) > 1
            ) && (
                !hadPlacement
                || Number(currentBoothMap.canvas_width || 0) <= 1800
                || Number(currentBoothMap.canvas_height || 0) <= 1000
                || Number(previousBackgroundConfig.naturalWidth || 0) <= 0
                || Number(previousBackgroundConfig.naturalHeight || 0) <= 0
            );
            const formData = new FormData();
            formData.append('file', file);
            formData.append('projectId', String(window.getBoothMapProjectId()));
            formData.append('mapId', String(currentBoothMapId));
            const data = await window.readApiSuccessJson(
                await window.apiFetch('/api/upload-booth-map-background', {
                    method: 'POST',
                    body: formData
                }),
                '底图上传失败',
                {}
            );
            window.revokeAuthorizedAssetUrl(previousAssetUrl);
            currentBoothMap.background_image_key = data.fileKey;
            if (shouldPromoteWorkspaceToImage) {
                window.migrateBoothMapWorkspaceToNaturalImage(previousBackgroundRect, imageMeta);
            }
            window.updateBoothMapBackgroundFromImageMeta(imageMeta, { keepPlacement: !shouldPromoteWorkspaceToImage });
            if (shouldPromoteWorkspaceToImage && (currentBoothMapItems || []).length > 0) {
                await window.persistBoothMapChanges({
                    items: currentBoothMapItems || [],
                    replaceAll: true
                });
                (currentBoothMapItems || []).forEach((item) => {
                    item._dirty = false;
                });
                boothMapDirty = false;
            } else {
                await window.persistCurrentBoothMapMeta();
            }
            window.renderCurrentBoothMap();
            window.showToast(
                shouldPromoteWorkspaceToImage
                    ? '底图上传成功，整张画布已升级为原图像素尺寸'
                    : (hadPlacement
                        ? '底图上传成功，已沿用上一稿底图定位与比例'
                        : '底图上传成功，已按原图比例自动适配')
            );
        });
    } catch (error) {
        window.showToast(error.message, 'error');
    } finally {
        input.value = '';
    }
}

window.deleteBoothMapBackground = async function() {
    if (!currentBoothMapId) return window.showToast('请先选择一个画布', 'error');
    if (!confirm('确定移除当前画布底图吗？')) return;
    try {
        const previousAssetUrl = window.getBoothMapBackgroundApiUrl(currentBoothMap);
        await window.readApiSuccessJson(
            await window.apiFetch('/api/delete-booth-map-background', {
                method: 'POST',
                body: JSON.stringify({ mapId: currentBoothMapId, projectId: window.getBoothMapProjectId() })
            }),
            '删除底图失败',
            {}
        );
        window.revokeAuthorizedAssetUrl(previousAssetUrl);
        currentBoothMap.background_image_key = '';
        window.setBoothMapDirty(true);
        window.renderCurrentBoothMap();
        window.showToast('底图已移除');
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}
