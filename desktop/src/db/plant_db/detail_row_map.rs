use common_types::species::SpeciesDetail;
use rusqlite::{Row, types::FromSql};

use super::detail_contract::detail_contract_columns;

struct DetailCursor<'row, 'stmt> {
    row: &'row Row<'stmt>,
    index: usize,
}

impl<'row, 'stmt> DetailCursor<'row, 'stmt> {
    fn new(row: &'row Row<'stmt>) -> Self {
        Self { row, index: 0 }
    }

    fn read<T: FromSql>(&mut self) -> rusqlite::Result<T> {
        let value = self.row.get(self.index)?;
        self.index += 1;
        Ok(value)
    }

    fn read_bool(&mut self) -> rusqlite::Result<Option<bool>> {
        self.read::<Option<i32>>()
            .map(|value| value.map(|v| v != 0))
    }

    fn finish(self) {
        debug_assert_eq!(self.index, detail_contract_columns().len());
    }
}

pub(super) fn map_detail_row(row: &Row<'_>) -> rusqlite::Result<(String, SpeciesDetail)> {
    let mut cursor = DetailCursor::new(row);

    let species_id: String = cursor.read()?;
    let canonical_name = cursor.read()?;
    let fallback_common = cursor.read()?;

    let detail = SpeciesDetail {
        canonical_name,
        common_name: fallback_common,
        family: cursor.read()?,
        genus: cursor.read()?,
        taxonomic_order: cursor.read()?,
        taxonomic_class: cursor.read()?,
        is_hybrid: cursor.read_bool()?,
        match_confidence: cursor.read()?,
        tnrs_taxonomic_status: cursor.read()?,
        match_score: cursor.read()?,
        source: cursor.read()?,
        enriched_at: cursor.read()?,
        enrichment_provenance: cursor.read()?,
        height_min_m: cursor.read()?,
        height_max_m: cursor.read()?,
        width_max_m: cursor.read()?,
        hardiness_zone_min: cursor.read()?,
        hardiness_zone_max: cursor.read()?,
        age_of_maturity_years: cursor.read()?,
        growth_rate: cursor.read()?,
        is_annual: cursor.read_bool()?,
        is_biennial: cursor.read_bool()?,
        is_perennial: cursor.read_bool()?,
        lifespan: cursor.read()?,
        deciduous_evergreen: cursor.read()?,
        leaf_retention: cursor.read_bool()?,
        active_growth_period: cursor.read()?,
        habit: cursor.read()?,
        growth_form_type: cursor.read()?,
        growth_form_shape: cursor.read()?,
        growth_habit: cursor.read()?,
        woody: cursor.read_bool()?,
        canopy_position: cursor.read()?,
        resprout_ability: cursor.read_bool()?,
        coppice_potential: cursor.read_bool()?,
        bloom_period: cursor.read()?,
        flower_color: cursor.read()?,
        pollinators: cursor.read()?,
        tolerates_full_sun: cursor.read_bool()?,
        tolerates_semi_shade: cursor.read_bool()?,
        tolerates_full_shade: cursor.read_bool()?,
        frost_tender: cursor.read_bool()?,
        frost_free_days_min: cursor.read()?,
        drought_tolerance: cursor.read()?,
        precip_min_inches: cursor.read()?,
        precip_max_inches: cursor.read()?,
        soil_ph_min: cursor.read()?,
        soil_ph_max: cursor.read()?,
        well_drained: cursor.read_bool()?,
        heavy_clay: cursor.read_bool()?,
        tolerates_light_soil: cursor.read_bool()?,
        tolerates_medium_soil: cursor.read_bool()?,
        tolerates_heavy_soil: cursor.read_bool()?,
        tolerates_acid: cursor.read_bool()?,
        tolerates_alkaline: cursor.read_bool()?,
        tolerates_saline: cursor.read_bool()?,
        tolerates_wind: cursor.read_bool()?,
        tolerates_pollution: cursor.read_bool()?,
        tolerates_nutritionally_poor: cursor.read_bool()?,
        fertility_requirement: cursor.read()?,
        moisture_use: cursor.read()?,
        anaerobic_tolerance: cursor.read()?,
        root_depth_min_cm: cursor.read()?,
        salinity_tolerance: cursor.read()?,
        stratum: cursor.read()?,
        succession_stage: cursor.read()?,
        stratum_confidence: cursor.read()?,
        succession_confidence: cursor.read()?,
        nitrogen_fixer: cursor.read_bool()?,
        ecological_system: cursor.read()?,
        mycorrhizal_type: cursor.read()?,
        grime_strategy: cursor.read()?,
        raunkiaer_life_form: cursor.read()?,
        cn_ratio: cursor.read()?,
        allelopathic: cursor.read_bool()?,
        root_system_type: cursor.read()?,
        taproot_persistent: cursor.read_bool()?,
        edibility_rating: cursor.read()?,
        medicinal_rating: cursor.read()?,
        other_uses_rating: cursor.read()?,
        attracts_wildlife: cursor.read_bool()?,
        scented: cursor.read_bool()?,
        uses: vec![],
        propagated_by_seed: cursor.read_bool()?,
        propagated_by_cuttings: cursor.read_bool()?,
        propagated_by_bare_root: cursor.read_bool()?,
        propagated_by_container: cursor.read_bool()?,
        propagated_by_sprigs: cursor.read_bool()?,
        propagated_by_bulb: cursor.read_bool()?,
        propagated_by_sod: cursor.read_bool()?,
        propagated_by_tubers: cursor.read_bool()?,
        propagated_by_corm: cursor.read_bool()?,
        cold_stratification_required: cursor.read_bool()?,
        vegetative_spread_rate: cursor.read()?,
        seed_spread_rate: cursor.read()?,
        propagation_method: cursor.read()?,
        sowing_period: cursor.read()?,
        harvest_period: cursor.read()?,
        dormancy_conditions: cursor.read()?,
        management_types: cursor.read()?,
        fruit_type: cursor.read()?,
        fruit_seed_color: cursor.read()?,
        fruit_seed_period_begin: cursor.read()?,
        fruit_seed_period_end: cursor.read()?,
        fruit_seed_abundance: cursor.read()?,
        fruit_seed_persistence: cursor.read_bool()?,
        seed_mass_mg: cursor.read()?,
        seed_length_mm: cursor.read()?,
        seed_germination_rate: cursor.read()?,
        seed_dispersal_mechanism: cursor.read()?,
        seed_storage_behaviour: cursor.read()?,
        seed_dormancy_type: cursor.read()?,
        seed_dormancy_depth: cursor.read()?,
        serotinous: cursor.read_bool()?,
        seedbank_type: cursor.read()?,
        leaf_type: cursor.read()?,
        leaf_compoundness: cursor.read()?,
        leaf_shape: cursor.read()?,
        sla_mm2_mg: cursor.read()?,
        ldmc_g_g: cursor.read()?,
        leaf_nitrogen_mg_g: cursor.read()?,
        leaf_carbon_mg_g: cursor.read()?,
        leaf_phosphorus_mg_g: cursor.read()?,
        leaf_dry_mass_mg: cursor.read()?,
        pollination_syndrome: cursor.read()?,
        sexual_system: cursor.read()?,
        mating_system: cursor.read()?,
        self_fertile: cursor.read_bool()?,
        reproductive_type: cursor.read()?,
        clonal_growth_form: cursor.read()?,
        storage_organ: cursor.read()?,
        toxicity: cursor.read()?,
        invasive_potential: cursor.read()?,
        biogeographic_status: cursor.read()?,
        noxious_status: cursor.read_bool()?,
        invasive_usda: cursor.read_bool()?,
        weed_potential: cursor.read_bool()?,
        fire_resistant: cursor.read_bool()?,
        fire_tolerance: cursor.read()?,
        hedge_tolerance: cursor.read()?,
        native_distribution: cursor.read()?,
        introduced_distribution: cursor.read()?,
        climate_zones: cursor.read()?,
        conservation_status: cursor.read()?,
        image_urls: cursor.read()?,
        ellenberg_light: cursor.read()?,
        ellenberg_temperature: cursor.read()?,
        ellenberg_moisture: cursor.read()?,
        ellenberg_reaction: cursor.read()?,
        ellenberg_nitrogen: cursor.read()?,
        ellenberg_salt: cursor.read()?,
        classification_source: cursor.read()?,
        model_version: cursor.read()?,
        prompt_version: cursor.read()?,
        classified_at: cursor.read()?,
        validation_flags: cursor.read()?,
        overall_confidence: cursor.read()?,
        validation_flag_count: cursor.read()?,
        data_quality_tier: cursor.read()?,
        wood_density_g_cm3: cursor.read()?,
        photosynthesis_pathway: cursor.read()?,
        relationships: vec![],
    };

    cursor.finish();
    Ok((species_id, detail))
}
