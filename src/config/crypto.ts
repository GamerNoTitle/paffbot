/**
 * 数据库里密钥类配置的加解密。
 *
 * 密钥材料优先级：SETTINGS_KEY > BOT_TOKEN。
 * 用 BOT_TOKEN 兜底是为了「零额外配置也能加密」：DB 单独泄露时拿不到明文；
 * 代价是轮换 BOT_TOKEN 后旧密文解不开，需要重新填一遍（解密失败按空值处理）。
 */
const SALT = "paffbot-settings-v1";
const INFO = "settings-aes-gcm";

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(text: string): Uint8Array {
  const raw = atob(text);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function deriveKey(material: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(material), "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new TextEncoder().encode(SALT), info: new TextEncoder().encode(INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptValue(plain: string, material: string): Promise<string> {
  const key = await deriveKey(material);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  const packed = new Uint8Array(iv.length + cipher.byteLength);
  packed.set(iv, 0);
  packed.set(new Uint8Array(cipher), iv.length);
  return toBase64(packed);
}

export async function decryptValue(payload: string, material: string): Promise<string | null> {
  try {
    const packed = fromBase64(payload);
    const iv = packed.slice(0, 12);
    const body = packed.slice(12);
    const key = await deriveKey(material);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, body);
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}
