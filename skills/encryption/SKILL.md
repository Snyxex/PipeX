---
name: encryption
description: Apply authenticated encryption and manage keys safely.
---
# encryption

Use this skill when the task matches the description.

## Instructions
Use EncryptionPlugin from 'pipex'; README demonstrates { algorithm: 'aes-256-gcm', key: randomBytes(32) }. Never hardcode or log keys. Stream encryption uses framed versioned PXAE format; authenticated final frame detects truncation, sequence numbers detect reorder/duplicate. The v4 writer does not emit legacy format; review docs/encryption-v4-migration.md before migrations. Consider allowLegacyDecrypt: false after migration. Verify authentication failure and cancellation.

## Verification
Inspect the checked-out source and relevant tests before proposing code. Prefer the public API, document assumptions, and do not claim tests passed unless executed.
