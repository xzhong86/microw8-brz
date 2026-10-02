#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cargo test --lib
mkdir -p target/save-test
cargo run -- pack --save-id test.persistence -u test/save-api.wat target/save-test/save-uncompressed.uw8
cargo run -- pack --save-id test.persistence test/save-api.wat target/save-test/save-compressed.uw8
cargo run -- unpack target/save-test/save-uncompressed.uw8 target/save-test/save.wasm
cargo run -- pack --save-id examples.save-counter examples/curlywas/save_counter.cwa target/save-test/counter.uw8
node --test web/test/*.test.mjs
