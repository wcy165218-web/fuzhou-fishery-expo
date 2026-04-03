// ================= js/booth.js =================
window.loadPrices = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    const res = await window.apiFetch(`/api/prices?projectId=${pid}`); const data = await res.json(); 
    globalPrices = { '标摊': data['标摊']||0, '豪标': data['豪标']||0, '光地': data['光地']||0 }; 
    document.getElementById('price-bt').value = globalPrices['标摊']; document.getElementById('price-hb').value = globalPrices['豪标']; document.getElementById('price-gd').value = globalPrices['光地']; 
}

window.savePrices = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    const prices = { '标摊': Number(document.getElementById('price-bt').value)||0, '豪标': Number(document.getElementById('price-hb').value)||0, '光地': Number(document.getElementById('price-gd').value)||0 }; 
    try {
        await window.withButtonLoading('btn-save-prices', async () => {
            await window.apiFetch('/api/prices', { method: 'POST', body: JSON.stringify({projectId: pid, prices}) }); 
            window.showToast("全局策略保存成功！"); 
            window.loadPrices(); window.loadBooths(); 
        }); 
    } catch (e) {
        window.showToast(e.message || '保存失败', 'error');
    }
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
    const pid = document.getElementById('global-project-select').value; const idVal = document.getElementById('s-id').value.trim(); const hallNum = document.getElementById('s-hall-num').value.trim(); 
    if(!idVal || !hallNum) return window.showToast("请输入完整展位号和展馆", 'error'); 
    const type = document.getElementById('s-type').value; const area = parseFloat(document.getElementById('s-area').value); 
    if(isNaN(area) || area <= 0) return window.showToast("请输入正确面积", 'error'); 
    await window.withButtonLoading('btn-add-booth', async () => {
        const res = await window.apiFetch('/api/add-booth', { method: 'POST', body: JSON.stringify({ project_id: pid, id: idVal, hall: `${hallNum}号馆`, type: type, area: area, price_unit: type==='光地'?'平米':'个', base_price: 0 }) }); 
        if (res.ok) { document.getElementById('s-id').value = ''; document.getElementById('s-area').value = ''; window.showToast("展位添加成功"); window.loadBooths(); }
        else { const err = await res.json(); window.showToast(err.error, 'error'); }
    });
}

window.downloadTemplate = function() { 
    const blob = new Blob(["\uFEFF展位号,展馆数字(如1),类型(标摊/光地/豪标),面积(㎡)\nA01,1,标摊,18\nA02,1,光地,36\n"], { type: "text/csv;charset=utf-8;" }); 
    const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "展位导入模板.csv"; link.click(); 
}

window.parseAndImportBooths = async function() { 
    const pid = document.getElementById('global-project-select').value; const text = document.getElementById('booth-import-text').value.trim(); 
    if(!text) return window.showToast('请输入数据', 'error'); 
    const rows = text.split('\n'); const booths = []; 
    for(let r of rows) { 
        if(!r.trim()) continue; 
        const cols = r.split(/[\s,]+/).filter(c => c.trim() !== ""); 
        if(cols.length >= 4 && cols[0] !== '展位号') booths.push({ id: cols[0], hall: cols[1].replace(/馆|号/g, '') + '号馆', type: cols[2], area: parseFloat(cols[3]) || 0, price_unit: cols[2]==='光地'?'平米':'个' }); 
    } 
    if(booths.length === 0) return window.showToast('未解析到有效数据', 'error'); 
    
    try {
        await window.withButtonLoading('btn-import-booth', async () => {
            await window.apiFetch('/api/import-booths', { method: 'POST', body: JSON.stringify({projectId: pid, booths}) }); 
            document.getElementById('booth-import-text').value = ''; window.loadBooths(); 
            window.showToast(`批量导入成功，共解析 ${booths.length} 条数据`);
        });
    } catch (e) {
        window.showToast("导入失败，请检查数据格式", 'error');
    }
}

window.loadBooths = async function() { 
    const pid = document.getElementById('global-project-select').value; if(!pid) return; 
    allBooths = await (await window.apiFetch(`/api/booths?projectId=${pid}`)).json(); 
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
    const isSoldOrBooked = (status) => status === '已预订' || status === '已成交';

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
                            <span>已成交/预订比例</span>
                            <span>${soldPercent}</span>
                        </div>
                        ${renderBar(soldPercentNumber, 'bg-gradient-to-r from-emerald-300 via-cyan-300 to-blue-300')}
                        <div class="text-xs text-slate-300 mt-2">已成交/预订 ${summary.soldArea}㎡，未售 ${summary.unsoldArea}㎡</div>
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
                        <div class="text-xs text-emerald-200 font-bold">已成交/预订</div>
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
        const unit = b.type === '光地' ? '㎡' : '个'; const bCount = Number((b.area / 9).toFixed(2)).toString(); const isLockedByOrder = b.status === '已预订' || b.status === '已成交';
        
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
        const actionHtml = isLockedByOrder ? `<span class="badge-readonly">订单锁定</span>` : `<button onclick='window.openEditBooth(${JSON.stringify(String(b.id))}, ${JSON.stringify(String(b.type))}, ${Number(b.area)}, ${Number(b.base_price || 0)})' class="btn-soft-primary px-3 py-1 text-xs mr-2">修改</button><button onclick='window.deleteSingleBooth(${JSON.stringify(String(b.id))})' class="btn-soft-danger px-3 py-1 text-xs">删除</button>`; 
        const checkHtml = isLockedByOrder ? `<input type="checkbox" disabled title="不可批量操作">` : `<input type="checkbox" class="booth-check" value="${window.escapeAttr(b.id)}">`; 
        return `<tr class="border-b"><td class="p-3">${checkHtml}</td><td class="p-3 font-bold">${window.escapeHtml(b.id)}</td><td class="p-3">${window.escapeHtml(b.hall)}</td><td class="p-3">${window.escapeHtml(b.type)}</td><td class="p-3">${b.area}㎡</td><td class="p-3">${bCount}个</td><td class="p-3">${pStr}</td><td class="p-3 text-center">${selectHtml}</td><td class="p-3 text-center">${actionHtml}</td></tr>`; 
    }, '<tr><td colspan="9" class="p-6 text-center text-gray-400">暂无符合条件的展位</td></tr>');
}

window.toggleAllChecks = function(source) { document.querySelectorAll('.booth-check:not(:disabled)').forEach(cb => cb.checked = source.checked); } 
window.getCheckedIds = function() { return Array.from(document.querySelectorAll('.booth-check:checked')).map(cb => cb.value); }
window.updateSingleBoothStatus = async function(bid, st) { const label = window.getBoothStatusLabel(st); if(!confirm(`确定将展位 [${bid}] 修改为【${label}】吗？`)) { window.loadBooths(); return; } const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/update-booth-status', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: [bid], status: st}) }); window.loadBooths(); window.showToast(`已更新为 ${label}`);}
window.batchUpdateStatus = async function() { const ids = window.getCheckedIds(); if(ids.length === 0) return window.showToast("请勾选要操作的展位", 'error'); const st = document.getElementById('batch-status-select').value; const label = window.getBoothStatusLabel(st); if(!confirm(`确定批量修改选中的 ${ids.length} 个展位状态为【${label}】吗？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/update-booth-status', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: ids, status: st}) }); window.showToast(`成功更新了 ${ids.length} 个展位状态！`); window.loadBooths(); }
window.deleteSingleBooth = async function(id) { if(!confirm(`🚨 危险操作：永久删除展位 [${id}]？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/delete-booths', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: [id]}) }); window.showToast("展位删除成功"); window.loadBooths(); }
window.batchDelete = async function() { const ids = window.getCheckedIds(); if(ids.length === 0) return window.showToast("请勾选展位", 'error'); if(!confirm(`🚨 危险操作：确定永久删除选中的 ${ids.length} 个展位吗？`)) return; const pid = document.getElementById('global-project-select').value; await window.apiFetch('/api/delete-booths', { method: 'POST', body: JSON.stringify({projectId: pid, boothIds: ids}) }); window.showToast(`成功删除了 ${ids.length} 个展位！`); window.loadBooths(); }

window.openEditBooth = function(id, type, area, bp) { document.getElementById('eb-id').innerText = id; document.getElementById('eb-type').value = type; document.getElementById('eb-area').value = area; document.getElementById('eb-custom-price').value = bp > 0 ? bp : ''; document.getElementById('edit-booth-modal').classList.remove('hidden'); }
window.submitEditBooth = async function() { 
    const pid = document.getElementById('global-project-select').value; 
    const id = document.getElementById('eb-id').innerText; 
    const type = document.getElementById('eb-type').value; 
    const area = parseFloat(document.getElementById('eb-area').value); 
    const cp = parseFloat(document.getElementById('eb-custom-price').value);
    const finalCustomPrice = isNaN(cp) ? 0 : cp;

    if (isNaN(area) || area <= 0) return window.showToast("面积必须大于0", 'error');

    await window.withButtonLoading('btn-save-booth', async () => {
        const res = await window.apiFetch('/api/edit-booth', { method: 'POST', body: JSON.stringify({project_id: pid, id: id, type: type, area: area, base_price: finalCustomPrice}) }); 
        if(res.ok) {
            window.closeModal('edit-booth-modal'); 
            window.showToast("展位信息修改成功"); 
            await window.loadBooths();
        } else {
            window.showToast("修改失败", 'error');
        }
    });
}
