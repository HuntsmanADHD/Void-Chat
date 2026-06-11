#!/usr/bin/env python3
# libsodium ground-truth oracle for the Java seal module. Test-only — never
# shipped (same role Node/OpenSSL and the Rust argon2 crate played).
#
# Composes exactly the construction Box.java implements:
#   shared = crypto_scalarmult(sk, pk)            (X25519)
#   boxKey = crypto_core_hchacha20(zeros16, shared)
#   sealed = crypto_aead_xchacha20poly1305_ietf_encrypt(m, aad, n24, boxKey)
#
# Modes (argv[1]):
#   selfgen N   -> emit N random box test cases as JSON lines (Java verifies)
#   open        -> read JSON lines from stdin {sk,pk,nonce,ct(,aad)} sealed by
#                  Java, print plaintext hex (Java cross-checks the reverse)
#   prims       -> emit primitive vectors (hchacha20, xaead, scalarmult)
import sys, os, json, ctypes, binascii
import nacl.bindings as b
import nacl._sodium as _s

lib = ctypes.CDLL(_s.__file__)

def hchacha20(key32, in16):
    out = ctypes.create_string_buffer(32)
    assert lib.crypto_core_hchacha20(out, bytes(in16), bytes(key32), None) == 0
    return out.raw[:32]

def scalarmult(sk, pk):
    return b.crypto_scalarmult(bytes(sk), bytes(pk))

def scalarmult_base(sk):
    return b.crypto_scalarmult_base(bytes(sk))

def xaead_encrypt(m, aad, n24, key):
    return b.crypto_aead_xchacha20poly1305_ietf_encrypt(bytes(m), bytes(aad), bytes(n24), bytes(key))

def xaead_decrypt(ct, aad, n24, key):
    return b.crypto_aead_xchacha20poly1305_ietf_decrypt(bytes(ct), bytes(aad), bytes(n24), bytes(key))

def box_seal(sk, pk, n24, m, aad=b''):
    shared = scalarmult(sk, pk)
    boxkey = hchacha20(shared, b'\x00' * 16)
    return xaead_encrypt(m, aad, n24, boxkey)

def hx(x): return binascii.hexlify(x).decode()
def un(x): return binascii.unhexlify(x)

if sys.argv[1] == 'selfgen':
    n = int(sys.argv[2])
    for _ in range(n):
        sk_s = os.urandom(32); pk_s = scalarmult_base(sk_s)   # sender
        sk_r = os.urandom(32); pk_r = scalarmult_base(sk_r)   # recipient
        mlen = int.from_bytes(os.urandom(2), 'big') % 4096
        m = os.urandom(mlen)
        n24 = os.urandom(24)
        ct = box_seal(sk_s, pk_r, n24, m)
        # Java will open with (senderPub=pk_s, recipientSecret=sk_r)
        print(json.dumps({
            'senderPub': hx(pk_s), 'recipientSecret': hx(sk_r),
            'nonce': hx(n24), 'ct': hx(ct), 'plain': hx(m),
        }))
elif sys.argv[1] == 'open':
    # Java sealed; we (libsodium) open and print plaintext for cross-check.
    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        o = json.loads(line)
        sk_r = un(o['recipientSecret']); pk_s = un(o['senderPub'])
        shared = scalarmult(sk_r, pk_s)
        boxkey = hchacha20(shared, b'\x00' * 16)
        try:
            pt = xaead_decrypt(un(o['ct']), b'', un(o['nonce']), boxkey)
            print(hx(pt))
        except Exception:
            print("FAIL")
elif sys.argv[1] == 'prims':
    # primitive cross-vectors for hchacha20 / xaead / scalarmult
    out = {}
    # hchacha20 draft vector
    key = un('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
    inb = un('000000090000004a0000000031415927')
    out['hchacha20'] = {'key': hx(key), 'in': hx(inb), 'out': hx(hchacha20(key, inb))}
    # random xaead
    k = os.urandom(32); n24 = os.urandom(24); m = os.urandom(200); aad = os.urandom(16)
    out['xaead'] = {'key': hx(k), 'nonce': hx(n24), 'aad': hx(aad), 'm': hx(m),
                    'ct': hx(xaead_encrypt(m, aad, n24, k))}
    # random scalarmult
    sk = os.urandom(32); pk = scalarmult_base(os.urandom(32))
    out['scalarmult'] = {'sk': hx(sk), 'pk': hx(pk), 'shared': hx(scalarmult(sk, pk))}
    # base point
    sk2 = os.urandom(32)
    out['scalarmult_base'] = {'sk': hx(sk2), 'pub': hx(scalarmult_base(sk2))}
    print(json.dumps(out))
