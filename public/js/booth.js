// ================= js/booth.js =================
window.loadPrices = async function() { 
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;
    try {
        const data = await window.readApiJson(
            await window.apiFetch(`/api/prices?projectId=${pid}`),
            '加载价格策略失败',
            {}
        );
        globalPrices = { '标摊': data['标摊'] || 0, '豪标': data['豪标'] || 0, '光地': data['光地'] || 0 };
        document.getElementById('price-bt').value = globalPrices['标摊'];
        document.getElementById('price-hb').value = globalPrices['豪标'];
        document.getElementById('price-gd').value = globalPrices['光地'];
    } catch (e) {
        window.showToast(e.message || '加载价格策略失败', 'error');
    }
}

window.savePrices = async function() { 
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;
    const prices = { '标摊': Number(document.getElementById('price-bt').value)||0, '豪标': Number(document.getElementById('price-hb').value)||0, '光地': Number(document.getElementById('price-gd').value)||0 }; 
    try {
        await window.withButtonLoading('btn-save-prices', async () => {
            await window.ensureApiSuccess(
                await window.apiFetch('/api/prices', { method: 'POST', body: JSON.stringify({projectId: pid, prices}) }),
                '保存失败'
            );
            window.showToast("全局策略保存成功！"); 
            window.loadPrices(); window.loadBooths(); 
        }); 
    } catch (e) {
        window.showToast(e.message || '保存失败', 'error');
    }
}

window.ORDER_LINKED_BOOTH_STATUSES = ['已预定', '已付定金', '已付全款'];

window.isOrderLinkedBoothStatus = function(status) {
    return window.ORDER_LINKED_BOOTH_STATUSES.includes(String(status || '').trim());
}

window.deriveBoothHallLabel = function(boothId, fallback = '') {
    return window.deriveHallFromBoothCode(boothId, fallback);
}

window.toggleEntrySection = function() { 
    const sec = document.getElementById('entry-section'); const arr = document.getElementById('entry-arrow'); 
    if(sec.classList.contains('hidden')) {
        sec.classList.remove('hidden');
        arr?.classList.add('rotate-180');
    } 
    else {
        sec.classList.add('hidden');
        arr?.classList.remove('rotate-180');
    } 
}

window.addSingleBooth = async function() { 
    window.showToast('展位库仅接收展位图中已保存的展位，请到展位图管理中新增', 'info');
}

window.downloadTemplate = function() { 
    window.showToast('展位库不再支持 Excel 导入，请到展位图管理中维护', 'info');
}

window.parseAndImportBooths = async function() { 
    window.showToast('展位库不再支持 Excel 导入，请到展位图管理中维护', 'info');
}

window.loadBooths = async function() { 
    const pid = document.getElementById('global-project-select').value;
    if (!pid) return;
    try {
        allBooths = await window.readApiJson(
            await window.apiFetch(`/api/booths?projectId=${pid}`),
            '加载展位失败',
            []
        );
        allBooths = (Array.isArray(allBooths) ? allBooths : []).map((booth) => ({
            ...booth,
            hall: window.deriveBoothHallLabel(booth.id, booth.hall)
        }));
        const halls = [...new Set(allBooths.map(b => b.hall))].sort(); 
        const hallFilter = document.getElementById('filter-hall'); 
        hallFilter.innerHTML = '<option value="">所有展馆</option>'; 
        halls.forEach(h => {
            const option = document.createElement('option');
            option.value = h;
            option.textContent = h;
            hallFilter.appendChild(option);
        });
        window.renderBooths();
    } catch (e) {
        window.showToast(e.message || '加载展位失败', 'error');
    }
}

window.updateStatsTitle = function() {
    const titleEl = document.getElementById('stats-title');
    if (!titleEl) return;
    const hallTxt = document.getElementById('filter-hall')?.value;
    titleEl.innerHTML = `${hallTxt || '总体展位'}动态大盘 <span class="text-xs font-normal text-gray-400 bg-gray-100 px-2 py-0.5 rounded">随下方馆号筛选实时联动</span>`;
}

window.getBoothStatusLabel = function(status) {
    return status === '可售' ? '未售' : status;
}

window.renderStats = function(boothData) { 
    const panel = document.getElementById('stats-panel');
    window.updateStatsTitle();
    if(boothData.length === 0) { panel.innerHTML = '<div class="col-span-4 text-gray-500 text-center py-4">无符合条件的数据</div>'; return; }

    const summary = {
        totalRevenue: 0,
        totalArea: 0,
        groundArea: 0,
        standardArea: 0,
        unsoldArea: 0,
        soldArea: 0
    };
    const isSoldOrBooked = (status) => window.isOrderLinkedBoothStatus(status);

    boothData.forEach((booth) => {
        const area = Number(booth.area) || 0;
        const price = booth.base_price > 0 ? booth.base_price : (globalPrices[booth.type] || 0);
        const projectedRevenue = isSoldOrBooked(booth.status)
            ? Number(booth.total_booth_fee || 0)
            : (booth.type === '光地' ? price * area : price * (area / 9));
        const soldBooked = isSoldOrBooked(booth.status);

        summary.totalRevenue += projectedRevenue;
        summary.totalArea += area;
        if (soldBooked) summary.soldArea += area;
        else summary.unsoldArea += area;

        if (booth.type === '光地') {
            summary.groundArea += area;
        } else {
            summary.standardArea += area;
        }
    });

    const toPercent = (value, total) => total > 0 ? `${((value / total) * 100).toFixed(1)}%` : '0.0%';
    const toPercentNumber = (value, total) => total > 0 ? Number(((value / total) * 100).toFixed(1)) : 0;
    const toBoothCount = (area) => Number((area / 9).toFixed(2)).toString();
    const clampPercent = (value) => Math.max(0, Math.min(Number(value || 0), 100));
    const renderBar = (value, colorClass) => `
        <div class="mt-2 h-2.5 rounded-full bg-slate-200/80 overflow-hidden">
            <div class="h-full rounded-full ${colorClass}" style="width: ${clampPercent(value)}%"></div>
        </div>
    `;
    const soldPercent = toPercent(summary.soldArea, summary.totalArea);
    const soldPercentNumber = toPercentNumber(summary.soldArea, summary.totalArea);

    panel.innerHTML = `
        <div class="xl:col-span-4 bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-6 border border-slate-800 rounded-3xl shadow-lg text-white">
            <div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-6">
                <div class="min-w-[240px]">
                    <div class="text-xs tracking-[0.24em] text-cyan-200 font-bold">第一部分：总计概览</div>
                    <div class="text-4xl font-black text-white mt-3">¥${summary.totalRevenue.toLocaleString()}</div>
                    <div class="text-sm text-slate-300 mt-2">总计预期展位费收入</div>
                    <div class="mt-5 bg-white/10 rounded-2xl border border-white/10 p-4">
                        <div class="flex items-center justify-between text-sm font-bold text-emerald-200">
                            <span>已下单面积比例</span>
                            <span>${soldPercent}</span>
                        </div>
                        ${renderBar(soldPercentNumber, 'bg-gradient-to-r from-emerald-300 via-cyan-300 to-blue-300')}
                        <div class="text-xs text-slate-300 mt-2">已下单 ${summary.soldArea}㎡，未售 ${summary.unsoldArea}㎡</div>
                    </div>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4 flex-1">
                    <div class="bg-white/10 backdrop-blur-sm rounded-2xl border border-white/10 p-4">
                        <div class="text-xs text-slate-300 font-bold">规划面积</div>
                        <div class="text-2xl font-black text-white mt-2">${summary.totalArea}㎡</div>
                        <div class="text-xs text-slate-300 mt-1">折 ${toBoothCount(summary.totalArea)} 个标准展位</div>
                    </div>
                    <div class="bg-sky-400/10 backdrop-blur-sm rounded-2xl border border-sky-300/20 p-4">
                        <div class="text-xs text-sky-200 font-bold">光地面积</div>
                        <div class="text-2xl font-black text-sky-100 mt-2">${summary.groundArea}㎡</div>
                        <div class="text-xs text-sky-200 mt-1">折 ${toBoothCount(summary.groundArea)} 个标准展位</div>
                    </div>
                    <div class="bg-indigo-400/10 backdrop-blur-sm rounded-2xl border border-indigo-300/20 p-4">
                        <div class="text-xs text-indigo-200 font-bold">标摊面积</div>
                        <div class="text-2xl font-black text-indigo-100 mt-2">${summary.standardArea}㎡</div>
                        <div class="text-xs text-indigo-200 mt-1">折 ${toBoothCount(summary.standardArea)} 个标准展位</div>
                    </div>
                    <div class="bg-amber-400/10 backdrop-blur-sm rounded-2xl border border-amber-300/20 p-4">
                        <div class="text-xs text-amber-200 font-bold">未售面积</div>
                        <div class="text-2xl font-black text-amber-100 mt-2">${summary.unsoldArea}㎡</div>
                        <div class="text-xs text-amber-200 mt-1">折 ${toBoothCount(summary.unsoldArea)} 个标准展位</div>
                    </div>
                    <div class="bg-emerald-400/10 backdrop-blur-sm rounded-2xl border border-emerald-300/20 p-4">
                        <div class="text-xs text-emerald-200 font-bold">已下单面积</div>
                        <div class="text-2xl font-black text-emerald-100 mt-2">${summary.soldArea}㎡</div>
                        <div class="text-xs text-emerald-200 mt-1">折 ${toBoothCount(summary.soldArea)} 个标准展位</div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

window.renderBooths = function() { 
    const searchTxt = document.getElementById('filter-search').value.toLowerCase(); 
    const hallTxt = document.getElementById('filter-hall').value; 
    const typeTxt = document.getElementById('filter-type').value; 
    const statusTxt = document.getElementById('filter-status').value; 
    const filtered = allBooths.filter(b => { 
        if(searchTxt && !b.id.toLowerCase().includes(searchTxt)) return false; 
        if(hallTxt && b.hall !== hallTxt) return false; 
        if(typeTxt && b.type !== typeTxt) return false; 
        if(statusTxt && b.status !== statusTxt) return false; 
        return true; 
    }); 
    window.renderStats(filtered);
    const tbody = document.getElementById('booth-list-tbody');
    document.getElementById('check-all').checked = false;
    tbody.innerHTML = window.renderHtmlCollection(filtered, (b) => {
        const unit = b.type === '光地' ? '㎡' : '个'; const bCount = Number((b.area / 9).toFixed(2)).toString(); const isLockedByOrder = window.isOrderLinkedBoothStatus(b.status); const isMapManaged = Number(b.map_managed || 0) === 1;
        
        let pStr = '';
        if (isLockedByOrder && b.total_booth_fee != null) {
            let actualUnit = b.type === '光地' ? (b.total_booth_fee / b.area) : (b.total_booth_fee / (b.area / 9)); actualUnit = Number(actualUnit.toFixed(2));
            pStr = `<span class="badge-success">实际单价</span> <span class="tabular-data">¥${actualUnit}/${unit}</span>`;
        } else {
            const standardPrice = b.base_price > 0 ? b.base_price : (globalPrices[b.type] || 0); 
            pStr = `<span class="badge-neutral">原价</span> <span class="tabular-data">¥${standardPrice}/${unit}</span>`;
        }
        
        let selectHtml = '';
        if (isLockedByOrder) { 
            selectHtml = `<span class="badge-readonly" title="受订单关联控制，不可手动更改">${window.escapeHtml(b.status)}</span>`; 
        } else { 
            selectHtml = `<select onchange='window.updateSingleBoothStatus(${JSON.stringify(String(b.id))}, this.value)' class="border p-1 text-xs rounded w-20 bg-white">`; 
            ['可售', '已锁定'].forEach(opt => selectHtml += `<option value="${opt}" ${b.status===opt?'selected':''}>${window.getBoothStatusLabel(opt)}</option>`); 
            selectHtml += `</select>`; 
        }
        const actionHtml = isLockedByOrder
            ? (isMapManaged
                ? `<span class="badge-readonly" title="该展位由展位图维护，请到展位图管理中仅修改类型或位置">订单锁定</span>`
                : `<button onclick='window.openEditBooth(${JSON.stringify(String(b.id))}, ${JSON.stringify(String(b.type))}, ${Number(b.area)}, ${Number(b.base_price || 0)}, false, true)' class="btn-soft-primary px-3 py-1 text-xs">改类型</button>`)
            : isMapManaged
                ? `<div class="inline-flex items-center gap-2"><button onclick='window.openEditBooth(${JSON.stringify(String(b.id))}, ${JSON.stringify(String(b.type))}, ${Number(b.area)}, ${Number(b.base_price || 0)}, true)' class="btn-soft-primary px-3 py-1 text-xs">改单价</button><span class="badge-readonly" title="展位号、面积和类型请回到展位图管理中维护">展位图维护</span></div>`
                : `<button onclick='window.openEditBooth(${JSON.stringify(String(b.id))}, ${JSON.stringify(String(b.type))}, ${Number(b.area)}, ${Number(b.base_price || 0)}, false)' class="btn-soft-primary px-3 py-1 text-xs mr-2">修改</button><button onclick='window.deleteSingleBooth(${JSON.stringify(String(b.id))})' class="btn-soft-danger px-3 py-1 text-xs">删除</button>`;
        const checkHtml = (isLockedByOrder || isMapManaged)
            ? `<input type="checkbox" disabled title="${isMapManaged ? '该展位由展位图维护，请在展位图管理中修改' : '不可批量操作'}">`
            : `<input type="checkbox" class="booth-check" value="${window.escapeAttr(b.id)}">`;
        return `<tr class="border-b"><td class="p-3">${checkHtml}</td><td class="p-3 font-bold">${window.escapeHtml(b.id)}</td><td class="p-3">${window.escapeHtml(b.hall)}</td><td class="p-3">${window.escapeHtml(b.type)}</td><td class="p-3">${b.area}㎡</td><td class="p-3">${bCount}个</td><td class="p-3">${pStr}</td><td class="p-3 text-center">${selectHtml}</td><td class="p-3 text-center">${actionHtml}</td></tr>`; 
    }, '<tr><td colspan="9" class="p-6 text-center text-gray-400">暂无符合条件的展位</td></tr>');
}

window.toggleAllChecks = function(source) { document.querySelectorAll('.booth-check:not(:disabled)').forEach(cb => cb.checked = source.checked); } 
window.getCheckedIds = function() { return Array.from(document.querySelectorAll('.booth-check:checked')).map(cb => cb.value); }
window.updateSingleBoothStatus = async function(bid, st) {
    const label = window.getBoothStatusLabel(st);
    if (!confirm(`确定将展位 [${bid}] 修改为【${label}】吗？`)) {
        window.loadBooths();
        return;
    }
    const pid = document.getElementById('global-project-select').value;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/update-booth-status', {
                method: 'POST',
                body: JSON.stringify({ projectId: pid, boothIds: [bid], status: st })
            }),
            '更新展位状态失败'
        );
        window.loadBooths();
        window.showToast(`已更新为 ${label}`);
    } catch (e) {
        await window.loadBooths();
        window.showToast(e.message || '更新展位状态失败', 'error');
    }
}
window.batchUpdateStatus = async function() {
    const ids = window.getCheckedIds();
    if (ids.length === 0) return window.showToast("请勾选要操作的展位", 'error');
    const st = document.getElementById('batch-status-select').value;
    const label = window.getBoothStatusLabel(st);
    if (!confirm(`确定批量修改选中的 ${ids.length} 个展位状态为【${label}】吗？`)) return;
    const pid = document.getElementById('global-project-select').value;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/update-booth-status', {
                method: 'POST',
                body: JSON.stringify({ projectId: pid, boothIds: ids, status: st })
            }),
            '批量更新展位状态失败'
        );
        window.showToast(`成功更新了 ${ids.length} 个展位状态！`);
        window.loadBooths();
    } catch (e) {
        window.showToast(e.message || '批量更新展位状态失败', 'error');
    }
}
window.deleteSingleBooth = async function(id) {
    if (!confirm(`🚨 危险操作：永久删除展位 [${id}]？`)) return;
    const pid = document.getElementById('global-project-select').value;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/delete-booths', {
                method: 'POST',
                body: JSON.stringify({ projectId: pid, boothIds: [id] })
            }),
            '展位删除失败'
        );
        window.showToast("展位删除成功");
        window.loadBooths();
    } catch (e) {
        window.showToast(e.message || '展位删除失败', 'error');
    }
}
window.batchDelete = async function() {
    const ids = window.getCheckedIds();
    if (ids.length === 0) return window.showToast("请勾选展位", 'error');
    if (!confirm(`🚨 危险操作：确定永久删除选中的 ${ids.length} 个展位吗？`)) return;
    const pid = document.getElementById('global-project-select').value;
    try {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/delete-booths', {
                method: 'POST',
                body: JSON.stringify({ projectId: pid, boothIds: ids })
            }),
            '批量删除展位失败'
        );
        window.showToast(`成功删除了 ${ids.length} 个展位！`);
        window.loadBooths();
    } catch (e) {
        window.showToast(e.message || '批量删除展位失败', 'error');
    }
}

window.openEditBooth = function(id, type, area, bp, mapManaged = false, orderLocked = false) {
    document.getElementById('eb-id').innerText = id;
    document.getElementById('eb-type').value = type;
    document.getElementById('eb-area').value = area;
    document.getElementById('eb-custom-price').value = bp > 0 ? bp : '';
    document.getElementById('eb-map-managed').value = mapManaged ? '1' : '0';
    document.getElementById('eb-order-locked').value = orderLocked ? '1' : '0';
    const hintEl = document.getElementById('eb-mode-hint');
    const typeEl = document.getElementById('eb-type');
    const areaEl = document.getElementById('eb-area');
    const priceEl = document.getElementById('eb-custom-price');
    if (hintEl) {
        hintEl.innerText = orderLocked
            ? '该展位已有正常订单，仅允许修改展位类型，面积、规格和单价不可修改。'
            : '该展位由展位图维护，这里仅允许单独调整单价。';
        hintEl.classList.toggle('hidden', !mapManaged && !orderLocked);
    }
    if (typeEl) {
        typeEl.disabled = !!mapManaged;
        typeEl.classList.toggle('bg-gray-100', !!mapManaged);
        typeEl.classList.toggle('cursor-not-allowed', !!mapManaged);
    }
    if (areaEl) {
        areaEl.readOnly = !!mapManaged || !!orderLocked;
        areaEl.classList.toggle('bg-gray-100', !!mapManaged || !!orderLocked);
        areaEl.classList.toggle('cursor-not-allowed', !!mapManaged || !!orderLocked);
    }
    if (priceEl) {
        priceEl.readOnly = !!orderLocked;
        priceEl.classList.toggle('bg-gray-100', !!orderLocked);
        priceEl.classList.toggle('cursor-not-allowed', !!orderLocked);
    }
    document.getElementById('edit-booth-modal').classList.remove('hidden');
}
window.submitEditBooth = async function() { 
    const pid = document.getElementById('global-project-select').value; 
    const id = document.getElementById('eb-id').innerText; 
    const type = document.getElementById('eb-type').value; 
    const area = parseFloat(document.getElementById('eb-area').value); 
    const cp = parseFloat(document.getElementById('eb-custom-price').value);
    const finalCustomPrice = isNaN(cp) ? 0 : cp;
    const mapManaged = Number(document.getElementById('eb-map-managed')?.value || 0) === 1;
    const orderLocked = Number(document.getElementById('eb-order-locked')?.value || 0) === 1;

    if (!mapManaged && (isNaN(area) || area <= 0)) return window.showToast("面积必须大于0", 'error');

    await window.withButtonLoading('btn-save-booth', async () => {
        await window.ensureApiSuccess(
            await window.apiFetch('/api/edit-booth', {
                method: 'POST',
                body: JSON.stringify({project_id: pid, id: id, type: type, area: area, base_price: finalCustomPrice})
            }),
            '修改失败'
        );
        window.closeModal('edit-booth-modal'); 
        window.showToast(mapManaged ? "展位单价修改成功" : (orderLocked ? "展位类型修改成功" : "展位信息修改成功"));
        await window.loadBooths();
    });
}
