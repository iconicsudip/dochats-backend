import CryptoJS from 'crypto-js'

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY as string;
if (!ENCRYPTION_KEY) {
    console.error('❌ FATAL: ENCRYPTION_KEY not found in environment variables.');
}

export function encryptMessage(content: string) {
    return CryptoJS.AES.encrypt(content, ENCRYPTION_KEY).toString()
}

export function decryptMessage(cipherText: string) {
    if (!cipherText || !cipherText.startsWith('U2FsdGVkX1')) {
        return cipherText;
    }

    try {
        const bytes = CryptoJS.AES.decrypt(cipherText, ENCRYPTION_KEY);
        if (bytes.sigBytes <= 0) return cipherText; // Decryption failed

        const decrypted = bytes.toString(CryptoJS.enc.Utf8);
        return decrypted || cipherText;
    } catch (error) {
        return cipherText;
    }
}
