use common_types::species::Sort;

pub(crate) use crate::db::plant_filter_fields::validated_column;

/// Returns the SQL column expression for a given Sort variant.
pub fn sort_column(sort: &Sort) -> &'static str {
    match sort {
        Sort::Name | Sort::Relevance => "s.canonical_name",
        Sort::Family => "s.family",
        Sort::Height => "s.height_max_m",
        Sort::Hardiness => "s.hardiness_zone_min",
        Sort::GrowthRate => "s.growth_rate",
    }
}
