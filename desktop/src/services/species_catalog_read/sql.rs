use rusqlite::types::Value;

#[derive(Default)]
pub(super) struct ProjectionParams {
    values: Vec<Value>,
}

impl ProjectionParams {
    pub(super) fn push(&mut self, value: Value) -> String {
        self.values.push(value);
        format!("?{}", self.values.len())
    }

    pub(super) fn into_values(self) -> Vec<Value> {
        self.values
    }
}

pub(super) fn placeholders(count: usize) -> String {
    (0..count).map(|_| "?").collect::<Vec<_>>().join(", ")
}
