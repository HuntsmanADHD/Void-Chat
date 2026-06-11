#!/usr/bin/env bash
# Full seal verification: fixed vectors + libsodium cross-checks both directions.
set -e
cd "$(dirname "$0")"
PY=/tmp/nacl-oracle/bin/python3

javac -d out Seal.java Box.java Base58.java SealTest.java SealReverse.java

# 1. primitive + selfgen oracle data from libsodium
$PY oracle.py prims > /tmp/seal_prims.json
$PY oracle.py selfgen 300 > /tmp/seal_selfgen.jsonl

# 2. Java fixed vectors + opens libsodium-sealed boxes + checks prims
java -cp out SealTest oracle

# 3. reverse: Java seals 300 random boxes, libsodium opens them
java -cp out SealReverse > /tmp/seal_java_sealed.jsonl
RESULT=$($PY oracle.py open < /tmp/seal_java_sealed.jsonl | paste -d' ' - /tmp/seal_java_expect.txt \
  | awk '{ if ($1 != $2) { bad++ } } END { print (bad+0) " mismatches of " NR }')
echo "reverse (Java→libsodium): $RESULT"
