const ITERATIONS = 600000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(bytes) {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of array) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKey(passphrase, salt, iterations = ITERATIONS) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations,
      hash: "SHA-256"
    },
    material,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function importRawKey(rawKey) {
  return crypto.subtle.importKey(
    "raw",
    fromBase64(rawKey),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function createVault(passphrase, secrets) {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(secrets))
  );

  return {
    vault: {
      version: 1,
      kdf: "PBKDF2-SHA256",
      iterations: ITERATIONS,
      salt: toBase64(salt),
      iv: toBase64(iv),
      ciphertext: toBase64(ciphertext)
    },
    keyRaw: toBase64(await crypto.subtle.exportKey("raw", key))
  };
}

export async function unlockVault(vault, passphrase) {
  if (!vault?.salt || !vault?.iv || !vault?.ciphertext) {
    throw new Error("La caja cifrada está dañada");
  }

  const key = await deriveKey(
    passphrase,
    fromBase64(vault.salt),
    Number(vault.iterations) || ITERATIONS
  );

  let plaintext;
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(vault.iv) },
      key,
      fromBase64(vault.ciphertext)
    );
  } catch {
    throw new Error("Contraseña incorrecta o caja dañada");
  }

  return {
    secrets: JSON.parse(decoder.decode(plaintext)),
    keyRaw: toBase64(await crypto.subtle.exportKey("raw", key))
  };
}

export async function encryptWithKey(keyRaw, secrets) {
  const key = await importRawKey(keyRaw);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(JSON.stringify(secrets))
  );
  return {
    iv: toBase64(iv),
    ciphertext: toBase64(ciphertext)
  };
}

export async function decryptWithKey(keyRaw, vault) {
  const key = await importRawKey(keyRaw);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(vault.iv) },
    key,
    fromBase64(vault.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext));
}