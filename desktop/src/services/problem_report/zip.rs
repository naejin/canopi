pub(crate) struct ZipEntry {
    name: &'static str,
    data: Vec<u8>,
}

impl ZipEntry {
    pub(crate) fn new(name: &'static str, data: Vec<u8>) -> Self {
        Self { name, data }
    }
}

pub(crate) fn create_stored_zip(entries: &[ZipEntry]) -> Result<Vec<u8>, String> {
    let mut output = Vec::new();
    let mut central_directory = Vec::new();

    for entry in entries {
        let name = entry.name.as_bytes();
        let size = u32::try_from(entry.data.len())
            .map_err(|_| format!("Diagnostic bundle entry '{}' is too large", entry.name))?;
        let offset =
            u32::try_from(output.len()).map_err(|_| "Diagnostic bundle is too large".to_owned())?;
        let name_len = u16::try_from(name.len())
            .map_err(|_| format!("Diagnostic bundle entry name '{}' is too long", entry.name))?;
        let crc = crc32(&entry.data);

        write_u32(&mut output, 0x0403_4b50);
        write_u16(&mut output, 20);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u16(&mut output, 0);
        write_u32(&mut output, crc);
        write_u32(&mut output, size);
        write_u32(&mut output, size);
        write_u16(&mut output, name_len);
        write_u16(&mut output, 0);
        output.extend_from_slice(name);
        output.extend_from_slice(&entry.data);

        write_u32(&mut central_directory, 0x0201_4b50);
        write_u16(&mut central_directory, 20);
        write_u16(&mut central_directory, 20);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u32(&mut central_directory, crc);
        write_u32(&mut central_directory, size);
        write_u32(&mut central_directory, size);
        write_u16(&mut central_directory, name_len);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u16(&mut central_directory, 0);
        write_u32(&mut central_directory, 0);
        write_u32(&mut central_directory, offset);
        central_directory.extend_from_slice(name);
    }

    let central_directory_offset =
        u32::try_from(output.len()).map_err(|_| "Diagnostic bundle is too large".to_owned())?;
    let central_directory_size = u32::try_from(central_directory.len())
        .map_err(|_| "Diagnostic bundle central directory is too large".to_owned())?;
    let entry_count = u16::try_from(entries.len())
        .map_err(|_| "Diagnostic bundle has too many entries".to_owned())?;

    output.extend_from_slice(&central_directory);
    write_u32(&mut output, 0x0605_4b50);
    write_u16(&mut output, 0);
    write_u16(&mut output, 0);
    write_u16(&mut output, entry_count);
    write_u16(&mut output, entry_count);
    write_u32(&mut output, central_directory_size);
    write_u32(&mut output, central_directory_offset);
    write_u16(&mut output, 0);

    Ok(output)
}

fn write_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            let mask = 0u32.wrapping_sub(crc & 1);
            crc = (crc >> 1) ^ (0xedb8_8320 & mask);
        }
    }
    !crc
}
