use common_types::species::Sort;

pub(crate) use crate::db::plant_filter_fields::validated_column;

/// Returns a non-null SQL expression for keyset sorting and cursor comparison.
pub fn sort_key_expression(sort: &Sort) -> &'static str {
    match sort {
        Sort::Name | Sort::Relevance => "s.canonical_name",
        Sort::Family => "COALESCE(s.family, '')",
        Sort::Height => "COALESCE(s.height_max_m, -1.0)",
        Sort::Hardiness => "COALESCE(s.hardiness_zone_min, 0)",
        Sort::GrowthRate => "COALESCE(s.growth_rate, '')",
    }
}
