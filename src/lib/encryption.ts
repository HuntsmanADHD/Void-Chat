/**
 * Core encryption utilities for Void Chat
 * Uses TweetNaCl for all cryptographic operations
 */

import nacl from 'tweetnacl';
import { encodeBase64, decodeBase64, encodeUTF8, decodeUTF8 } from 'tweetnacl-util';

export interface KeyPair {
  publicKey: string;
  secretKey: string;
}

export interface EncryptedMessage {
  encrypted: string;
  nonce: string;
}

export function generateKeyPair(): KeyPair | null {
  try {
    const keyPair = nacl.box.keyPair();
    return {
      publicKey: encodeBase64(keyPair.publicKey),
      secretKey: encodeBase64(keyPair.secretKey),
    };
  } catch (error) {
    console.error('[Encryption] Failed to generate keypair:', error);
    return null;
  }
}

export function encryptMessage(
  message: string,
  recipientPublicKey: string,
  senderSecretKey: string
): EncryptedMessage | null {
  try {
    if (!message || !recipientPublicKey || !senderSecretKey) return null;
    const recipientPubKeyBytes = decodeBase64(recipientPublicKey);
    const senderSecKeyBytes = decodeBase64(senderSecretKey);
    if (recipientPubKeyBytes.length !== nacl.box.publicKeyLength) return null;
    if (senderSecKeyBytes.length !== nacl.box.secretKeyLength) return null;
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const messageBytes = decodeUTF8(message);
    const encrypted = nacl.box(messageBytes, nonce, recipientPubKeyBytes, senderSecKeyBytes);
    if (!encrypted) return null;
    return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt message:', error);
    return null;
  }
}

export function decryptMessage(
  encryptedData: string,
  nonce: string,
  senderPublicKey: string,
  recipientSecretKey: string
): string | null {
  try {
    if (!encryptedData || !nonce || !senderPublicKey || !recipientSecretKey) return null;
    const encryptedBytes = decodeBase64(encryptedData);
    const nonceBytes = decodeBase64(nonce);
    const senderPubKeyBytes = decodeBase64(senderPublicKey);
    const recipientSecKeyBytes = decodeBase64(recipientSecretKey);
    const decrypted = nacl.box.open(encryptedBytes, nonceBytes, senderPubKeyBytes, recipientSecKeyBytes);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt message:', error);
    return null;
  }
}

export function generateChannelKey(): string | null {
  try {
    const key = nacl.randomBytes(nacl.secretbox.keyLength);
    return encodeBase64(key);
  } catch (error) {
    console.error('[Encryption] Failed to generate channel key:', error);
    return null;
  }
}

export function encryptChannelMessage(message: string, channelKey: string): EncryptedMessage | null {
  try {
    if (!message || !channelKey) return null;
    const keyBytes = decodeBase64(channelKey);
    if (keyBytes.length !== nacl.secretbox.keyLength) return null;
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const messageBytes = decodeUTF8(message);
    const encrypted = nacl.secretbox(messageBytes, nonce, keyBytes);
    if (!encrypted) return null;
    return { encrypted: encodeBase64(encrypted), nonce: encodeBase64(nonce) };
  } catch (error) {
    console.error('[Encryption] Failed to encrypt channel message:', error);
    return null;
  }
}

export function decryptChannelMessage(encryptedData: string, nonce: string, channelKey: string): string | null {
  try {
    if (!encryptedData || !nonce || !channelKey) return null;
    const encryptedBytes = decodeBase64(encryptedData);
    const nonceBytes = decodeBase64(nonce);
    const keyBytes = decodeBase64(channelKey);
    const decrypted = nacl.secretbox.open(encryptedBytes, nonceBytes, keyBytes);
    if (!decrypted) return null;
    return encodeUTF8(decrypted);
  } catch (error) {
    console.error('[Encryption] Failed to decrypt channel message:', error);
    return null;
  }
}

export function isValidPublicKey(publicKey: string): boolean {
  try {
    if (!publicKey) return false;
    const keyBytes = decodeBase64(publicKey);
    return keyBytes.length === nacl.box.publicKeyLength;
  } catch {
    return false;
  }
}

export function isValidSecretKey(secretKey: string): boolean {
  try {
    if (!secretKey) return false;
    const keyBytes = decodeBase64(secretKey);
    return keyBytes.length === nacl.box.secretKeyLength;
  } catch {
    return false;
  }
}
