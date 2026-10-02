//! Host-owned save storage. Guest code never supplies a path or identity.
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::PathBuf,
};

pub const MAX_SAVE: usize = 65536;
pub const NOT_FOUND: i32 = -1;
pub const INVALID: i32 = -2;
pub const BUFFER_SMALL: i32 = -3;
pub const TOO_LARGE: i32 = -4;
pub const UNAVAILABLE: i32 = -5;
pub const IO_ERROR: i32 = -6;
pub const CORRUPT: i32 = -7;
pub const CONFLICT: i32 = -8;
pub const DENIED: i32 = -9;

#[derive(Clone, Debug)]
pub struct SaveConfig {
    pub save_id: Option<String>,
    pub profile: String,
    pub directory: Option<PathBuf>,
}
impl Default for SaveConfig {
    fn default() -> Self {
        Self {
            save_id: None,
            profile: "default".into(),
            directory: None,
        }
    }
}
impl SaveConfig {
    pub fn validate(&self) -> anyhow::Result<()> {
        uw8_tool::validate_id(&self.profile)?;
        if let Some(id) = &self.save_id {
            uw8_tool::validate_id(id)?;
        }
        Ok(())
    }
    pub fn game_key(&self, cart: &[u8], wasm: &[u8]) -> anyhow::Result<String> {
        self.validate()?;
        let meta = uw8_tool::metadata(wasm)?;
        let id = self
            .save_id
            .as_deref()
            .or_else(|| meta.as_ref().and_then(|m| m["saveId"].as_str()));
        Ok(hash(id.map(str::as_bytes).unwrap_or(cart)))
    }
    fn root(&self) -> Option<PathBuf> {
        self.directory.clone().or_else(|| {
            directories_next::ProjectDirs::from("", "", "microw8-brz")
                .map(|d| d.data_dir().join("saves"))
        })
    }
}
pub fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
pub fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = !0u32;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
// Envelope: magic (8), payload length (4), revision (4), CRC32 (4), payload.
fn decode(bytes: &[u8]) -> Result<(u32, Vec<u8>), i32> {
    if bytes.len() < 20 || &bytes[..8] != b"UW8SAVE1" {
        return Err(CORRUPT);
    }
    let word = |n| u32::from_le_bytes(bytes[n..n + 4].try_into().unwrap());
    let len = word(8) as usize;
    if len == 0 || len > MAX_SAVE || bytes.len() != len + 20 || crc32(&bytes[20..]) != word(16) {
        return Err(CORRUPT);
    }
    Ok((word(12), bytes[20..].to_vec()))
}
fn encode(data: &[u8], revision: u32) -> Vec<u8> {
    let mut bytes = b"UW8SAVE1".to_vec();
    bytes.extend_from_slice(&(data.len() as u32).to_le_bytes());
    bytes.extend_from_slice(&revision.to_le_bytes());
    bytes.extend_from_slice(&crc32(data).to_le_bytes());
    bytes.extend_from_slice(data);
    bytes
}

pub struct SaveStore {
    dir: Option<PathBuf>,
    key: String,
    writer: Option<File>,
}
impl SaveStore {
    pub fn new(config: &SaveConfig, key: String) -> Self {
        Self {
            dir: config
                .root()
                .map(|p| p.join(hash(config.profile.as_bytes()))),
            key,
            writer: None,
        }
    }
    fn path(&self, extension: &str) -> Result<PathBuf, i32> {
        Ok(self
            .dir
            .as_ref()
            .ok_or(UNAVAILABLE)?
            .join(format!("{}.{}", self.key, extension)))
    }
    fn reject_link(path: &std::path::Path) -> Result<(), i32> {
        match fs::symlink_metadata(path) {
            Ok(m) if m.file_type().is_symlink() => Err(IO_ERROR),
            Ok(_) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(IO_ERROR),
        }
    }
    fn lock(&mut self) -> Result<(), i32> {
        if self.writer.is_some() {
            return Ok(());
        }
        let dir = self.dir.as_ref().ok_or(UNAVAILABLE)?;
        Self::reject_link(dir)?;
        fs::create_dir_all(dir).map_err(|_| IO_ERROR)?;
        let path = self.path("lock")?;
        Self::reject_link(&path)?;
        let mut options = OpenOptions::new();
        options.create(true).read(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let file = options.open(path).map_err(|_| IO_ERROR)?;
        file.try_lock().map_err(|e| match e {
            std::fs::TryLockError::WouldBlock => CONFLICT,
            _ => IO_ERROR,
        })?;
        self.writer = Some(file);
        Ok(())
    }
    fn read_record(&self) -> Result<(u32, Vec<u8>), i32> {
        let path = self.path("sav")?;
        Self::reject_link(&path)?;
        let file = File::open(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                NOT_FOUND
            } else {
                IO_ERROR
            }
        })?;
        let mut bytes = Vec::new();
        file.take((MAX_SAVE + 21) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| IO_ERROR)?;
        decode(&bytes)
    }
    pub fn read(&self) -> Result<Vec<u8>, i32> {
        self.read_record().map(|(_, data)| data)
    }
    pub fn write(&mut self, data: &[u8]) -> Result<(), i32> {
        if data.is_empty() {
            return Err(INVALID);
        }
        if data.len() > MAX_SAVE {
            return Err(TOO_LARGE);
        }
        self.lock()?;
        let revision = match self.read_record() {
            Ok((n, _)) => n.wrapping_add(1),
            Err(NOT_FOUND) => 1,
            Err(e) => return Err(e),
        };
        let dest = self.path("sav")?;
        let temp = self.path("tmp")?;
        // Only our exclusive writer can own this temporary name. Never follow a link.
        Self::reject_link(&temp)?;
        match fs::remove_file(&temp) {
            Ok(()) => (),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(_) => return Err(IO_ERROR),
        }
        let result = (|| {
            let mut options = OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options.open(&temp).map_err(|_| IO_ERROR)?;
            file.write_all(&encode(data, revision))
                .map_err(|_| IO_ERROR)?;
            file.sync_all().map_err(|_| IO_ERROR)?;
            drop(file);
            fs::rename(&temp, &dest).map_err(|_| IO_ERROR)?;
            Ok(())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
    pub fn delete(&mut self) -> Result<(), i32> {
        self.lock()?;
        let path = self.path("sav")?;
        Self::reject_link(&path)?;
        match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(_) => Err(IO_ERROR),
        }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    pub struct Temp(pub PathBuf);
    impl Temp {
        pub fn new() -> Self {
            static NEXT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
            Self(std::env::temp_dir().join(format!(
                    "uw8-save-test-{}-{}-{}",
                    std::process::id(),
                    std::time::SystemTime::now()
                        .duration_since(std::time::UNIX_EPOCH)
                        .unwrap()
                        .as_nanos(),
                    NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                )))
        }
        pub fn config(&self) -> SaveConfig {
            SaveConfig {
                directory: Some(self.0.clone()),
                ..SaveConfig::default()
            }
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    #[test]
    fn persistence_isolation_conflict_and_corruption() {
        let temp = Temp::new();
        let config = temp.config();
        let mut a = SaveStore::new(&config, hash(b"game"));
        let mut b = SaveStore::new(&config, hash(b"game"));
        assert_eq!(a.read(), Err(NOT_FOUND));
        a.write(b"first").unwrap();
        assert_eq!(b.read().unwrap(), b"first");
        assert_eq!(b.write(b"other"), Err(CONFLICT));
        assert_eq!(b.delete(), Err(CONFLICT));
        assert_eq!(
            SaveStore::new(&config, hash(b"other")).read(),
            Err(NOT_FOUND)
        );
        let mut other_user = config.clone();
        other_user.profile = "alice".into();
        assert_eq!(
            SaveStore::new(&other_user, hash(b"game")).read(),
            Err(NOT_FOUND)
        );
        drop(a);
        b.write(&vec![42; MAX_SAVE]).unwrap();
        assert_eq!(b.read().unwrap().len(), MAX_SAVE);
        assert_eq!(b.write(&vec![0; MAX_SAVE + 1]), Err(TOO_LARGE));
        // A failed temporary-file creation leaves the committed save intact.
        fs::create_dir(b.path("tmp").unwrap()).unwrap();
        assert_eq!(b.write(b"replacement"), Err(IO_ERROR));
        assert_eq!(b.read().unwrap(), vec![42; MAX_SAVE]);
        fs::remove_dir(b.path("tmp").unwrap()).unwrap();
        let path = b.path("sav").unwrap();
        fs::write(&path, b"broken").unwrap();
        assert_eq!(b.read(), Err(CORRUPT));
        assert_eq!(b.write(b"replacement"), Err(CORRUPT));
        assert_eq!(fs::read(&path).unwrap(), b"broken");
        b.delete().unwrap();
        b.delete().unwrap();
        assert_eq!(b.read(), Err(NOT_FOUND));
    }
    #[test]
    fn envelope_and_id_contract() {
        assert_eq!(crc32(b"123456789"), 0xcbf43926);
        assert_eq!(decode(&encode(b"abc", 7)), Ok((7, b"abc".to_vec())));
        for id in ["", "../x", "a/b", "a b", "中文"] {
            assert!(uw8_tool::validate_id(id).is_err());
        }
        for id in ["my-games.sokoban", "123", "A_B"] {
            uw8_tool::validate_id(id).unwrap();
        }
        let wasm = wat::parse_str("(module)").unwrap();
        let tagged = uw8_tool::with_save_id(&wasm, "stable.game").unwrap();
        let mut cfg = SaveConfig::default();
        assert_eq!(
            cfg.game_key(b"cart", &tagged).unwrap(),
            hash(b"stable.game")
        );
        cfg.save_id = Some("override".into());
        assert_eq!(cfg.game_key(b"cart", &tagged).unwrap(), hash(b"override"));
    }
}
