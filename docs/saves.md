# Game saves

Games can read and replace one private binary blob (1–65536 bytes). Multiple in-game
slots, settings and game-data migrations belong inside that blob. No filesystem,
path, directory or other game's identity is exposed to Wasm. This is game-managed
serialization, not a VM snapshot. The separate audio instance returns `-9` for all
save calls, including calls made by a Wasm start section.

## API

Opt in with `examples/include/microw8-save.h`, `microw8-save.cwa`, or
`microw8-save.wat`. Keep the existing base include as well. The base includes are
unchanged so existing games do not acquire new mandatory imports.

All four functions are imports from `env` and use i32 arguments/results:

| Function | Result |
| --- | --- |
| `saveSize()` | Number of bytes, or a negative error |
| `saveRead(dst, capacity)` | Copies the entire blob and returns its length; never partially copies |
| `saveWrite(src, length)` | Replaces the entire blob; returns 0 after the storage operation completes |
| `saveDelete()` | Deletes the entire blob, including all in-game slots; returns 0 even if absent |

Pointers are unsigned Wasm32 byte addresses. Length/capacity must be nonnegative,
and the whole supplied memory range must fit the current linear memory. Writes
must contain 1–65536 bytes. A successful write copies the source immediately.

| Error | Meaning |
| --- | --- |
| -1 | No save exists |
| -2 | Invalid length or memory range |
| -3 | Read buffer too small; destination unchanged |
| -4 | Save exceeds 64 KiB |
| -5 | Storage unavailable |
| -6 | Storage I/O error (including browser quota failures) |
| -7 | Invalid/corrupt save envelope |
| -8 | Another writer owns this save, or reliable browser locking is unavailable |
| -9 | Audio or closed instance: operation denied |

Load during initialization; save at checkpoints or when settings change, not every
frame. Check every return value. Only `-1` means "start with no previous save";
errors such as corruption must not be silently treated as a new game. Corrupt data
is retained and replacement is refused; explicit `saveDelete()` can clear it.

## Identity and users

```sh
uw8 pack --save-id my-games.sokoban game.wasm game.uw8
uw8 run --profile alice game.uw8
uw8 run --profile bob game.uw8
uw8 run --save-id my-games.sokoban --profile dev --save-dir ./local-saves game.uw8
```

`saveId` and profile accept 1–128 ASCII letters, digits, dots, underscores or
hyphens, case-sensitive. Prefer lowercase reverse-domain names for game IDs.
Profile defaults to `default`. Neither value is accepted from game API calls.

Identity precedence: run-time `--save-id` / Web host config `saveId`, then embedded
`saveId`, then SHA-256 of the exact input cartridge bytes. For an explicit/embedded
ID, `gameKey = SHA-256(UTF-8(saveId))`; otherwise `gameKey = SHA-256(cartBytes)`.
`profileKey = SHA-256(UTF-8(profile))`. Digests use lowercase hexadecimal.

A stable embedded ID preserves saves across renames, game updates and different
compression settings. Without one, recompiling/repacking may select a new save.
Keep the ID unchanged when upgrading game data; use a version inside your payload.
A manually overridden ID also works during watch/reload and reset.

Native storage defaults to the OS user's application data directory:

- macOS: `~/Library/Application Support/microw8-brz/saves/<profileKey>/<gameKey>.sav`
- Linux: `$XDG_DATA_HOME/microw8-brz/saves/...` (normally `~/.local/share/...`)
- Windows: the user's roaming application-data `microw8-brz/data/saves/...` directory

`--save-dir` replaces the `saves` root, not the profile subdirectory. Relative roots
are relative to the runner's working directory. This option is native-only;
browser mode rejects it rather than pretending to use a disk path. File locking
uses Rust's standard library and requires Rust 1.89 or newer to build.

Different OS users have different roots. Profiles separate players sharing an OS
account; they are a grouping mechanism, not authentication. IDs embedded in carts
are self-declared, not signed: two carts deliberately using the same ID share saves.

Web embeds accept `MicroW8(canvas, {saveId, profile, ...})`. Browser mode uses
`localStorage` key `microw8-brz:save:v1:<profileKey>:<gameKey>` and Web Locks for one
writer per game/profile. The dev server passes CLI identity/profile headers in the
same response as the cartridge. Standalone embeds do not trust these headers unless
`useSaveHeaders` is explicitly enabled. On browsers lacking Web Locks, reads remain
available but writes return `-8`. Storage/crypto access failure returns `-5`.
Browser origin (including port), browser profile and OS user provide additional
separation. Browser storage may be cleared; native and Web saves do not auto-sync.

Native writers acquire a nonblocking OS lock on first mutation and retain it for
the instance lifetime. Browser instances acquire a nonblocking session lock before
instantiation. Other instances can read but cannot write/delete while the lock is
held. Reload the browser's read-only instance to try acquiring a released lock.

## Format and compatibility

The optional Wasm custom section `microw8.meta` contains UTF-8 JSON:

```json
{"schemaVersion":1,"saveId":"my-games.sokoban"}
```

The section is limited to 4096 bytes; duplicates, malformed IDs, missing saveId and
unsupported schemaVersion are errors. Optional fields such as title and version
are preserved. `pack --save-id` sets/replaces the ID. Packing/repacking preserves
this section (other debug/custom sections retain the previous stripping behavior).
The metadata is placed before standard sections and compressed along with them.

The v1 base table and the `01`/`02` cartridge format are unchanged. Games importing
save functions retain explicit Type and Import sections, with indexes remapped
consistently. This costs some cartridge bytes. The current loader reconstructs
these sections without needing a new loader binary. Old games continue to run;
a save-enabled game requires a host that supplies these imports. Old hosts fail
at Wasm instantiation, even if the game never executes the save calls. There is
no additional API capability/version negotiation.

The host save envelope is identical before browser Base64 encoding:

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 8 | ASCII `UW8SAVE1` |
| 8 | 4 | Payload length, little-endian u32 |
| 12 | 4 | Revision, little-endian u32, increments modulo 2^32 |
| 16 | 4 | IEEE CRC32 of payload, little-endian u32 |
| 20 | 1–65536 | Game-owned payload |

Native writes sync a temporary file in the same directory and rename it over the
save, holding the writer lock. Temporary files and final saves are not followed if
they are symlinks. Errors before replacement leave the previous save intact.
Browser writes replace one storage item synchronously; no delayed writeback queue
is acknowledged as success. Neither backend promises protection against all power
loss, external tampering or browser data eviction. CRC32 detects accidental damage,
not malicious changes. A process crash releases its writer lock automatically.

## Validation

From the repository root:

```sh
bash test/run-save-tests.sh
```

This exercises native persistence, profile/game isolation, corruption, write failure,
locks and Wasm boundaries; raw/packed/compressed carts run through the actual loader
and platform on the native side. Node tests execute the Web save implementation and
real Wasm imports with mocked browser storage/locks, including denied audio imports
and missing imports on an old host. The generated HTML and embedded AudioWorklet
also run in a mocked browser environment with the counter cart, including save/reload.
These tests do not replace real browser/device testing.

After Web source changes rebuild the embedded runner:

```sh
cd web
npm install
npm run build:runner
```
