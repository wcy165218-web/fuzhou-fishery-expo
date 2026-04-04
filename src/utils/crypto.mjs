const PASSWORD_HASH_VERSION = 'pbkdf2_sha256';
const PASSWORD_PBKDF2_ITERATIONS = 150000;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_HASH_BYTES = 32;
const ERP_SECRET_VERSION = 'erpenc_v1';
const ERP_SECRET_IV_BYTES = 12;
const JWT_TTL_SECONDS = 12 * 60 * 60;
const JWT_CLOCK_SKEW_SECONDS = 60;

const base64UrlEncode = (source) => {
    let encoded = btoa(String.fromCharCode(...new Uint8Array(source)));
    return encoded.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
};

const base64UrlDecode = (str) => {
    let encoded = str.replace(/-/g, '+').replace(/_/g, '/');
    while (encoded.length % 4) encoded += '=';
    return new Uint8Array(atob(encoded).split('').map((char) => char.charCodeAt(0)));
};

const strToUint8 = (str) => new TextEncoder().encode(str);
const bytesToHex = (bytes) => Array.from(bytes).map((byte) => byte.toString(16).padStart(2, '0')).join('');

const hexToUint8 = (hex) => {
    const normalized = String(hex || '').trim().toLowerCase();
    if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/.test(normalized)) return null;
    const result = new Uint8Array(normalized.length / 2);
    for (let index = 0; index < normalized.length; index += 2) {
        result[index / 2] = Number.parseInt(normalized.slice(index, index + 2), 16);
    }
    return result;
};

async function hashPasswordLegacy(password) {
    const msgBuffer = new TextEncoder().encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function derivePasswordHash(password, saltBytes, iterations = PASSWORD_PBKDF2_ITERATIONS) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        strToUint8(String(password || '')),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    const derivedBits = await crypto.subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: saltBytes,
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        PASSWORD_HASH_BYTES * 8
    );
    return new Uint8Array(derivedBits);
}

export function isModernPasswordHash(hashValue) {
    return String(hashValue || '').startsWith(`${PASSWORD_HASH_VERSION}$`);
}

export async function hashPassword(password) {
    const saltBytes = crypto.getRandomValues(new Uint8Array(PASSWORD_SALT_BYTES));
    const derivedBytes = await derivePasswordHash(password, saltBytes, PASSWORD_PBKDF2_ITERATIONS);
    return [
        PASSWORD_HASH_VERSION,
        String(PASSWORD_PBKDF2_ITERATIONS),
        bytesToHex(saltBytes),
        bytesToHex(derivedBytes)
    ].join('$');
}

export async function verifyPassword(password, storedHash) {
    const normalizedHash = String(storedHash || '').trim();
    if (!normalizedHash) return false;
    if (!isModernPasswordHash(normalizedHash)) {
        const legacyHash = await hashPasswordLegacy(password);
        return legacyHash === normalizedHash;
    }
    const [, iterationsRaw, saltHex, hashHex] = normalizedHash.split('$');
    const iterations = Number.parseInt(iterationsRaw, 10);
    const saltBytes = hexToUint8(saltHex);
    const expectedHashBytes = hexToUint8(hashHex);
    if (!Number.isFinite(iterations) || iterations <= 0 || !saltBytes || !expectedHashBytes) {
        return false;
    }
    const derivedBytes = await derivePasswordHash(password, saltBytes, iterations);
    if (derivedBytes.length !== expectedHashBytes.length) return false;
    let diff = 0;
    for (let index = 0; index < derivedBytes.length; index += 1) {
        diff |= derivedBytes[index] ^ expectedHashBytes[index];
    }
    return diff === 0;
}

export async function isDefaultPasswordHash(storedHash) {
    return verifyPassword('123456', storedHash);
}

export async function signJWT(payload, secretStr) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const encHeader = base64UrlEncode(strToUint8(JSON.stringify(header)));
    const encPayload = base64UrlEncode(strToUint8(JSON.stringify(payload)));
    const data = `${encHeader}.${encPayload}`;
    const key = await crypto.subtle.importKey('raw', strToUint8(secretStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, strToUint8(data));
    return `${data}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyJWT(token, secretStr) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token format');
    const data = `${parts[0]}.${parts[1]}`;
    const key = await crypto.subtle.importKey('raw', strToUint8(secretStr), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const isValid = await crypto.subtle.verify('HMAC', key, base64UrlDecode(parts[2]), strToUint8(data));
    if (!isValid) throw new Error('Invalid signature');
    const payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < nowSeconds) throw new Error('Token expired');
    if (payload.iat && Number(payload.iat) > nowSeconds + JWT_CLOCK_SKEW_SECONDS) throw new Error('Token issued in the future');
    return payload;
}

export function getJwtSecret(env) {
    const secret = String(env.JWT_SECRET || '').trim();
    if (!secret) throw new Error('JWT_SECRET_MISSING');
    return secret;
}

function getErpConfigSecret(env) {
    const secret = String(env.ERP_CONFIG_SECRET || env.JWT_SECRET || '').trim();
    if (!secret) throw new Error('ERP_CONFIG_SECRET_MISSING');
    return secret;
}

async function importAesKey(secretStr) {
    const keyMaterial = await crypto.subtle.digest('SHA-256', strToUint8(secretStr));
    return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSensitiveValue(value, env) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    const iv = crypto.getRandomValues(new Uint8Array(ERP_SECRET_IV_BYTES));
    const key = await importAesKey(getErpConfigSecret(env));
    const cipherBuffer = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, strToUint8(normalized));
    return `${ERP_SECRET_VERSION}$${bytesToHex(iv)}$${bytesToHex(new Uint8Array(cipherBuffer))}`;
}

export async function decryptSensitiveValue(value, env) {
    const normalized = String(value || '').trim();
    if (!normalized) return '';
    if (!normalized.startsWith(`${ERP_SECRET_VERSION}$`)) {
        return normalized;
    }
    const [, ivHex, cipherHex] = normalized.split('$');
    const iv = hexToUint8(ivHex);
    const cipherBytes = hexToUint8(cipherHex);
    if (!iv || !cipherBytes) throw new Error('ERP_CONFIG_DECRYPT_INVALID');
    const key = await importAesKey(getErpConfigSecret(env));
    const plainBuffer = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipherBytes);
    return new TextDecoder().decode(plainBuffer);
}

export function isEncryptedSensitiveValue(value) {
    return String(value || '').trim().startsWith(`${ERP_SECRET_VERSION}$`);
}

export function buildJwtPayloadForUser(user) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return {
        name: user.name,
        role: user.role,
        token_index: Number(user.token_index || 0),
        iat: nowSeconds,
        exp: nowSeconds + JWT_TTL_SECONDS
    };
}
