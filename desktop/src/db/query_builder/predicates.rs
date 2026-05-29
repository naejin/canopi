use common_types::species::SpeciesFilter;
use rusqlite::types::Value;

use super::filters::append_structured_filters;

pub(super) struct PredicatePlan {
    fts_join: Option<&'static str>,
    where_clauses: Vec<String>,
}

impl PredicatePlan {
    pub(super) fn for_search(
        search_term: Option<&str>,
        filters: &SpeciesFilter,
        params: &mut Vec<Value>,
    ) -> Self {
        let mut where_clauses = Vec::new();
        let fts_join = search_term.map(|term| {
            where_clauses.push(format!("species_search_fts MATCH ?{}", params.len() + 1));
            params.push(Value::Text(term.to_owned()));
            "JOIN species_search_fts ON species_search_fts.rowid = s.rowid"
        });

        append_structured_filters(&mut where_clauses, params, filters);

        Self {
            fts_join,
            where_clauses,
        }
    }

    pub(super) fn push(&mut self, clause: String) {
        self.where_clauses.push(clause);
    }

    pub(super) fn fts_join_sql(&self) -> &'static str {
        self.fts_join.unwrap_or("")
    }

    pub(super) fn where_sql(&self) -> String {
        if self.where_clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", self.where_clauses.join(" AND "))
        }
    }
}
