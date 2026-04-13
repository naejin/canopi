use serde::Deserialize;
use std::{fs, path::Path};

#[derive(Deserialize)]
pub(crate) struct SchemaContractFixture {
    pub(crate) schema_version: i32,
    pub(crate) columns: Vec<SchemaColumnFixture>,
    pub(crate) translations: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
pub(crate) struct SchemaColumnFixture {
    pub(crate) name: String,
}

pub(crate) fn load_schema_contract_fixture() -> SchemaContractFixture {
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/schema-contract.json");
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}
