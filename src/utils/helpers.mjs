const BOOTH_UNIT_AREA = 9;
const ALLOWED_UPLOAD_EXTENSIONS = new Set(['pdf']);
const ALLOWED_UPLOAD_MIME_TYPES = new Set(['application/pdf', 'application/x-pdf', '']);
const MAX_UPLOAD_SIZE = 6 * 1024 * 1024;
const ALLOWED_BOOTH_MAP_IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png']);
const ALLOWED_BOOTH_MAP_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', '']);
const MAX_BOOTH_MAP_IMAGE_SIZE = 10 * 1024 * 1024;

export const STAFF_SORT_ORDER = `CASE WHEN name = 'admin' THEN 0 ELSE 1 END ASC, display_order ASC, name COLLATE NOCASE ASC`;

export const ORDER_FIELD_SETTINGS = [
    { key: 'is_agent', enabled: 1, required: 1 },
    { key: 'agent_name', enabled: 1, required: 1 },
    { key: 'company_name', enabled: 1, required: 1 },
    { key: 'credit_code', enabled: 1, required: 1 },
    { key: 'contact_person', enabled: 1, required: 1 },
    { key: 'phone', enabled: 1, required: 1 },
    { key: 'region', enabled: 1, required: 1 },
    { key: 'category', enabled: 1, required: 1 },
    { key: 'main_business', enabled: 1, required: 1 },
    { key: 'profile', enabled: 1, required: 1 },
    { key: 'booth_selection', enabled: 1, required: 1, immutable: true },
    { key: 'actual_booth_fee', enabled: 1, required: 1 },
    { key: 'extra_fees', enabled: 1, required: 0 },
    { key: 'contract_upload', enabled: 1, required: 0 }
];

export const hasMetaChanges = (result) => Number(result?.meta?.changes ?? result?.changes ?? 0);

export function formatChinaDateTime(date = new Date()) {
    const chinaDate = new Date(date.getTime() + (8 * 60 * 60 * 1000));
    const year = chinaDate.getUTCFullYear();
    const month = String(chinaDate.getUTCMonth() + 1).padStart(2, '0');
    const day = String(chinaDate.getUTCDate()).padStart(2, '0');
    const hour = String(chinaDate.getUTCHours()).padStart(2, '0');
    const minute = String(chinaDate.getUTCMinutes()).padStart(2, '0');
    const second = String(chinaDate.getUTCSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

export function parseChinaDateTime(value) {
    if (!value) return null;
    return Date.parse(String(value).replace(' ', 'T') + '+08:00');
}

export function getLoginAttemptContext(request, username) {
    const forwarded = request.headers.get('CF-Connecting-IP')
        || request.headers.get('X-Forwarded-For')
        || '';
    const ipAddress = String(forwarded).split(',')[0].trim() || 'unknown';
    const normalizedUser = String(username || '').trim().toLowerCase();
    return {
        username: normalizedUser,
        ipAddress,
        key: `${normalizedUser}::${ipAddress}`
    };
}

export function toSafeNumber(value) {
    return Number(value || 0);
}

export function validateNewPassword(newPass) {
    const password = String(newPass || '');
    if (password.trim().length < 6) {
        return '新密码长度至少 6 位';
    }
    if (password === '123456') {
        return '新密码不能使用默认密码 123456';
    }
    return '';
}

export function normalizeUploadExtension(fileName) {
    return String(fileName || '').split('.').pop()?.toLowerCase().trim() || '';
}

export function validateUploadFile(file) {
    if (!file || typeof file.name !== 'string') return '没有找到文件';
    const fileExt = normalizeUploadExtension(file.name);
    if (!ALLOWED_UPLOAD_EXTENSIONS.has(fileExt)) {
        return '仅允许上传 PDF 格式文件';
    }
    const fileType = String(file.type || '').trim().toLowerCase();
    if (!ALLOWED_UPLOAD_MIME_TYPES.has(fileType)) {
        return '文件类型无效，请上传 PDF 文件';
    }
    if (Number(file.size || 0) <= 0) {
        return '文件不能为空';
    }
    if (Number(file.size || 0) > MAX_UPLOAD_SIZE) {
        return '文件大小不能超过 6MB';
    }
    return '';
}

export function validateBoothMapImageFile(file) {
    if (!file || typeof file.name !== 'string') return '没有找到文件';
    const fileExt = normalizeUploadExtension(file.name);
    if (!ALLOWED_BOOTH_MAP_IMAGE_EXTENSIONS.has(fileExt)) {
        return '展位图底图仅支持 JPG / JPEG / PNG';
    }
    const fileType = String(file.type || '').trim().toLowerCase();
    if (!ALLOWED_BOOTH_MAP_IMAGE_MIME_TYPES.has(fileType)) {
        return '展位图底图仅支持 JPG / JPEG / PNG';
    }
    if (Number(file.size || 0) <= 0) {
        return '文件不能为空';
    }
    if (Number(file.size || 0) > MAX_BOOTH_MAP_IMAGE_SIZE) {
        return '底图大小不能超过 10MB';
    }
    return '';
}

export function toNonNegativeNumber(value) {
    const num = Number(value);
    return Number.isFinite(num) ? num : NaN;
}

export function toBoothCount(area) {
    return Number((toSafeNumber(area) / BOOTH_UNIT_AREA).toFixed(2));
}

export function normalizeBoothIds(rawBoothIds) {
    if (!Array.isArray(rawBoothIds) || rawBoothIds.length === 0) {
        throw new Error('请先选择要操作的展位');
    }
    if (rawBoothIds.length > 200) {
        throw new Error('单次最多处理 200 个展位');
    }
    return rawBoothIds
        .map((item) => String(item || '').trim())
        .filter(Boolean);
}

export function roundTo(value, digits = 2) {
    const normalized = Number(value || 0);
    if (!Number.isFinite(normalized)) return 0;
    const factor = 10 ** digits;
    return Math.round(normalized * factor) / factor;
}

export function clampNumber(value, min, max) {
    const normalized = Number(value);
    if (!Number.isFinite(normalized)) return min;
    return Math.min(Math.max(normalized, min), max);
}

export function countDisplayNameUnits(value) {
    return Array.from(String(value || '')).reduce((total, char) => {
        return total + (/[\u0000-\u00ff]/.test(char) ? 1 : 2);
    }, 0);
}

export function validateStandardBoothDisplayName(value) {
    const normalized = String(value || '').trim();
    if (!normalized) return '标准展位/豪标必须填写展位图简称';
    if (countDisplayNameUnits(normalized) > 8) {
        return '标准展位简称最多 4 个汉字或 8 个英文字符';
    }
    return '';
}

function formatProvinceLabel(rawProvince) {
    const province = String(rawProvince || '')
        .replace(/省$/, '')
        .replace(/市$/, '')
        .replace(/壮族自治区|回族自治区|维吾尔自治区|自治区/g, '')
        .replace(/特别行政区/g, '')
        .trim();
    if (!province) return '未注明地区';
    if (['北京', '上海', '天津', '重庆'].includes(province)) return `${province}市`;
    if (province === '内蒙古') return '内蒙古自治区';
    if (province === '广西') return '广西壮族自治区';
    if (province === '宁夏') return '宁夏回族自治区';
    if (province === '新疆') return '新疆维吾尔自治区';
    if (province === '西藏') return '西藏自治区';
    if (province === '香港') return '香港特别行政区';
    if (province === '澳门') return '澳门特别行政区';
    if (province === '台湾') return '台湾地区';
    return `${province}省`;
}

export function parseRegionInfo(regionText) {
    const parts = String(regionText || '')
        .split(' - ')
        .map((part) => part.trim())
        .filter(Boolean);
    const first = parts[0] || '未注明地区';

    if (first === '国际') {
        const country = parts[1] || '其他国际地区';
        return {
            scope: 'international',
            detailLabel: country,
            pieLabel: country
        };
    }

    if (['香港', '澳门', '台湾'].includes(first)) {
        const label = formatProvinceLabel(first);
        return {
            scope: 'international',
            detailLabel: label,
            pieLabel: label
        };
    }

    const normalizedProvince = first.replace(/省$/, '').replace(/市$/, '');
    if (normalizedProvince === '福建') {
        const cityRaw = (parts[1] || '福建省其他地区').replace(/市$/, '');
        const district = parts[2] || '';
        return {
            scope: 'inside_fujian',
            detailLabel: cityRaw === '福州' ? `福州市${district ? ` - ${district}` : ''}` : `${cityRaw}市`,
            pieLabel: '福建省'
        };
    }

    const label = formatProvinceLabel(first);
    return {
        scope: 'outside_fujian',
        detailLabel: label,
        pieLabel: label
    };
}

export function getChinaTimestamp() {
    return new Date(Date.now() + (8 * 60 * 60 * 1000)).toISOString().replace('T', ' ').slice(0, 19);
}

export function getOverpaidAmount(totalAmount, paidAmount) {
    return Number((Number(paidAmount || 0) - Number(totalAmount || 0)).toFixed(2));
}

export function parseOrderFeeItems(rawFeesJson) {
    try {
        const parsed = JSON.parse(rawFeesJson || '[]');
        if (!Array.isArray(parsed)) return [];
        return parsed
            .map((item) => ({
                ...item,
                name: String(item?.name || '').trim(),
                amount: Number(item?.amount || 0)
            }))
            .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
    } catch (error) {
        return [];
    }
}

export function normalizeEditableFeeItems(rawFees) {
    const parsed = Array.isArray(rawFees) ? rawFees : JSON.parse(rawFees || '[]');
    if (!Array.isArray(parsed)) throw new Error('INVALID_FEES_JSON');
    return parsed
        .map((item) => ({
            ...item,
            name: String(item?.name || '').trim(),
            amount: Number(item?.amount || 0)
        }))
        .filter((item) => item.name && Number.isFinite(item.amount) && item.amount > 0);
}

export function applyStateMetricsToBucket(bucket, boothCount, paidAmount, totalAmount, options = {}) {
    const normalizedBoothCount = Number(boothCount || 0);
    const normalizedPaidAmount = Number(paidAmount || 0);
    const normalizedTotalAmount = Number(totalAmount || 0);
    if (options.includeCompany && typeof bucket.company_count === 'number') bucket.company_count += 1;

    if (normalizedPaidAmount <= 0) {
        if (typeof bucket.reserved_booth_count === 'number') bucket.reserved_booth_count += normalizedBoothCount;
        return;
    }

    if (normalizedPaidAmount < normalizedTotalAmount) {
        if (typeof bucket.deposit_booth_count === 'number') bucket.deposit_booth_count += normalizedBoothCount;
    } else {
        if (typeof bucket.full_paid_booth_count === 'number') bucket.full_paid_booth_count += normalizedBoothCount;
    }

    if (typeof bucket.paid_booth_count === 'number') bucket.paid_booth_count += normalizedBoothCount;
    if (options.includePaidCompany && typeof bucket.paid_company_count === 'number') bucket.paid_company_count += 1;
}
