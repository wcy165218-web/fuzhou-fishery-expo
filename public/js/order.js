// ================= js/order.js =================
window.currentAllocatedArea = 0; // 全局存储本次分配的展位面积
window.selectedOrderBooths = [];
window.orderNoBooth = false;
window.orderFieldSettingsMap = window.orderFieldSettingsMap || {};
window.orderBoothMapPicker = window.orderBoothMapPicker || {
    mode: 'order',
    maps: [],
    currentMapId: 0,
    currentMap: null,
    runtimeItems: [],
    tempSelectedBooths: [],
    viewBox: { x: 0, y: 0, width: 1600, height: 900 },
    pointerMode: '',
    pointerStartClient: null,
    pointerStartViewBox: null,
    pointerDownBoothCode: '',
    dragMoved: false,
    focusedBoothCode: '',
    initialized: false,
    onConfirm: null
};
window.orderBoothMapPointerUpHandler = window.orderBoothMapPointerUpHandler || (() => window.onOrderBoothMapPointerUp());
window.orderBoothMapPointerDownHandler = window.orderBoothMapPointerDownHandler || ((event) => window.onOrderBoothMapPointerDown(event));
window.orderBoothMapPointerMoveHandler = window.orderBoothMapPointerMoveHandler || ((event) => window.onOrderBoothMapPointerMove(event));
window.orderBoothMapWheelHandler = window.orderBoothMapWheelHandler || ((event) => window.onOrderBoothMapWheel(event));

window.formatOrderMoney = function(value) {
    return window.formatCurrency(Number(value || 0));
}

window.isOrderFieldEnabled = function(fieldKey) {
    const setting = window.orderFieldSettingsMap?.[fieldKey];
    return setting ? Number(setting.enabled || 0) === 1 : true;
}

window.isOrderFieldRequired = function(fieldKey) {
    const setting = window.orderFieldSettingsMap?.[fieldKey];
    return setting ? Number(setting.required || 0) === 1 : true;
}

window.setOrderFieldVisibility = function(fieldKey, visible) {
    const block = document.getElementById(`order-field-${fieldKey}-block`);
    if (!block) return;
    block.classList.toggle('hidden', !visible);
}

window.setOrderFieldRequiredMarker = function(fieldKey, required) {
    const marker = document.getElementById(`order-required-${fieldKey}`);
    if (!marker) return;
    marker.classList.toggle('hidden', !required);
}

window.applyOrderFieldSettings = function() {
    const fieldKeys = ['is_agent', 'company_name', 'credit_code', 'contact_person', 'phone', 'region', 'category', 'main_business', 'profile', 'booth_selection', 'actual_booth_fee', 'extra_fees', 'contract_upload'];
    fieldKeys.forEach((fieldKey) => {
        window.setOrderFieldVisibility(fieldKey, window.isOrderFieldEnabled(fieldKey));
        window.setOrderFieldRequiredMarker(fieldKey, window.isOrderFieldRequired(fieldKey));
    });

    const agentInput = document.getElementById('order-agent-name');
    if (agentInput) {
        if (!window.isOrderFieldEnabled('is_agent')) {
            const directRadio = document.querySelector('input[name="is_agent"][value="0"]');
            if (directRadio) directRadio.checked = true;
        }
        agentInput.placeholder = window.isOrderFieldRequired('agent_name') ? '请输入具体代理商公司名称 (必填)' : '请输入具体代理商公司名称（选填）';
    }

    if (!window.isOrderFieldEnabled('extra_fees')) {
        dynamicFees = [];
        window.renderDynamicFees();
    }

    if (!window.isOrderFieldEnabled('actual_booth_fee')) {
        const actualFeeInput = document.getElementById('order-actual-fee');
        if (actualFeeInput) actualFeeInput.value = currentStandardFee || 0;
    }

    if (!window.isOrderFieldEnabled('contract_upload')) {
        const contractInput = document.getElementById('order-contract');
        if (contractInput) contractInput.value = '';
    }

    window.toggleAgent();
    window.calculateFinalTotal();
    window.refreshOrderOverview();
};

window.countDisplayNameUnits = function(value) {
    return Array.from(String(value || '')).reduce((total, char) => total + (/[\u0000-\u00ff]/.test(char) ? 1 : 2), 0);
}

window.updateBoothDisplayNameCounter = function(kind) {
    const input = document.getElementById(kind === 'standard' ? 'order-standard-display-name' : 'order-ground-display-name');
    const counter = document.getElementById(kind === 'standard' ? 'order-standard-display-name-count' : 'order-ground-display-name-count');
    if (!input || !counter) return;
    const maxUnits = kind === 'standard' ? 8 : 24;
    const usedUnits = window.countDisplayNameUnits(input.value);
    const overLimit = usedUnits > maxUnits;
    counter.innerText = `${usedUnits} / ${maxUnits} 单位`;
    counter.className = `font-bold ${overLimit ? 'text-rose-600' : 'text-slate-500'}`;
    input.classList.toggle('border-rose-400', overLimit);
    input.classList.toggle('bg-rose-50', overLimit);
}

window.handleBoothDisplayNameInput = function(kind) {
    window.updateBoothDisplayNameCounter(kind);
    window.refreshOrderOverview();
}

window.updateBoothDisplayNamePanel = function() {
    const wrap = document.getElementById('order-booth-display-name-block');
    const standardWrap = document.getElementById('order-standard-display-name-wrap');
    const groundWrap = document.getElementById('order-ground-display-name-wrap');
    if (!wrap || !standardWrap || !groundWrap) return;

    const selectedBooths = Array.isArray(window.selectedOrderBooths) ? window.selectedOrderBooths : [];
    const hasStandardBooth = selectedBooths.some((item) => ['标摊', '豪标'].includes(String(item.type || '').trim()));
    const hasGroundBooth = selectedBooths.some((item) => String(item.type || '').trim() === '光地');
    const shouldShow = !window.orderNoBooth && selectedBooths.length > 0 && (hasStandardBooth || hasGroundBooth);

    wrap.classList.toggle('hidden', !shouldShow);
    standardWrap.classList.toggle('hidden', !hasStandardBooth || !shouldShow);
    groundWrap.classList.toggle('hidden', !hasGroundBooth || !shouldShow);

    if (!hasStandardBooth) {
        const input = document.getElementById('order-standard-display-name');
        if (input) input.value = '';
    }
    if (!hasGroundBooth) {
        const input = document.getElementById('order-ground-display-name');
        if (input) input.value = '';
    }

    window.updateBoothDisplayNameCounter('standard');
    window.updateBoothDisplayNameCounter('ground');
}

window.getOrderBoothMapPickerState = function() {
    return window.orderBoothMapPicker;
}

window.ensureOrderBoothMapPickerInitialized = function() {
    const state = window.getOrderBoothMapPickerState();
    if (state.initialized) return;
    const svg = document.getElementById('order-booth-map-svg');
    if (!svg) return;
    svg.addEventListener('pointerdown', window.orderBoothMapPointerDownHandler);
    svg.addEventListener('pointermove', window.orderBoothMapPointerMoveHandler);
    svg.addEventListener('wheel', window.orderBoothMapWheelHandler, { passive: false });
    window.addEventListener('pointerup', window.orderBoothMapPointerUpHandler);
    state.initialized = true;
}

window.getOrderBoothMapSvgPoint = function(event) {
    const svg = document.getElementById('order-booth-map-svg');
    if (window.getBoothMapSvgPointFromElement) {
        return window.getBoothMapSvgPointFromElement(svg, event);
    }
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

window.clampOrderBoothMapViewBox = function(viewBox, map) {
    const width = Number(map?.canvas_width || 1600);
    const height = Number(map?.canvas_height || 900);
    const safeWidth = Math.min(Math.max(Number(viewBox?.width || width), 180), width * 4);
    const safeHeight = Math.min(Math.max(Number(viewBox?.height || height), 120), height * 4);
    const minX = Math.min(0, width - safeWidth);
    const minY = Math.min(0, height - safeHeight);
    return {
        x: Number(Math.min(Math.max(Number(viewBox?.x || 0), minX), width).toFixed(2)),
        y: Number(Math.min(Math.max(Number(viewBox?.y || 0), minY), height).toFixed(2)),
        width: Number(safeWidth.toFixed(2)),
        height: Number(safeHeight.toFixed(2))
    };
}

window.applyOrderBoothMapViewBox = function() {
    const state = window.getOrderBoothMapPickerState();
    const svg = document.getElementById('order-booth-map-svg');
    if (!svg || !state.currentMap) return;
    state.viewBox = window.clampOrderBoothMapViewBox(state.viewBox, state.currentMap);
    svg.setAttribute('viewBox', `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.width} ${state.viewBox.height}`);
}

window.cloneOrderBoothSelectionList = function(items = []) {
    return JSON.parse(JSON.stringify(Array.isArray(items) ? items : []));
}

window.getOrderBoothMapSize = function(map) {
    return {
        width: Number(map?.canvas_width || 1600),
        height: Number(map?.canvas_height || 900)
    };
}

window.getOrderBoothMapScale = function(map) {
    const normalized = Number(map?.scale_pixels_per_meter || 0);
    return normalized > 0 ? normalized : 40;
}

window.getOrderBoothMapItemSizePx = function(item, map) {
    const scale = window.getOrderBoothMapScale(map);
    return {
        widthPx: Number((Number(item?.width_m || 0) * scale).toFixed(2)),
        heightPx: Number((Number(item?.height_m || 0) * scale).toFixed(2))
    };
}

window.focusOrderBoothMapItem = function(runtimeItem) {
    const state = window.getOrderBoothMapPickerState();
    if (!runtimeItem || !state.currentMap) return;
    const { widthPx, heightPx } = window.getOrderBoothMapItemSizePx(runtimeItem, state.currentMap);
    const centerX = Number(runtimeItem.x || 0) + widthPx / 2;
    const centerY = Number(runtimeItem.y || 0) + heightPx / 2;
    state.viewBox = window.clampOrderBoothMapViewBox({
        x: Number((centerX - state.viewBox.width / 2).toFixed(2)),
        y: Number((centerY - state.viewBox.height / 2).toFixed(2)),
        width: state.viewBox.width,
        height: state.viewBox.height
    }, state.currentMap);
}

window.searchOrderBoothMapBooth = function() {
    const state = window.getOrderBoothMapPickerState();
    if (!state.currentMap) return window.showToast('请先选择一张画布', 'error');
    const keyword = window.normalizeBoothCode(document.getElementById('order-booth-map-search')?.value || '');
    if (!keyword) return window.showToast('请输入要搜索的展位号', 'error');
    const exactItem = window.findItemByBoothCode(state.runtimeItems, keyword);
    const fuzzyItem = window.findItemByBoothCodeIncludes(state.runtimeItems, keyword);
    const matchedItem = exactItem || fuzzyItem;
    if (!matchedItem) return window.showToast(`当前画布未找到展位：${keyword}`, 'error');
    state.focusedBoothCode = window.normalizeBoothCode(matchedItem.booth_code);
    window.focusOrderBoothMapItem(matchedItem);
    window.renderOrderBoothMapSvg();
    window.showToast(`已定位到展位：${matchedItem.booth_code}`);
}

window.getOrderBoothMapSourceBooth = function(runtimeItem) {
    const boothCode = window.normalizeBoothCode(runtimeItem?.booth_code);
    const matched = window.findItemByBoothCode(allBooths, boothCode, 'id');
    if (matched) return matched;
    return {
        id: boothCode,
        hall: runtimeItem?.hall || '',
        type: runtimeItem?.booth_type || runtimeItem?.type || '标摊',
        area: Number(runtimeItem?.area || 0),
        base_price: 0,
        status: runtimeItem?.status_label || ''
    };
}

window.buildOrderBoothSelection = function(runtimeItem, allocatedArea, isJoint = false) {
    const sourceBooth = window.getOrderBoothMapSourceBooth(runtimeItem);
    const normalizedArea = Number((Number(allocatedArea || 0)).toFixed(2));
    const boothPricing = window.calculateBoothStandardFee(sourceBooth, normalizedArea);
    return {
        id: sourceBooth.id,
        hall: sourceBooth.hall,
        type: sourceBooth.type,
        area: normalizedArea,
        unit_price: boothPricing.priceUnit,
        unit_label: sourceBooth.type === '光地' ? `¥${boothPricing.priceUnit} /平米` : `¥${boothPricing.priceUnit} /个(9㎡)`,
        standard_fee: boothPricing.standardFee,
        price_unit: sourceBooth.type === '光地' ? '平米' : '个',
        is_joint: isJoint ? 1 : 0
    };
}

window.populateOrderBoothMapSelectOptions = function() {
    const state = window.getOrderBoothMapPickerState();
    const selectEl = document.getElementById('order-booth-map-select');
    if (!selectEl) return;
    const options = ['<option value="">请选择画布</option>'];
    (state.maps || []).forEach((map) => {
        options.push(`<option value="${Number(map.id)}" ${Number(map.id) === Number(state.currentMapId) ? 'selected' : ''}>${window.escapeHtml(map.name || '')}</option>`);
    });
    selectEl.innerHTML = options.join('');
}

window.renderOrderBoothMapSelectedList = function() {
    const state = window.getOrderBoothMapPickerState();
    const listEl = document.getElementById('order-booth-map-selected-list');
    const countEl = document.getElementById('order-booth-map-selected-count');
    if (countEl) {
        countEl.innerText = state.mode === 'swap'
            ? `已选目标 ${state.tempSelectedBooths.length} 个`
            : `暂选 ${state.tempSelectedBooths.length} 个`;
    }
    if (!listEl) return;
    if (!state.tempSelectedBooths.length) {
        listEl.innerHTML = `<span class="text-xs text-slate-400 italic">${state.mode === 'swap' ? '暂未选择目标展位' : '暂未选择展位'}</span>`;
        return;
    }
    listEl.innerHTML = state.tempSelectedBooths.map((item) => `
        <div class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-bold text-slate-700">
            <span>${window.escapeHtml(item.hall || '')} - ${window.escapeHtml(item.id || '')}</span>
            <span class="tabular-data text-slate-400">${Number(item.area || 0).toLocaleString()}㎡</span>
            <button type="button" onclick="window.removeTempOrderBoothSelection('${String(item.id).replace(/'/g, "\\'")}')" class="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="移除展位">
                ${window.renderIcon('close', 'h-3.5 w-3.5', 2.2)}
            </button>
        </div>
    `).join('');
}

window.renderOrderBoothMapSvg = function() {
    const state = window.getOrderBoothMapPickerState();
    const svg = document.getElementById('order-booth-map-svg');
    const emptyEl = document.getElementById('order-booth-map-empty-state');
    const titleEl = document.getElementById('order-booth-map-title');
    const tipEl = document.getElementById('order-booth-map-tip');
    if (!svg) return;
    const map = state.currentMap;
    if (!map) {
        svg.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (titleEl) titleEl.innerText = '未选择画布';
        if (tipEl) tipEl.innerText = state.mode === 'swap'
            ? '先选择一张已保存的展位图，再从右侧画布中点选一个目标展位。'
            : '先选择一张已保存的展位图，再从右侧画布中点选展位。';
        window.renderOrderBoothMapSelectedList();
        return;
    }

    const { width, height } = window.getOrderBoothMapSize(map);
    if (emptyEl) emptyEl.classList.add('hidden');
    if (titleEl) titleEl.innerText = map.name || '未命名画布';
    if (tipEl) {
        tipEl.innerText = state.runtimeItems.length
            ? (state.mode === 'swap' ? '点击右侧可售展位，作为本次换展位的目标展位。' : '点击右侧展位即可加入或移出本次订单。')
            : '当前画布暂未保存展位。';
    }
    const selectedIds = new Set((state.tempSelectedBooths || []).map((item) => String(item.id || '').trim().toUpperCase()));
    const focusedBoothCode = String(state.focusedBoothCode || '').trim().toUpperCase();
    const backgroundHref = window.getAuthorizedAssetUrl(
        map.background_image_key ? `/api/booth-map-asset/${encodeURIComponent(map.background_image_key)}?mapId=${Number(map.id)}` : '',
        () => window.renderOrderBoothMapSvg()
    );
    const backgroundRect = window.getBoothMapRenderedBackgroundRect
        ? window.getBoothMapRenderedBackgroundRect(map)
        : { x: 0, y: 0, width, height };
    svg.innerHTML = `
        <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff" stroke="#cbd5e1" stroke-width="1"></rect>
        ${backgroundHref ? `<image href="${backgroundHref}" x="${backgroundRect.x}" y="${backgroundRect.y}" width="${backgroundRect.width}" height="${backgroundRect.height}" preserveAspectRatio="none" opacity="0.96"></image>` : ''}
        ${(state.runtimeItems || []).map((item) => {
            const { widthPx, heightPx } = window.getOrderBoothMapItemSizePx(item, map);
            const points = window.getBoothMapLocalPoints ? window.getBoothMapLocalPoints(item, widthPx, heightPx) : [
                { x: 0, y: 0 },
                { x: widthPx, y: 0 },
                { x: widthPx, y: heightPx },
                { x: 0, y: heightPx }
            ];
            const pointsMarkup = window.getBoothMapPointsMarkup ? window.getBoothMapPointsMarkup(points) : points.map((point) => `${point.x},${point.y}`).join(' ');
            const normalizedBoothCode = window.normalizeBoothCode(item.booth_code);
            const selected = selectedIds.has(normalizedBoothCode);
            const focused = focusedBoothCode && focusedBoothCode === normalizedBoothCode;
            const fillColor = item.fill_color || '#ffffff';
            const strokeColor = selected ? '#2563eb' : (focused ? '#ea580c' : (item.stroke_color || '#0f172a'));
            const labelMarkup = window.renderBoothMapItemText
                ? window.renderBoothMapItemText(item, widthPx, heightPx, item, 'preview', map)
                : '';
            const shapeMarkup = String(item.shape_type || 'rect') === 'rect'
                ? `<rect x="0" y="0" width="${widthPx}" height="${heightPx}" fill="${fillColor}" fill-opacity="0.86" stroke="${strokeColor}" stroke-width="${selected ? 4 : (focused ? 4 : 2.2)}"></rect>`
                : `<polygon points="${pointsMarkup}" fill="${fillColor}" fill-opacity="0.86" stroke="${strokeColor}" stroke-width="${selected ? 4 : (focused ? 4 : 2.2)}" stroke-linejoin="round"></polygon>`;
            return `
                <g data-booth-code="${window.escapeHtml(item.booth_code || '')}" transform="translate(${Number(item.x || 0)} ${Number(item.y || 0)})" style="cursor:pointer">
                    ${shapeMarkup}
                    ${labelMarkup}
                </g>
            `;
        }).join('')}
    `;
    window.applyOrderBoothMapViewBox();
    window.renderOrderBoothMapSelectedList();
}

window.loadOrderBoothMapPickerMaps = async function(preferredMapId = 0) {
    const projectId = Number(document.getElementById('global-project-select')?.value || 0);
    if (!projectId) return window.showToast('请先选择项目', 'error');
    const state = window.getOrderBoothMapPickerState();
    const data = await window.readApiSuccessJson(
        await window.apiFetch(`/api/booth-maps?projectId=${projectId}`),
        '加载展位图失败',
        {}
    );
    state.maps = Array.isArray(data.items) ? data.items : [];
    window.populateOrderBoothMapSelectOptions();
    const targetMap = state.maps.find((map) => Number(map.id) === Number(preferredMapId || 0)) || state.maps[0] || null;
    if (targetMap) {
        await window.selectOrderBoothMapForPicker(targetMap.id);
    } else {
        state.currentMapId = 0;
        state.currentMap = null;
        state.runtimeItems = [];
        state.focusedBoothCode = '';
        window.renderOrderBoothMapSvg();
    }
}

window.selectOrderBoothMapForPicker = async function(mapId) {
    const projectId = Number(document.getElementById('global-project-select')?.value || 0);
    const state = window.getOrderBoothMapPickerState();
    if (!projectId || !mapId) {
        state.currentMapId = 0;
        state.currentMap = null;
        state.runtimeItems = [];
        state.focusedBoothCode = '';
        window.populateOrderBoothMapSelectOptions();
        window.renderOrderBoothMapSvg();
        return;
    }
    const data = await window.readApiSuccessJson(
        await window.apiFetch(`/api/booth-map-runtime-view?id=${Number(mapId)}&projectId=${projectId}`),
        '加载展位图失败',
        {}
    );
    state.currentMapId = Number(mapId);
    state.currentMap = data.map || null;
    state.runtimeItems = Array.isArray(data.items) ? data.items : [];
    state.focusedBoothCode = '';
    state.viewBox = {
        x: 0,
        y: 0,
        width: Number(state.currentMap?.canvas_width || 1600),
        height: Number(state.currentMap?.canvas_height || 900)
    };
    window.populateOrderBoothMapSelectOptions();
    window.renderOrderBoothMapSvg();
}

window.handleOrderBoothMapSelectChange = async function(mapId) {
    try {
        await window.selectOrderBoothMapForPicker(Number(mapId || 0));
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.openOrderBoothMapPicker = async function() {
    if (window.orderNoBooth) return window.showToast('当前已选择无展位订单，请先取消后再选择展位', 'error');
    const projectId = Number(document.getElementById('global-project-select')?.value || 0);
    if (!projectId) return window.showToast('请先选择项目', 'error');
    window.ensureOrderBoothMapPickerInitialized();
    const state = window.getOrderBoothMapPickerState();
    state.mode = 'order';
    state.onConfirm = null;
    state.tempSelectedBooths = window.cloneOrderBoothSelectionList(window.selectedOrderBooths);
    try {
        const preferredBoothId = window.normalizeBoothCode(state.tempSelectedBooths[0]?.id || '');
        const preferredMapId = preferredBoothId
            ? Number(window.findItemByBoothCode(allBooths, preferredBoothId, 'id')?.booth_map_id || 0)
            : 0;
        await window.loadOrderBoothMapPickerMaps(preferredMapId);
        const confirmBtn = document.getElementById('btn-confirm-order-booth-map');
        if (confirmBtn) confirmBtn.innerText = '确认加入订单';
        document.getElementById('order-booth-map-modal')?.classList.remove('hidden');
    } catch (error) {
        window.showToast(error.message, 'error');
    }
}

window.closeOrderBoothMapPicker = function() {
    const state = window.getOrderBoothMapPickerState();
    const svg = document.getElementById('order-booth-map-svg');
    if (svg && state.initialized) {
        svg.removeEventListener('pointerdown', window.orderBoothMapPointerDownHandler);
        svg.removeEventListener('pointermove', window.orderBoothMapPointerMoveHandler);
        svg.removeEventListener('wheel', window.orderBoothMapWheelHandler);
        window.removeEventListener('pointerup', window.orderBoothMapPointerUpHandler);
        state.initialized = false;
    }
    state.focusedBoothCode = '';
    state.pointerMode = '';
    state.pointerStartClient = null;
    state.pointerStartViewBox = null;
    state.pointerDownBoothCode = '';
    state.dragMoved = false;
    const searchEl = document.getElementById('order-booth-map-search');
    if (searchEl) searchEl.value = '';
    document.getElementById('order-booth-map-modal')?.classList.add('hidden');
}

window.removeTempOrderBoothSelection = function(boothId) {
    const state = window.getOrderBoothMapPickerState();
    state.tempSelectedBooths = (state.tempSelectedBooths || []).filter((item) => String(item.id) !== String(boothId));
    window.renderOrderBoothMapSvg();
}

window.clearOrderBoothMapTempSelection = function() {
    const state = window.getOrderBoothMapPickerState();
    state.tempSelectedBooths = [];
    window.renderOrderBoothMapSvg();
}

window.buildSwapBoothCandidate = function(runtimeItem) {
    const sourceBooth = window.getOrderBoothMapSourceBooth(runtimeItem);
    const area = Number(runtimeItem?.area || sourceBooth.area || 0);
    const boothPricing = window.calculateBoothStandardFee(sourceBooth, area);
    return {
        id: String(sourceBooth.id || ''),
        hall: String(sourceBooth.hall || ''),
        type: String(sourceBooth.type || ''),
        area,
        price_unit: sourceBooth.type === '光地' ? '平米' : '个',
        unit_price: Number(boothPricing.priceUnit || 0),
        standard_fee: Number(boothPricing.standardFee || 0)
    };
}

window.selectSwapBoothByCode = function(boothCode) {
    const state = window.getOrderBoothMapPickerState();
    const normalizedBoothCode = window.normalizeBoothCode(boothCode);
    const runtimeItem = window.findItemByBoothCode(state.runtimeItems, normalizedBoothCode);
    const currentOrder = window.currentFinanceOrder;
    if (!runtimeItem || !currentOrder) return;
    if (window.isSameBoothCode(runtimeItem.booth_code, currentOrder.booth_id)) {
        return window.showToast('目标展位与当前展位相同，无需换展位', 'error');
    }
    if (String(runtimeItem.status_code || '') === 'locked') {
        return window.showToast(`展位 [${normalizedBoothCode}] 已锁定，当前不可选择`, 'error');
    }
    if (['reserved', 'deposit', 'full_paid'].includes(String(runtimeItem.status_code || ''))) {
        return window.showToast(`展位 [${normalizedBoothCode}] 当前已被其他订单占用，请重新选择`, 'error');
    }
    const area = Number(runtimeItem.area || 0);
    if (!Number.isFinite(area) || area <= 0) {
        return window.showToast('目标展位面积异常，无法换展位', 'error');
    }
    state.tempSelectedBooths = [window.buildSwapBoothCandidate(runtimeItem)];
    state.focusedBoothCode = normalizedBoothCode;
    window.renderOrderBoothMapSvg();
    window.showToast(`已选中目标展位：${normalizedBoothCode}`);
}

window.toggleOrderBoothMapSelectionByCode = function(boothCode) {
    const state = window.getOrderBoothMapPickerState();
    const normalizedBoothCode = window.normalizeBoothCode(boothCode);
    if (state.mode === 'swap') {
        return window.selectSwapBoothByCode(normalizedBoothCode);
    }
    const runtimeItem = window.findItemByBoothCode(state.runtimeItems, normalizedBoothCode);
    if (!runtimeItem) return;

    const existingIndex = (state.tempSelectedBooths || []).findIndex((item) => window.isSameBoothCode(item.id, normalizedBoothCode));
    if (existingIndex >= 0) {
        state.tempSelectedBooths.splice(existingIndex, 1);
        state.focusedBoothCode = normalizedBoothCode;
        window.renderOrderBoothMapSvg();
        return;
    }

    if (runtimeItem.status_code === 'locked') {
        return window.showToast(`展位 [${normalizedBoothCode}] 已锁定，当前不可选择`, 'error');
    }

    const totalArea = Number(runtimeItem.area || 0);
    let allocatedArea = totalArea;
    let isJoint = false;
    if (['reserved', 'deposit', 'full_paid'].includes(String(runtimeItem.status_code || ''))) {
        const areaInput = prompt(`【联合参展提醒】\n\n展位 [${boothCode}] 当前已有企业入驻。\n\n请输入分配给【新企业】的展位面积（㎡）：\n(原总面积 ${totalArea}㎡，提交后系统将自动从原企业订单中扣除该面积)`, String(totalArea || 9));
        if (areaInput === null) return;
        allocatedArea = parseFloat(areaInput);
        if (Number.isNaN(allocatedArea) || allocatedArea < 0 || allocatedArea >= totalArea) {
            return window.showToast('输入的面积无效或大于等于总面积，已取消录入', 'error');
        }
        isJoint = true;
    }

    state.tempSelectedBooths.push(window.buildOrderBoothSelection(runtimeItem, allocatedArea, isJoint));
    state.focusedBoothCode = boothCode;
    window.renderOrderBoothMapSvg();
    if (isJoint) {
        window.showToast(`已加入联合参展：${boothCode}，本单面积 ${allocatedArea}㎡`, 'info');
    } else {
        window.showToast(`已暂选展位：${boothCode}`);
    }
}

window.onOrderBoothMapPointerDown = function(event) {
    const state = window.getOrderBoothMapPickerState();
    const svg = document.getElementById('order-booth-map-svg');
    if (!svg || !state.currentMap) return;
    state.pointerMode = 'pan';
    state.pointerStartClient = { x: event.clientX, y: event.clientY };
    state.pointerStartViewBox = { ...state.viewBox };
    state.pointerDownBoothCode = window.normalizeBoothCode(event.target.closest('[data-booth-code]')?.getAttribute('data-booth-code') || '');
    state.dragMoved = false;
}

window.onOrderBoothMapPointerMove = function(event) {
    const state = window.getOrderBoothMapPickerState();
    const svg = document.getElementById('order-booth-map-svg');
    if (!svg || !state.currentMap || state.pointerMode !== 'pan' || !state.pointerStartClient || !state.pointerStartViewBox) return;
    const dx = (event.clientX - state.pointerStartClient.x) * (state.pointerStartViewBox.width / Math.max(svg.clientWidth, 1));
    const dy = (event.clientY - state.pointerStartClient.y) * (state.pointerStartViewBox.height / Math.max(svg.clientHeight, 1));
    state.viewBox.x = Number((state.pointerStartViewBox.x - dx).toFixed(2));
    state.viewBox.y = Number((state.pointerStartViewBox.y - dy).toFixed(2));
    state.dragMoved = state.dragMoved || Math.abs(dx) > 1.5 || Math.abs(dy) > 1.5;
    window.applyOrderBoothMapViewBox();
}

window.onOrderBoothMapPointerUp = function() {
    const state = window.getOrderBoothMapPickerState();
    const shouldToggle = !!state.pointerDownBoothCode && !state.dragMoved;
    const boothCode = state.pointerDownBoothCode;
    state.pointerMode = '';
    state.pointerStartClient = null;
    state.pointerStartViewBox = null;
    state.pointerDownBoothCode = '';
    state.dragMoved = false;
    if (shouldToggle) {
        window.toggleOrderBoothMapSelectionByCode(boothCode);
    }
}

window.onOrderBoothMapWheel = function(event) {
    const state = window.getOrderBoothMapPickerState();
    if (!state.currentMap) return;
    event.preventDefault();
    const pointer = window.getOrderBoothMapSvgPoint(event);
    const zoomFactor = event.deltaY < 0 ? 0.88 : 1.14;
    const nextWidth = Math.min(Math.max(state.viewBox.width * zoomFactor, 180), Number(state.currentMap.canvas_width || 1600) * 4);
    const nextHeight = Math.min(Math.max(state.viewBox.height * zoomFactor, 120), Number(state.currentMap.canvas_height || 900) * 4);
    state.viewBox.x = pointer.x - ((pointer.x - state.viewBox.x) * (nextWidth / state.viewBox.width));
    state.viewBox.y = pointer.y - ((pointer.y - state.viewBox.y) * (nextHeight / state.viewBox.height));
    state.viewBox.width = Number(nextWidth.toFixed(2));
    state.viewBox.height = Number(nextHeight.toFixed(2));
    window.applyOrderBoothMapViewBox();
}

window.confirmOrderBoothMapSelection = function() {
    const state = window.getOrderBoothMapPickerState();
    if (typeof state.onConfirm === 'function') {
        const selection = window.cloneOrderBoothSelectionList(state.tempSelectedBooths);
        const handled = state.onConfirm(selection);
        if (handled === false) return;
        window.closeOrderBoothMapPicker();
        return;
    }
    window.selectedOrderBooths = window.cloneOrderBoothSelectionList(state.tempSelectedBooths);
    window.currentAllocatedArea = window.selectedOrderBooths.reduce((sum, item) => sum + Number(item.area || 0), 0);
    window.renderSelectedBooths();
    window.closeOrderBoothMapPicker();
}

window.calculateBoothStandardFee = function(booth, allocatedArea) {
    const priceUnit = booth.base_price > 0 ? booth.base_price : (globalPrices[booth.type] || 0);
    const standardFee = booth.type === '光地'
        ? priceUnit * allocatedArea
        : priceUnit * (allocatedArea / 9);
    return {
        priceUnit,
        standardFee
    };
}

window.toggleNoBoothOrder = function(checked) {
    window.orderNoBooth = !!checked;
    const pickerWrap = document.getElementById('order-booth-picker-wrap');
    const noBoothHint = document.getElementById('order-no-booth-hint');
    const selectedBoothPanel = document.getElementById('selected-booth-panel');
    const actualFeeInput = document.getElementById('order-actual-fee');
    const actualFeeHelp = document.getElementById('order-actual-fee-help');
    if (window.orderNoBooth) {
        window.selectedOrderBooths = [];
        window.currentAllocatedArea = 0;
        currentStandardFee = 0;
        if (actualFeeInput) {
            actualFeeInput.value = 0;
            actualFeeInput.readOnly = true;
            actualFeeInput.classList.add('bg-slate-100', 'cursor-not-allowed');
        }
        if (actualFeeHelp) actualFeeHelp.innerText = '无展位订单不收展位费，如有其他应收请在下方“其他代收/杂费明细”中录入。';
    } else {
        if (actualFeeInput) {
            actualFeeInput.readOnly = false;
            actualFeeInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
            actualFeeInput.value = currentStandardFee || 0;
        }
        if (actualFeeHelp) actualFeeHelp.innerText = '如为免费展位，请直接填写 0 元；若低于系统标准价，系统会要求填写价格说明。';
    }
    pickerWrap?.classList.toggle('hidden', window.orderNoBooth);
    noBoothHint?.classList.toggle('hidden', !window.orderNoBooth);
    selectedBoothPanel?.classList.toggle('hidden', window.orderNoBooth);
    window.updateBoothDisplayNamePanel();
    window.renderSelectedBooths();
    window.calculateFinalTotal();
    window.refreshOrderOverview();
}

window.renderSelectedBooths = function() {
    const list = document.getElementById('selected-booth-list');
    const countBadge = document.getElementById('selected-booth-count');
    const selectedIdsInput = document.getElementById('selected-booth-id');
    if (!list || !countBadge || !selectedIdsInput) return;

    if (!Array.isArray(window.selectedOrderBooths)) window.selectedOrderBooths = [];
    selectedIdsInput.value = window.orderNoBooth ? '' : window.selectedOrderBooths.map((item) => item.id).join(',');
    countBadge.innerText = window.orderNoBooth ? '无展位订单' : `${window.selectedOrderBooths.length} 个`;
    window.updateBoothDisplayNamePanel();

    if (window.orderNoBooth) {
        list.innerHTML = '<span class="text-xs text-slate-500 font-bold">当前为无展位订单，可直接录入其他应收款生成订单</span>';
        document.getElementById('calc-booth').innerText = '无展位订单';
        document.getElementById('calc-type').innerText = '-';
        document.getElementById('calc-area').innerText = '0';
        document.getElementById('calc-unit').innerText = '-';
        currentStandardFee = 0;
        document.getElementById('calc-standard-fee').innerText = window.formatOrderMoney(0);
        const actualFeeInput = document.getElementById('order-actual-fee');
        if (actualFeeInput) actualFeeInput.value = 0;
        window.calculateFinalTotal();
        window.refreshOrderOverview();
        return;
    }

    if (window.selectedOrderBooths.length === 0) {
        list.innerHTML = '<span class="text-xs text-slate-400 italic">暂未选择展位</span>';
        document.getElementById('calc-booth').innerText = '-';
        document.getElementById('calc-type').innerText = '-';
        document.getElementById('calc-area').innerText = '-';
        document.getElementById('calc-unit').innerText = '-';
        currentStandardFee = 0;
        document.getElementById('calc-standard-fee').innerText = window.formatOrderMoney(0);
        window.calculateFinalTotal();
        window.refreshOrderOverview();
        return;
    }

    list.innerHTML = window.selectedOrderBooths.map((item) => `
        <div class="inline-flex items-center gap-2 rounded-full border border-blue-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 shadow-sm">
            <span>${window.escapeHtml(item.hall || '')} - ${window.escapeHtml(item.id || '')}</span>
            <span class="tabular-data text-slate-400">${Number(item.area || 0).toLocaleString()}㎡</span>
            <button type="button" onclick="window.removeSelectedBooth('${String(item.id).replace(/'/g, "\\'")}')" class="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" aria-label="移除展位">
                ${window.renderIcon('close', 'h-3.5 w-3.5', 2.2)}
            </button>
        </div>
    `).join('');

    const totalArea = window.selectedOrderBooths.reduce((sum, item) => sum + Number(item.area || 0), 0);
    const types = Array.from(new Set(window.selectedOrderBooths.map((item) => item.type).filter(Boolean)));
    currentStandardFee = window.selectedOrderBooths.reduce((sum, item) => sum + Number(item.standard_fee || 0), 0);

    document.getElementById('calc-booth').innerText = window.selectedOrderBooths.length === 1
        ? `${window.selectedOrderBooths[0].hall} - ${window.selectedOrderBooths[0].id}`
        : `${window.selectedOrderBooths.length} 个展位`;
    document.getElementById('calc-type').innerText = types.length === 1 ? types[0] : '混合';
    document.getElementById('calc-area').innerText = totalArea.toLocaleString();
    document.getElementById('calc-unit').innerText = window.selectedOrderBooths.length === 1
        ? `${window.selectedOrderBooths[0].unit_label}`
        : '按已选展位分别计价';
    document.getElementById('calc-standard-fee').innerText = window.formatOrderMoney(currentStandardFee);
    document.getElementById('order-actual-fee').value = currentStandardFee;
    window.calculateFinalTotal();
    window.refreshOrderOverview();
}

window.removeSelectedBooth = function(boothId) {
    window.selectedOrderBooths = (window.selectedOrderBooths || []).filter((item) => String(item.id) !== String(boothId));
    window.renderSelectedBooths();
}

window.initOrderForm = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const pRes = await window.apiFetch(`/api/prices?projectId=${pid}`); 
    const data = await pRes.json();
    globalPrices = { '标摊': data['标摊']||0, '豪标': data['豪标']||0, '光地': data['光地']||0 };
    
    const bRes = await window.apiFetch(`/api/booths?projectId=${pid}`); 
    allBooths = await bRes.json(); 
    
    await window.loadOrderFieldSettings?.();
    window.resetOrderForm();
    window.loadIndustries(); 
    window.refreshOrderOverview();
}

window.resetOrderForm = function() {
    const inputs = ['order-company', 'order-credit-code', 'order-category', 'order-business', 'order-contact', 'order-phone', 'order-agent-name', 'order-actual-fee', 'order-discount-reason', 'order-contract', 'reg-intl', 'reg-city-inp', 'selected-booth-id', 'order-profile', 'order-standard-display-name', 'order-ground-display-name'];
    inputs.forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
    
    document.getElementById('reg-prov').value = ''; 
    document.getElementById('reg-city-sel').value = ''; 
    document.getElementById('reg-dist').value = ''; 
    window.onProvinceChange(); 
    
    document.querySelectorAll('input[name="is_agent"]').forEach((radio) => { radio.checked = false; });
    window.toggleAgent();
    
    document.getElementById('order-no-code').checked = false; 
    window.toggleCreditCode();
    
    isJointExhibition = false; 
    window.currentAllocatedArea = 0;
    window.selectedOrderBooths = [];
    window.orderNoBooth = false;
    const noBoothCheckbox = document.getElementById('order-no-booth-order');
    if (noBoothCheckbox) noBoothCheckbox.checked = false;

    document.getElementById('calc-booth').innerText = '-'; 
    document.getElementById('calc-type').innerText = '-'; 
    document.getElementById('calc-area').innerText = '-'; 
    document.getElementById('calc-unit').innerText = '-'; 
    document.getElementById('calc-standard-fee').innerText = '¥ 0'; 
    document.getElementById('calc-final-total').innerText = '¥ 0'; 
    document.getElementById('dynamic-strategy-display').classList.add('hidden'); 
    currentStandardFee = 0; 
    document.getElementById('discount-reason-container').classList.add('hidden');
    
    dynamicFees = []; 
    window.renderDynamicFees();
    window.toggleNoBoothOrder(false);
    window.renderSelectedBooths();
    window.updateBoothDisplayNamePanel();
    window.closeOrderBoothMapPicker?.();
    window.applyOrderFieldSettings?.();
    window.refreshOrderOverview();
}

window.onProvinceChange = function() { 
    const prov = document.getElementById('reg-prov').value; 
    const intlInput = document.getElementById('reg-intl'); 
    const citySel = document.getElementById('reg-city-sel'); 
    const cityInp = document.getElementById('reg-city-inp'); 
    const distSel = document.getElementById('reg-dist'); 
    
    intlInput.classList.add('hidden'); 
    citySel.classList.add('hidden'); 
    cityInp.classList.add('hidden'); 
    distSel.classList.add('hidden'); 
    
    if (prov === '国际') { 
        intlInput.classList.remove('hidden'); 
    } else if (prov === '福建') { 
        citySel.classList.remove('hidden'); citySel.value = ''; window.onCityChange(); 
    } else if (prov !== '') { 
        cityInp.classList.remove('hidden'); 
    } 
}

window.onCityChange = function() { 
    const prov = document.getElementById('reg-prov').value; 
    const city = document.getElementById('reg-city-sel').value; 
    const distSel = document.getElementById('reg-dist'); 
    if (prov === '福建' && city === '福州') { 
        distSel.classList.remove('hidden'); distSel.value = ''; 
    } else { 
        distSel.classList.add('hidden'); 
    } 
}

window.searchAndSelectBooth = function() {
    const boothInput = document.getElementById('booth-search-inp');
    if (!boothInput) {
        return window.openOrderBoothMapPicker();
    }
    if (window.orderNoBooth) return window.showToast("当前已选择无展位订单，请先取消后再搜索展位", 'error');
    const inp = boothInput.value.trim().toUpperCase();
    if(!inp) return window.showToast("请先输入展位号！", 'error');
    
    const booth = allBooths.find(b => b.id.toUpperCase() === inp); 
    if(!booth) return window.showToast(`未找到展位：${inp}`, 'error');
    if ((window.selectedOrderBooths || []).some((item) => String(item.id) === String(booth.id))) {
        boothInput.value = '';
        return window.showToast(`展位 [${inp}] 已经在当前订单选择列表中`, 'info');
    }
    
    if(booth.status === '已锁定') { 
        boothInput.value = '';
        return window.showToast(`展位 [${inp}] 已被他人临时锁定，暂不可操作！`, 'error'); 
    }
    
    let allocatedArea = booth.area;

    // 【核心修复】：联合参展面积分配逻辑
    if (['已预定', '已付定金', '已付全款'].includes(String(booth.status || ''))) {
        const areaInput = prompt(`【联合参展提醒】\n\n展位 [${booth.id}] 已有企业入驻。\n\n请输入分配给【新企业】的展位面积（㎡）：\n(原总面积 ${booth.area}㎡，提交后系统将自动从原企业订单中扣除该面积)`, "9");
        
        if(areaInput === null) { 
            boothInput.value = '';
            return; 
        }
        
        allocatedArea = parseFloat(areaInput);
        if(isNaN(allocatedArea) || allocatedArea < 0 || allocatedArea >= booth.area) {
            window.showToast("输入的面积无效或大于等于总面积，已取消录入", "error");
            boothInput.value = '';
            return;
        }

        isJointExhibition = true;
        if (allocatedArea === 0) {
            window.showToast(`已加入联合参展：${booth.id}（本方 0㎡，展位费自动为 0）`, 'info');
        } else {
            window.showToast(`已开启联合参展，分配面积：${allocatedArea}㎡`, 'info');
        }
    } else { 
        isJointExhibition = false; 
    }
    
    window.currentAllocatedArea = allocatedArea;
    const boothPricing = window.calculateBoothStandardFee(booth, allocatedArea);
    window.selectedOrderBooths.push({
        id: booth.id,
        hall: booth.hall,
        type: booth.type,
        area: allocatedArea,
        unit_price: boothPricing.priceUnit,
        unit_label: booth.type === '光地' ? `¥${boothPricing.priceUnit} /平米` : `¥${boothPricing.priceUnit} /个(9㎡)`,
        standard_fee: boothPricing.standardFee,
        price_unit: booth.type === '光地' ? '平米' : '个',
        is_joint: isJointExhibition ? 1 : 0
    });
    window.renderSelectedBooths();
    boothInput.value = '';
    
    if(!isJointExhibition) window.showToast(`已加入展位：${booth.id}`);
}

window.getSavedDynamicFees = function() {
    return (dynamicFees || []).filter((fee) => Number(fee.saved || 0) === 1 && fee.name && parseFloat(fee.amount));
}

window.getPendingDynamicFees = function() {
    return (dynamicFees || []).filter((fee) => (fee.name || fee.amount) && Number(fee.saved || 0) !== 1);
}

window.addFeeRow = function() { dynamicFees.push({ name: '', amount: '', saved: 0 }); window.renderDynamicFees(); }
window.removeFeeRow = function(idx) { dynamicFees.splice(idx, 1); window.renderDynamicFees(); }
window.updateFeeData = function(idx, field, val) {
    dynamicFees[idx][field] = val;
    dynamicFees[idx].saved = 0;
    window.calculateFinalTotal();
}

window.saveFeeRow = function(idx) {
    const fee = dynamicFees[idx];
    if (!fee) return;
    const name = String(fee.name || '').trim();
    const amount = parseFloat(fee.amount);
    if (!name) return window.showToast('请先填写费用类目后再保存本项', 'error');
    if (isNaN(amount) || amount <= 0) return window.showToast('请填写大于 0 的金额后再保存本项', 'error');
    fee.name = name;
    fee.amount = Number(amount.toFixed(2));
    fee.saved = 1;
    window.renderDynamicFees();
    window.showToast(`已保存杂费：${name}`, 'success');
}

window.renderDynamicFees = function() {
    const container = document.getElementById('dynamic-fees-container'); 
    const noFeesText = document.getElementById('no-fees-text'); 
    const wrapper = document.getElementById('order-field-extra_fees-block');
    if (wrapper && wrapper.classList.contains('hidden')) {
        container.innerHTML = '';
        noFeesText.classList.add('hidden');
        window.calculateFinalTotal();
        return;
    }
    container.innerHTML = '';
    
    if (dynamicFees.length === 0) { 
        noFeesText.classList.remove('hidden'); 
    } else { 
        noFeesText.classList.add('hidden'); 
        container.innerHTML = dynamicFees.map((fee, idx) => {
            const safeName = String(fee.name || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
            const safeAmount = String(fee.amount ?? '').replace(/"/g, '&quot;');
            const saved = Number(fee.saved || 0) === 1;
            return `<div class="order-fee-row">
                <div class="order-fee-field">
                    <div class="flex items-center justify-between gap-2">
                        <div class="text-[11px] font-bold tracking-wide ${saved ? 'text-emerald-600' : 'text-amber-600'}">${saved ? '已保存明细' : '待保存明细'}</div>
                        <div class="text-[11px] text-slate-400">${saved ? '修改后需重新保存' : '保存后才会进入右侧摘要与最终提交'}</div>
                    </div>
                    <label>费用项目</label>
                    <input type="text" placeholder="如：搭建费 / 广告费 / 汇率差" value="${safeName}" oninput="window.updateFeeData(${idx}, 'name', this.value)" class="border px-3 py-2.5 rounded-xl w-full text-sm bg-white">
                </div>
                <div class="order-fee-field">
                    <label>金额（元）</label>
                    <div class="flex items-center gap-2">
                        <span class="text-slate-500 font-bold">¥</span>
                        <input type="number" placeholder="金额" value="${safeAmount}" oninput="window.updateFeeData(${idx}, 'amount', this.value)" class="border px-3 py-2.5 rounded-xl w-full text-sm bg-white font-bold text-slate-700">
                    </div>
                </div>
                <div class="order-fee-actions">
                    <button onclick="window.saveFeeRow(${idx})" class="${saved ? 'btn-secondary' : 'btn-soft-primary'} px-3 py-2 text-xs whitespace-nowrap">${saved ? '已保存' : '保存本项'}</button>
                    <button onclick="window.removeFeeRow(${idx})" class="btn-soft-danger px-3 py-2 text-xs whitespace-nowrap">删除</button>
                </div>
            </div>`;
        }).join('');
    }
    window.calculateFinalTotal();
    window.refreshOrderOverview();
}

window.toggleAgent = function() { 
    if (!window.isOrderFieldEnabled('is_agent')) {
        document.getElementById('order-agent-name')?.classList.add('hidden');
        document.getElementById('order-channel-direct-card')?.setAttribute('data-checked', 'false');
        document.getElementById('order-channel-agent-card')?.setAttribute('data-checked', 'false');
        window.refreshOrderOverview();
        return;
    }
    const checkedAgent = document.querySelector('input[name="is_agent"]:checked');
    const isAgent = checkedAgent && checkedAgent.value === '1';
    const box = document.getElementById('order-agent-name'); 
    const showAgentName = isAgent && window.isOrderFieldEnabled('agent_name');
    if(showAgentName) { box.classList.remove('hidden'); } else { box.classList.add('hidden'); } 
    document.getElementById('order-channel-direct-card')?.setAttribute('data-checked', checkedAgent?.value === '0' ? 'true' : 'false');
    document.getElementById('order-channel-agent-card')?.setAttribute('data-checked', checkedAgent?.value === '1' ? 'true' : 'false');
    window.refreshOrderOverview();
}

window.toggleCreditCode = function() { 
    const input = document.getElementById('order-credit-code'); 
    if(document.getElementById('order-no-code').checked) { 
        input.placeholder = "无代码请输入护照号等"; 
        input.classList.replace('bg-yellow-50', 'bg-gray-100'); 
    } else { 
        input.placeholder = "防止重复，请准确填写"; 
        input.classList.replace('bg-gray-100', 'bg-yellow-50'); 
    } 
}

window.autoFillBoothData = function(booth) {
    document.getElementById('calc-type').innerText = booth.type; 
    document.getElementById('calc-area').innerText = window.currentAllocatedArea; // 使用分配面积展示
    const priceUnit = booth.base_price > 0 ? booth.base_price : (globalPrices[booth.type] || 0);
    
    // 原价计算根据分配的面积走
    if(booth.type === '光地') { 
        document.getElementById('calc-unit').innerText = `¥${priceUnit} /平米`; 
        currentStandardFee = priceUnit * window.currentAllocatedArea; 
    } else { 
        document.getElementById('calc-unit').innerText = `¥${priceUnit} /个(9㎡)`; 
        currentStandardFee = priceUnit * (window.currentAllocatedArea / 9); 
    }
    document.getElementById('calc-standard-fee').innerText = window.formatOrderMoney(currentStandardFee); 
    document.getElementById('order-actual-fee').value = currentStandardFee; 
    window.calculateFinalTotal();
}

window.calculateFinalTotal = function() {
    const actualFeeInput = document.getElementById('order-actual-fee');
    const selectedBooths = Array.isArray(window.selectedOrderBooths) ? window.selectedOrderBooths : [];
    const totalSelectedArea = selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0);
    const shouldForceZeroBoothFee = window.orderNoBooth || (selectedBooths.length > 0 && totalSelectedArea <= 0);
    if (actualFeeInput && shouldForceZeroBoothFee) {
        actualFeeInput.value = 0;
        actualFeeInput.readOnly = true;
        actualFeeInput.classList.add('bg-slate-100', 'cursor-not-allowed');
    } else if (actualFeeInput) {
        actualFeeInput.readOnly = false;
        actualFeeInput.classList.remove('bg-slate-100', 'cursor-not-allowed');
    }
    if (!window.isOrderFieldEnabled('actual_booth_fee') && actualFeeInput) {
        actualFeeInput.value = currentStandardFee || 0;
    }
    let actualBoothFee = parseFloat(actualFeeInput?.value);
    if (!Number.isNaN(actualBoothFee) && actualBoothFee < 0) {
        actualBoothFee = 0;
        if (actualFeeInput) actualFeeInput.value = 0;
    }
    const dynamicStrategyDiv = document.getElementById('dynamic-strategy-display'); 
    const singleSelectedBooth = selectedBooths.length === 1 ? selectedBooths[0] : null;
    
    if(!shouldForceZeroBoothFee && singleSelectedBooth && !isNaN(actualBoothFee)) {
        const booth = allBooths.find(b => b.id === singleSelectedBooth.id);
        if(booth && Number(singleSelectedBooth.area || 0) > 0) {
            // 按照分配的面积反推单价
            let actualUnit = booth.type === '光地' ? actualBoothFee / Number(singleSelectedBooth.area || 0) : actualBoothFee / (Number(singleSelectedBooth.area || 0) / 9);
            dynamicStrategyDiv.innerText = `(反推实际单价：¥ ${actualUnit.toFixed(2)} /${booth.type === '光地'?'㎡':'个'})`; 
            dynamicStrategyDiv.classList.remove('hidden'); 
        }
    } else { 
        dynamicStrategyDiv.classList.add('hidden'); 
    }
    
    let otherFeeTotal = 0; 
    window.getSavedDynamicFees().forEach(f => { otherFeeTotal += parseFloat(f.amount) || 0; });
    
    const reasonBox = document.getElementById('discount-reason-container');
    if(!shouldForceZeroBoothFee && actualBoothFee < currentStandardFee) { reasonBox.classList.remove('hidden'); } else { reasonBox.classList.add('hidden'); }
    
    const total = (actualBoothFee || 0) + otherFeeTotal; 
    document.getElementById('calc-formula-text').innerText = `应收合计 = 展位费 (${window.formatOrderMoney(actualBoothFee || 0)}) + 杂费 (${window.formatOrderMoney(otherFeeTotal)})`; 
    document.getElementById('calc-final-total').innerText = window.formatOrderMoney(total);
    const totalSummary = document.getElementById('order-summary-total');
    if (totalSummary) totalSummary.innerText = window.formatOrderMoney(total);
    window.refreshOrderOverview();
}

window.getOrderRegionSummary = function() {
    const prov = document.getElementById('reg-prov')?.value || '';
    if (!prov) return '未填写';
    if (prov === '国际') {
        const intl = document.getElementById('reg-intl')?.value.trim();
        return intl ? `国际 - ${intl}` : '国际';
    }
    if (prov === '福建') {
        const city = document.getElementById('reg-city-sel')?.value || '';
        const dist = document.getElementById('reg-dist')?.value || '';
        if (!city) return prov;
        return city === '福州' && dist ? `${prov} / ${city} / ${dist}` : `${prov} / ${city}`;
    }
    const cityInp = document.getElementById('reg-city-inp')?.value.trim();
    return cityInp ? `${prov} / ${cityInp}` : prov;
}

window.refreshOrderOverview = function() {
    const company = document.getElementById('order-company')?.value.trim();
    const contact = document.getElementById('order-contact')?.value.trim();
    const phone = document.getElementById('order-phone')?.value.trim();
    const checkedAgent = document.querySelector('input[name="is_agent"]:checked');
    const agentName = document.getElementById('order-agent-name')?.value.trim();
    const selectedBooths = Array.isArray(window.selectedOrderBooths) ? window.selectedOrderBooths : [];
    const category = document.getElementById('order-category')?.value || '';
    const savedFees = window.getSavedDynamicFees();
    const pendingFees = window.getPendingDynamicFees();

    const companyEl = document.getElementById('order-summary-company');
    const contactEl = document.getElementById('order-summary-contact');
    const channelEl = document.getElementById('order-summary-channel');
    const regionEl = document.getElementById('order-summary-region');
    const categoryEl = document.getElementById('order-summary-category');
    const boothsEl = document.getElementById('order-summary-booths');
    const feeWrapEl = document.getElementById('order-summary-fees-wrap');
    const feeListEl = document.getElementById('order-summary-fees');
    const feeHintEl = document.getElementById('order-summary-fee-hint');

    if (companyEl) companyEl.innerText = company || '未填写';
    if (contactEl) contactEl.innerText = (contact || phone) ? [contact, phone].filter(Boolean).join(' / ') : '未填写';
    if (channelEl) {
        if (!checkedAgent) {
            channelEl.innerText = '未选择';
        } else if (checkedAgent.value === '1') {
            channelEl.innerText = agentName ? `代理商招展 · ${agentName}` : '代理商招展';
        } else {
            channelEl.innerText = '直招';
        }
    }
    if (regionEl) regionEl.innerText = window.getOrderRegionSummary();
    if (categoryEl) categoryEl.innerText = category || '未选择';
    if (boothsEl) boothsEl.innerText = window.orderNoBooth
        ? '无展位订单'
        : selectedBooths.length
        ? selectedBooths.map((booth) => `${booth.hall}-${booth.id}`).join(' / ')
        : '未选择';
    if (feeWrapEl && feeListEl && feeHintEl) {
        const actualBoothFee = parseFloat(document.getElementById('order-actual-fee')?.value || currentStandardFee || 0) || 0;
        const hasFeeInfo = savedFees.length > 0 || pendingFees.length > 0 || actualBoothFee > 0 || window.orderNoBooth;
        feeWrapEl.classList.toggle('hidden', !hasFeeInfo);
        const feeItems = [
            {
                name: '应收展位费',
                amount: actualBoothFee,
                meta: window.orderNoBooth
                    ? '无展位订单（展位费固定为 0）'
                    : selectedBooths.length
                        ? `展位 ${selectedBooths.map((booth) => `${booth.hall}-${booth.id}`).join(' / ')}`
                        : '按当前成交展位费计算'
            },
            ...savedFees.map((fee) => ({
                name: fee.name,
                amount: fee.amount,
                meta: '应收其他费用'
            }))
        ];
        feeListEl.innerHTML = feeItems.map((fee) => `
            <div class="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2">
                <div class="min-w-0">
                    <div class="text-xs font-bold text-slate-700 break-words">${window.escapeHtml(fee.name || '')}</div>
                    <div class="text-[11px] text-slate-500 mt-0.5">${window.escapeHtml(fee.meta || '')}</div>
                </div>
                <div class="text-sm font-black text-slate-900 tabular-data whitespace-nowrap">${window.formatOrderMoney(fee.amount)}</div>
            </div>
        `).join('');
        if (!feeItems.length) {
            feeListEl.innerHTML = '';
        }
        feeHintEl.innerText = pendingFees.length
            ? `还有 ${pendingFees.length} 项费用待保存，未计入当前总应收`
            : (window.orderNoBooth ? '无展位订单必须至少录入一项其他应收费用' : '总应收由展位费和其他应收明细共同构成');
    }
}

window.submitOrderForm = async function() {
    const pid = document.getElementById('global-project-select').value; if(!pid) return;
    const company = document.getElementById('order-company').value.trim(); 
    const code = document.getElementById('order-credit-code').value.trim();
    const contact = document.getElementById('order-contact').value.trim(); 
    const phone = document.getElementById('order-phone').value.trim();
    const selectedBooths = Array.isArray(window.selectedOrderBooths) ? window.selectedOrderBooths : [];
    const noBoothOrder = !!document.getElementById('order-no-booth-order')?.checked;
    const standardDisplayName = document.getElementById('order-standard-display-name')?.value.trim() || '';
    const groundDisplayName = document.getElementById('order-ground-display-name')?.value.trim() || '';
    const hasStandardBooth = selectedBooths.some((item) => ['标摊', '豪标'].includes(String(item.type || '').trim()));
    
    const selectedAgentRadio = document.querySelector('input[name="is_agent"]:checked');
    const isAgent = window.isOrderFieldEnabled('is_agent') ? (selectedAgentRadio?.value === '1') : false;
    const agentName = document.getElementById('order-agent-name').value.trim();
    if (window.isOrderFieldEnabled('is_agent') && window.isOrderFieldRequired('is_agent') && !selectedAgentRadio) return window.showToast("请先选择本单招展渠道分类！", 'error');
    if(isAgent && window.isOrderFieldEnabled('agent_name') && window.isOrderFieldRequired('agent_name') && !agentName) return window.showToast("请填写代理商公司名称！", 'error');

    let finalRegion = ''; const prov = document.getElementById('reg-prov').value;
    if(window.isOrderFieldEnabled('region') && window.isOrderFieldRequired('region') && !prov) return window.showToast("请选择所在地区！", 'error');
    if(prov === '国际') { 
        const intl = document.getElementById('reg-intl').value.trim(); 
        if(window.isOrderFieldRequired('region') && !intl) return window.showToast("【国际】地区必须输入具体的国家/地区名称！", 'error'); 
        finalRegion = `国际 - ${intl}`; 
    } 
    else if (prov === '福建') { 
        const city = document.getElementById('reg-city-sel').value; 
        if(window.isOrderFieldRequired('region') && !city) return window.showToast("请选择福建城市！", 'error'); 
        finalRegion = `${prov}省 - ${city}市`; 
        if(city === '福州') { 
            const dist = document.getElementById('reg-dist').value; 
            if(window.isOrderFieldRequired('region') && !dist) return window.showToast("请选择区县！", 'error'); 
            finalRegion += ` - ${dist}`; 
        } 
    } else { 
        const cityInp = document.getElementById('reg-city-inp').value.trim(); 
        finalRegion = `${prov} - ${cityInp || '未知市'}`; 
    }

    if(window.isOrderFieldEnabled('company_name') && window.isOrderFieldRequired('company_name') && !company) return window.showToast("请填写企业名称", 'error'); 
    if(window.isOrderFieldEnabled('credit_code') && window.isOrderFieldRequired('credit_code') && !code) return window.showToast("请填写信用代码", 'error'); 
    if(window.isOrderFieldEnabled('contact_person') && window.isOrderFieldRequired('contact_person') && !contact) return window.showToast("请填写联系人", 'error'); 
    if(window.isOrderFieldEnabled('phone') && window.isOrderFieldRequired('phone') && !phone) return window.showToast("请填写联系电话", 'error'); 
    if(!noBoothOrder && window.isOrderFieldRequired('booth_selection') && selectedBooths.length === 0) return window.showToast("请至少选择一个展位", 'error'); 
    if (!noBoothOrder && hasStandardBooth && !standardDisplayName) return window.showToast("标准展位/豪标必须填写展位图简称", 'error');
    if (window.countDisplayNameUnits(standardDisplayName) > 8) return window.showToast("标准展位简称最多 4 个汉字或 8 个英文字符", 'error');
    if (window.countDisplayNameUnits(groundDisplayName) > 24) return window.showToast("光地显示名称不能超过 12 个汉字或 24 个英文字符", 'error');
    
    const actualBoothFee = window.isOrderFieldEnabled('actual_booth_fee')
        ? parseFloat(document.getElementById('order-actual-fee').value)
        : Number(currentStandardFee || 0);
    if(isNaN(actualBoothFee)) return window.showToast("金额填写错误", 'error');
    if(actualBoothFee < 0) return window.showToast("最终成交展位费不能为负数", 'error');
    
    const reason = document.getElementById('order-discount-reason').value.trim(); 
    if(actualBoothFee < currentStandardFee && !reason) return window.showToast("低于系统原价，请填写优惠理由！", 'error');

    let otherFeeTotal = 0; let validFees = [];
    if (window.isOrderFieldEnabled('extra_fees')) {
        const pendingFees = window.getPendingDynamicFees();
        if (pendingFees.length > 0) return window.showToast("请先保存或删除待保存的杂费项，再提交订单", 'error');
        window.getSavedDynamicFees().forEach(f => { if(f.name && parseFloat(f.amount)) { otherFeeTotal += parseFloat(f.amount); validFees.push({ name: f.name, amount: Number(parseFloat(f.amount).toFixed(2)) }); } });
    }
    if (noBoothOrder) {
        if (selectedBooths.length > 0) return window.showToast("无展位订单不能同时选择展位，请先移除已选展位", 'error');
        if ((actualBoothFee || 0) !== 0) return window.showToast("无展位订单的应收展位费必须为 0", 'error');
        if (validFees.length === 0 || otherFeeTotal <= 0) return window.showToast("无展位订单必须至少录入一项其他应收费用", 'error');
    } else if (selectedBooths.length > 0) {
        const totalSelectedArea = selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0);
        if (totalSelectedArea <= 0 && (actualBoothFee || 0) !== 0) return window.showToast("0面积联合参展的应收展位费只能为 0", 'error');
    }
    const feesJsonStr = JSON.stringify(validFees); 
    
    const category = document.getElementById('order-category').value.trim();
    const business = document.getElementById('order-business').value.trim();
    const profile = document.getElementById('order-profile').value.trim(); 
    if (window.isOrderFieldEnabled('category') && window.isOrderFieldRequired('category') && !category) return window.showToast("请选择产品分类", 'error');
    if (window.isOrderFieldEnabled('main_business') && window.isOrderFieldRequired('main_business') && !business) return window.showToast("请填写主营业务/详细展品", 'error');
    if (window.isOrderFieldEnabled('profile') && window.isOrderFieldRequired('profile') && !profile) return window.showToast("请填写企业简介", 'error');

    window.toggleBtnLoading('submit-btn', true, '确认无误，生成订单并锁定展位');

    let uploadedFileKey = '';
    try {
        const fileInput = document.getElementById('order-contract');
        if (window.isOrderFieldEnabled('contract_upload') && fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const uploadData = await window.uploadContractFile(file);
            uploadedFileKey = uploadData.fileKey;
        }
        const orderData = {
            project_id: pid, company_name: company, credit_code: code, no_code_checked: document.getElementById('order-no-code').checked,
            category: category, main_business: business, is_agent: isAgent, agent_name: agentName,
            contact_person: contact, phone: phone, region: finalRegion, booth_id: noBoothOrder ? '' : selectedBooths.map((item) => item.id).join(', '), 
            area: noBoothOrder ? 0 : selectedBooths.reduce((sum, item) => sum + Number(item.area || 0), 0),
            price_unit: noBoothOrder ? '无展位' : (selectedBooths.length === 1 ? selectedBooths[0].price_unit : '组合'),
            unit_price: noBoothOrder ? 0 : (selectedBooths.length === 1 ? selectedBooths[0].unit_price : 0),
            total_booth_fee: noBoothOrder ? 0 : actualBoothFee, discount_reason: reason, other_income: otherFeeTotal, fees_json: feesJsonStr, profile: profile, total_amount: (noBoothOrder ? 0 : actualBoothFee) + otherFeeTotal, contract_url: uploadedFileKey, standard_booth_display_name: standardDisplayName, ground_booth_display_name: groundDisplayName, sales_name: currentUser.name, no_booth_order: noBoothOrder ? 1 : 0
        };
        orderData.selected_booths = noBoothOrder ? [] : selectedBooths.map((item) => ({
            booth_id: item.id,
            hall: item.hall,
            type: item.type,
            area: item.area,
            price_unit: item.price_unit,
            unit_price: item.unit_price,
            standard_fee: item.standard_fee,
            is_joint: item.is_joint
        }));
        const result = await window.readApiJson(
            await window.apiFetch('/api/submit-order', { method: 'POST', body: JSON.stringify(orderData) }),
            '订单录入失败',
            {}
        );
        const createdCount = Number(result.created_count || selectedBooths.length || 1);
        window.showToast(`🎉 订单录入成功，已生成 ${createdCount} 笔订单并锁定对应展位！`); 
        window.initOrderForm(); 
    } catch (error) { 
        window.showToast(error.message || '订单录入失败', 'error'); 
    } finally { 
        window.toggleBtnLoading('submit-btn', false);
    }
}
