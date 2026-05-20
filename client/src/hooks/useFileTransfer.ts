import { useState, useCallback, useRef } from 'react';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { getP2PManager } from '@/lib/p2p';
import { validateFile, encryptFileData, decryptFileData } from '@/lib/fileEncryption';
import type { FileTransferState, FileTransferOffer, FileChunk, P2PMessage } from '@/types/p2p';

const CHUNK_SIZE = 16 * 1024; // 16KB chunks for WebRTC data channel

/**
 * Type for the nacl.box encrypt wrapper provided by useEncryption.
 * Encrypts plaintext using the caller's secret key (held internally) and the recipient's public key.
 */
export type BoxEncryptFn = (plaintext: Uint8Array, nonce: Uint8Array, recipientPublicKey: Uint8Array) => Uint8Array | null;

/**
 * Type for the nacl.box.open wrapper provided by useEncryption.
 * Decrypts ciphertext using the caller's secret key (held internally) and the sender's public key.
 */
export type BoxOpenFn = (ciphertext: Uint8Array, nonce: Uint8Array, senderPublicKey: Uint8Array) => Uint8Array | null;

export function useFileTransfer(
  localPublicId: string,
  boxEncrypt: BoxEncryptFn | null,
  boxOpen: BoxOpenFn | null,
  getRecipientPublicKey: (peerId: string) => Promise<string | null>
) {
  const [transfers, setTransfers] = useState<Map<string, FileTransferState>>(new Map());
  const chunksBuffer = useRef<Map<string, Uint8Array[]>>(new Map());
  const fileMetadata = useRef<Map<string, FileTransferOffer>>(new Map());
  // Store encrypted file keys and their nonces for receiving transfers
  const encryptedFileKeys = useRef<Map<string, { encryptedKey: string; keyNonce: string; senderPublicId: string }>>(new Map());

  // Generate a random file encryption key
  const generateFileKey = useCallback(() => {
    return nacl.randomBytes(nacl.secretbox.keyLength);
  }, []);

  // Send a file to a peer
  const sendFile = useCallback(async (peerId: string, file: File): Promise<string | null> => {
    const validation = validateFile(file);
    if (!validation.valid) {
      console.error('[FileTransfer]', validation.error);
      return null;
    }

    if (!boxEncrypt) {
      console.error('[FileTransfer] Encryption not available');
      return null;
    }

    const p2p = getP2PManager(localPublicId);
    if (!p2p.isConnected(peerId)) {
      console.error('[FileTransfer] Not connected to peer');
      return null;
    }

    // Get recipient's public key for encrypting the file key
    const recipientPublicKey = await getRecipientPublicKey(peerId);
    if (!recipientPublicKey) {
      console.error('[FileTransfer] Could not get recipient public key');
      return null;
    }

    const fileId = `file-${Date.now()}-${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const fileKey = generateFileKey();

    // Read and encrypt file
    const arrayBuffer = await file.arrayBuffer();
    const encrypted = encryptFileData(arrayBuffer, fileKey);
    if (!encrypted) {
      console.error('[FileTransfer] Encryption failed');
      return null;
    }

    // Encrypt the file key with recipient's public key using the boxEncrypt wrapper
    const keyNonce = nacl.randomBytes(nacl.box.nonceLength);
    const recipientPubKeyBytes = naclUtil.decodeBase64(recipientPublicKey);
    const encryptedFileKey = boxEncrypt(fileKey, keyNonce, recipientPubKeyBytes);
    if (!encryptedFileKey) {
      console.error('[FileTransfer] Failed to encrypt file key');
      return null;
    }

    const totalChunks = Math.ceil(encrypted.encryptedData.length / CHUNK_SIZE);

    // Store transfer state
    const transfer: FileTransferState = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      direction: 'sending',
      progress: 0,
      status: 'pending',
      peerId,
      totalChunks,
    };
    setTransfers(prev => new Map(prev).set(fileId, transfer));

    // Send offer
    const offer: FileTransferOffer = {
      fileId,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      totalChunks,
      encryptedNonce: encrypted.nonce,
      keyNonce: naclUtil.encodeBase64(keyNonce),
    };

    p2p.sendMessage(peerId, {
      id: `offer-${fileId}`,
      type: 'file-offer',
      senderId: localPublicId,
      recipientId: peerId,
      timestamp: Date.now(),
      fileOffer: offer,
      // File key encrypted with recipient's public key via boxEncrypt
      encrypted: naclUtil.encodeBase64(encryptedFileKey),
    });

    // Store encrypted data chunks for sending after acceptance
    chunksBuffer.current.set(fileId, splitIntoChunks(encrypted.encryptedData, CHUNK_SIZE));

    return fileId;
  }, [localPublicId, boxEncrypt, generateFileKey, getRecipientPublicKey]);

  // Handle incoming file offer
  const handleFileOffer = useCallback((message: P2PMessage) => {
    if (!message.fileOffer) return;

    const offer = message.fileOffer;
    fileMetadata.current.set(offer.fileId, offer);

    // Store the encrypted file key and nonce for decryption when the file completes
    if (message.encrypted && offer.keyNonce) {
      encryptedFileKeys.current.set(offer.fileId, {
        encryptedKey: message.encrypted,
        keyNonce: offer.keyNonce,
        senderPublicId: message.senderId,
      });
    }

    const transfer: FileTransferState = {
      fileId: offer.fileId,
      fileName: offer.fileName,
      fileSize: offer.fileSize,
      fileType: offer.fileType,
      direction: 'receiving',
      progress: 0,
      status: 'pending',
      peerId: message.senderId,
      totalChunks: offer.totalChunks,
      chunksReceived: 0,
    };
    setTransfers(prev => new Map(prev).set(offer.fileId, transfer));
  }, []);

  // Accept a file transfer
  const acceptTransfer = useCallback((fileId: string) => {
    const transfer = transfers.get(fileId);
    if (!transfer || transfer.status !== 'pending') return;

    const p2p = getP2PManager(localPublicId);
    p2p.sendMessage(transfer.peerId, {
      id: `accept-${fileId}`,
      type: 'file-accept',
      senderId: localPublicId,
      recipientId: transfer.peerId,
      timestamp: Date.now(),
      encrypted: fileId,
    });

    setTransfers(prev => {
      const next = new Map(prev);
      next.set(fileId, { ...transfer, status: 'transferring' });
      return next;
    });
    chunksBuffer.current.set(fileId, []);
  }, [transfers, localPublicId]);

  // Reject a file transfer
  const rejectTransfer = useCallback((fileId: string) => {
    const transfer = transfers.get(fileId);
    if (!transfer) return;

    const p2p = getP2PManager(localPublicId);
    p2p.sendMessage(transfer.peerId, {
      id: `reject-${fileId}`,
      type: 'file-reject',
      senderId: localPublicId,
      recipientId: transfer.peerId,
      timestamp: Date.now(),
      encrypted: fileId,
    });

    setTransfers(prev => {
      const next = new Map(prev);
      next.set(fileId, { ...transfer, status: 'rejected' });
      return next;
    });
  }, [transfers, localPublicId]);

  // Handle file acceptance (sender side) - start sending chunks
  const handleFileAccept = useCallback((message: P2PMessage) => {
    const fileId = message.encrypted;
    if (!fileId) return;

    const chunks = chunksBuffer.current.get(fileId);
    if (!chunks) return;

    const p2p = getP2PManager(localPublicId);

    setTransfers(prev => {
      const next = new Map(prev);
      const transfer = prev.get(fileId);
      if (transfer) next.set(fileId, { ...transfer, status: 'transferring' });
      return next;
    });

    // Send chunks sequentially with small delays to avoid overwhelming the data channel
    let chunkIndex = 0;
    const sendNextChunk = () => {
      if (chunkIndex >= chunks.length) {
        // All chunks sent
        p2p.sendMessage(message.senderId, {
          id: `complete-${fileId}`,
          type: 'file-complete',
          senderId: localPublicId,
          recipientId: message.senderId,
          timestamp: Date.now(),
          encrypted: fileId,
        });
        setTransfers(prev => {
          const next = new Map(prev);
          const transfer = prev.get(fileId);
          if (transfer) next.set(fileId, { ...transfer, status: 'complete', progress: 100 });
          return next;
        });
        chunksBuffer.current.delete(fileId);
        return;
      }

      const chunk: FileChunk = {
        fileId,
        chunkIndex,
        data: naclUtil.encodeBase64(chunks[chunkIndex]),
      };

      p2p.sendMessage(message.senderId, {
        id: `chunk-${fileId}-${chunkIndex}`,
        type: 'file-chunk',
        senderId: localPublicId,
        recipientId: message.senderId,
        timestamp: Date.now(),
        fileChunk: chunk,
      });

      const progress = Math.round(((chunkIndex + 1) / chunks.length) * 100);
      setTransfers(prev => {
        const next = new Map(prev);
        const transfer = prev.get(fileId);
        if (transfer) next.set(fileId, { ...transfer, progress });
        return next;
      });

      chunkIndex++;
      setTimeout(sendNextChunk, 5); // 5ms delay between chunks
    };

    sendNextChunk();
  }, [localPublicId]);

  // Handle incoming chunk
  const handleFileChunk = useCallback((message: P2PMessage) => {
    if (!message.fileChunk) return;
    const { fileId, chunkIndex, data } = message.fileChunk;

    const chunks = chunksBuffer.current.get(fileId);
    if (!chunks) return;

    chunks[chunkIndex] = naclUtil.decodeBase64(data);

    const metadata = fileMetadata.current.get(fileId);
    const received = chunks.filter(Boolean).length;
    const total = metadata?.totalChunks || 1;
    const progress = Math.round((received / total) * 100);

    setTransfers(prev => {
      const next = new Map(prev);
      const transfer = prev.get(fileId);
      if (transfer) next.set(fileId, { ...transfer, progress, chunksReceived: received });
      return next;
    });
  }, []);

  // Handle file complete - reassemble and decrypt
  const handleFileComplete = useCallback(async (message: P2PMessage) => {
    const fileId = message.encrypted;
    if (!fileId) return;

    const chunks = chunksBuffer.current.get(fileId);
    const metadata = fileMetadata.current.get(fileId);
    const keyInfo = encryptedFileKeys.current.get(fileId);
    if (!chunks || !metadata) return;

    // Reassemble
    const totalLength = chunks.reduce((sum, c) => sum + (c?.length || 0), 0);
    const assembled = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      if (chunk) {
        assembled.set(chunk, offset);
        offset += chunk.length;
      }
    }

    // Decrypt the file key and then the file data
    if (keyInfo && boxOpen) {
      const encryptedKeyBytes = naclUtil.decodeBase64(keyInfo.encryptedKey);
      const keyNonceBytes = naclUtil.decodeBase64(keyInfo.keyNonce);

      // Get sender's public key to open the box
      const senderPublicKey = await getRecipientPublicKey(keyInfo.senderPublicId);
      if (senderPublicKey) {
        const senderPubKeyBytes = naclUtil.decodeBase64(senderPublicKey);

        const fileKey = boxOpen(encryptedKeyBytes, keyNonceBytes, senderPubKeyBytes);
        if (fileKey) {
          const decrypted = decryptFileData(assembled, metadata.encryptedNonce, fileKey);
          if (decrypted) {
            // Trigger download
            const blob = new Blob([decrypted], { type: metadata.fileType || 'application/octet-stream' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = metadata.fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
          } else {
            console.error('[FileTransfer] Failed to decrypt file data');
          }
        } else {
          console.error('[FileTransfer] Failed to decrypt file key');
        }
      } else {
        console.error('[FileTransfer] Could not get sender public key for decryption');
      }
    } else {
      console.error('[FileTransfer] Missing encrypted file key info or boxOpen not available');
    }

    setTransfers(prev => {
      const next = new Map(prev);
      const transfer = prev.get(fileId);
      if (transfer) next.set(fileId, { ...transfer, status: 'complete', progress: 100 });
      return next;
    });

    // Clean up
    chunksBuffer.current.delete(fileId);
    fileMetadata.current.delete(fileId);
    encryptedFileKeys.current.delete(fileId);
  }, [boxOpen, getRecipientPublicKey]);

  // Handle incoming P2P message for file transfers
  const handleMessage = useCallback((message: P2PMessage) => {
    switch (message.type) {
      case 'file-offer': handleFileOffer(message); break;
      case 'file-accept': handleFileAccept(message); break;
      case 'file-chunk': handleFileChunk(message); break;
      case 'file-complete': handleFileComplete(message); break;
      case 'file-reject': {
        const fileId = message.encrypted;
        if (fileId) {
          setTransfers(prev => {
            const next = new Map(prev);
            const transfer = prev.get(fileId);
            if (transfer) next.set(fileId, { ...transfer, status: 'rejected' });
            return next;
          });
          chunksBuffer.current.delete(fileId);
        }
        break;
      }
    }
  }, [handleFileOffer, handleFileAccept, handleFileChunk, handleFileComplete]);

  return {
    transfers,
    sendFile,
    acceptTransfer,
    rejectTransfer,
    handleMessage,
  };
}

// Helper: split Uint8Array into chunks
function splitIntoChunks(data: Uint8Array, chunkSize: number): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += chunkSize) {
    chunks.push(data.slice(i, i + chunkSize));
  }
  return chunks;
}
