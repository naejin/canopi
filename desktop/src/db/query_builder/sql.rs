use rusqlite::types::Value;

pub(super) fn escape_like_literal(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for character in value.chars() {
        if matches!(character, '\\' | '%' | '_') {
            escaped.push('\\');
        }
        escaped.push(character);
    }
    escaped
}

pub(super) fn like_predicate(expression: &str, placeholder: &str) -> String {
    format!("{expression} LIKE {placeholder} ESCAPE '\\'")
}

#[derive(Debug, Clone, Default)]
pub(super) struct SqlBuilder {
    params: Vec<Value>,
}

impl SqlBuilder {
    pub(super) fn bind(&mut self, value: Value) -> String {
        let placeholder = format!("?{}", self.params.len() + 1);
        self.params.push(value);
        placeholder
    }

    pub(super) fn bind_text(&mut self, value: impl Into<String>) -> String {
        self.bind(Value::Text(value.into()))
    }

    pub(super) fn bind_integer(&mut self, value: i64) -> String {
        self.bind(Value::Integer(value))
    }

    pub(super) fn bind_real(&mut self, value: f64) -> String {
        self.bind(Value::Real(value))
    }

    pub(super) fn bind_best_effort(&mut self, value: &str) -> String {
        if let Ok(number) = value.parse::<f64>() {
            self.bind_real(number)
        } else {
            self.bind_text(value)
        }
    }

    pub(super) fn bind_text_list(&mut self, values: &[String]) -> Vec<String> {
        values
            .iter()
            .map(|value| self.bind_text(value.clone()))
            .collect()
    }

    #[cfg(test)]
    pub(super) fn params(&self) -> &[Value] {
        &self.params
    }

    pub(super) fn into_params(self) -> Vec<Value> {
        self.params
    }
}

#[cfg(test)]
mod tests {
    use super::{SqlBuilder, escape_like_literal, like_predicate};
    use rusqlite::types::Value;

    #[test]
    fn bind_allocates_placeholders_in_param_order() {
        let mut builder = SqlBuilder::default();

        assert_eq!(builder.bind_text("fr"), "?1");
        assert_eq!(builder.bind_integer(20), "?2");
        assert_eq!(builder.bind_real(1.5), "?3");

        assert_eq!(
            builder.params(),
            &[
                Value::Text("fr".to_owned()),
                Value::Integer(20),
                Value::Real(1.5),
            ],
        );
    }

    #[test]
    fn like_helpers_escape_query_literals_and_declare_the_escape_character() {
        assert_eq!(escape_like_literal(r"snake\path%_"), r"snake\\path\%\_");
        assert_eq!(
            like_predicate("normalized_name", "?1"),
            r"normalized_name LIKE ?1 ESCAPE '\'",
        );
    }
}
