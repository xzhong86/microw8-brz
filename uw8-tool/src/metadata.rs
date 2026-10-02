use anyhow::{bail, Result};
use std::borrow::Cow;
use wasm_encoder::{CustomSection, Module};

pub const NAME: &str = "microw8.meta";
pub const MAX_SIZE: usize = 4096;

pub fn validate_id(id: &str) -> Result<()> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
    {
        bail!("ID must contain 1-128 ASCII letters, digits, '.', '_' or '-'");
    }
    Ok(())
}

pub fn metadata(wasm: &[u8]) -> Result<Option<serde_json::Value>> {
    let mut result = None;
    for payload in wasmparser::Parser::new(0).parse_all(wasm) {
        if let wasmparser::Payload::CustomSection(section) = payload? {
            if section.name() == NAME {
                if result.is_some() || section.data().len() > MAX_SIZE {
                    bail!("Duplicate or oversized microw8.meta");
                }
                let value: serde_json::Value = serde_json::from_slice(section.data())?;
                if value.get("schemaVersion").and_then(|v| v.as_u64()) != Some(1) {
                    bail!("Unsupported microw8.meta schemaVersion");
                }
                validate_id(
                    value
                        .get("saveId")
                        .and_then(|v| v.as_str())
                        .ok_or_else(|| anyhow::anyhow!("Missing saveId"))?,
                )?;
                result = Some(value);
            }
        }
    }
    Ok(result)
}

pub fn section(value: &serde_json::Value) -> Result<Vec<u8>> {
    let bytes = serde_json::to_vec(value)?;
    if bytes.len() > MAX_SIZE {
        bail!("Oversized microw8.meta");
    }
    let mut module = Module::new();
    module.section(&CustomSection {
        name: Cow::Borrowed(NAME),
        data: Cow::Borrowed(&bytes),
    });
    Ok(module.finish()[8..].to_vec())
}

pub fn with_save_id(wasm: &[u8], id: &str) -> Result<Vec<u8>> {
    validate_id(id)?;
    let mut value = metadata(wasm)?.unwrap_or_else(|| serde_json::json!({"schemaVersion": 1}));
    value["saveId"] = id.into();
    let mut result = wasm[..8].to_vec();
    result.extend(section(&value)?);
    for payload in wasmparser::Parser::new(0).parse_all(wasm) {
        let payload = payload?;
        if matches!(&payload, wasmparser::Payload::CustomSection(s) if s.name() == NAME) {
            continue;
        }
        if let Some((id, range)) = payload.as_section() {
            let mut m = Module::new();
            m.section(&wasm_encoder::RawSection {
                id,
                data: &wasm[range],
            });
            result.extend_from_slice(&m.finish()[8..]);
        }
    }
    Ok(result)
}
