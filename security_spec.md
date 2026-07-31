# Security Specification - Cortex Dictionary

## 1. Data Invariants
- `Word` documents MUST belong to a specific `userId` matching the authenticated user.
- `userId` is immutable; once a word is saved, the owner cannot be changed.
- `timestamp` for a word MUST be set during creation and not modified later (immutable).
- `DictionaryCache` entries are public for reading but require authentication for writing.
- `specializedContexts`, `examples`, `synonyms`, `antonyms`, and `etymologyNodes` must be arrays (List) and are subject to size limits to prevent "Denial of Wallet" attacks.

## 2. The "Dirty Dozen" Payloads (Red Team Attack Vectors)

1. **Identity Spoofing**: `create` a word with `userId: "attacker_uid"` while authenticated as `victim_uid`.
2. **Owner Hijacking**: `update` an existing word's `userId` from `victim_uid` to `attacker_uid`.
3. **Ghost Word injection**: `create` a word with extra fields like `isPaid: true` or `isAdmin: true` to bypass hypothetical features.
4. **ID Poisoning**: `get` or `write` to a document with a 1.5KB string as the `wordId`.
5. **System Field Tampering**: Try to `update` `etymologyNodes` or `specializedContexts` with a gigantic 1MB string instead of an array.
6. **Cross-User Leak**: Authenticated User A tries to `list` or `get` words belonging to User B.
7. **Anonymous Write**: Try to `save` a word without being signed in.
8. **Resource Exhaustion**: `create` a word where `examples` array has 10,000 items.
9. **Timestamp Manipulation**: Set a future `timestamp` or `nextReviewAt` during creation.
10. **Cache Poisoning**: Authenticated attacker tries to `update` an existing `dictionary_cache` entry they didn't create with junk data.
11. **Mode Spoofing**: Save a word with a non-existent dictionary mode (e.g., `mode: "HACKER"`).
12. **PII Exposure**: User A tries to `get` the user profile or private data of User B (if such a path existed).

## 3. Test Runner Design
The tests will be implemented in `firestore.rules.test.ts` (conceptual for this environment, but logic will be derived).
- Verify `PERMISSION_DENIED` for all 12 payloads.
- Verify `SUCCESS` for legitimate search, save, and update operations.
