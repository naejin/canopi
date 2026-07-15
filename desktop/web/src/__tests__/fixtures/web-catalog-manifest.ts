import { WEB_CATALOG_ARTIFACT_CONTRACT_FINGERPRINT } from '../../generated/web-catalog-artifact.mjs'
import {
  SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
  SPECIES_SEARCH_NORMALIZATION_VERSION,
} from '../../generated/species-search-normalization'

export const WEB_CATALOG_TEST_LOCALES = [
  'en',
  'fr',
  'es',
  'pt',
  'it',
  'zh',
  'de',
  'ja',
  'ko',
  'nl',
  'ru',
] as const

export function validWebCatalogManifest(): Record<string, unknown> {
  const names = Object.fromEntries(
    WEB_CATALOG_TEST_LOCALES.map((locale) => [locale, asset(`names/names-${locale}.parquet`, 'b')]),
  )
  const namePaths = WEB_CATALOG_TEST_LOCALES.map((locale) => `names/names-${locale}.parquet`)
  return {
    generated_by: 'canopi-web-catalog-v1',
    version: 1,
    artifact_contract_fingerprint: WEB_CATALOG_ARTIFACT_CONTRACT_FINGERPRINT,
    species_search_normalization: {
      version: SPECIES_SEARCH_NORMALIZATION_VERSION,
      fingerprint: SPECIES_SEARCH_NORMALIZATION_FINGERPRINT,
    },
    asset_format: 'parquet',
    asset_formats: {
      species: 'parquet',
      names: 'parquet',
      images: 'parquet',
    },
    source: {
      export_file: 'canopi-export-v14.db',
      export_schema_version: 14,
      storage_contract_fingerprint: 'a'.repeat(64),
    },
    cloudflare_pages: {
      max_asset_bytes: 25 * 1024 * 1024,
    },
    locales: [...WEB_CATALOG_TEST_LOCALES],
    supported_filters: [
      {
        key: 'climate_zones',
        options_key: 'climate_zones',
        predicate: { kind: 'json_array_any', columns: ['climate_zones'] },
      },
      {
        key: 'habit',
        options_key: 'habits',
        predicate: { kind: 'text_any', columns: ['habit', 'growth_form'] },
      },
      {
        key: 'life_cycle',
        options_key: 'life_cycles',
        predicate: { kind: 'json_array_any', columns: ['life_cycles'] },
      },
    ],
    schema: {
      species_fields: [
        { name: 'id', logical_type: 'required_text' },
        { name: 'slug', logical_type: 'required_text' },
        { name: 'canonical_name', logical_type: 'required_text' },
        { name: 'common_name', logical_type: 'nullable_text' },
        { name: 'normalized_canonical_name', logical_type: 'required_text' },
        { name: 'normalized_common_name', logical_type: 'nullable_text' },
        { name: 'climate_zones', logical_type: 'json_text_array' },
        { name: 'habit', logical_type: 'nullable_text' },
        { name: 'growth_form', logical_type: 'nullable_text' },
        { name: 'life_cycles', logical_type: 'json_text_array' },
      ],
      names_fields: [
        { name: 'species_id', logical_type: 'required_text' },
        { name: 'language', logical_type: 'required_text' },
        { name: 'common_name', logical_type: 'required_text' },
        { name: 'normalized_name', logical_type: 'required_text' },
        { name: 'is_primary', logical_type: 'boolean_text' },
        { name: 'display_order', logical_type: 'integer_text' },
      ],
      images_fields: [
        { name: 'species_id', logical_type: 'required_text' },
        { name: 'url', logical_type: 'required_text' },
        { name: 'source', logical_type: 'nullable_text' },
        { name: 'source_page_url', logical_type: 'nullable_text' },
        { name: 'credit', logical_type: 'nullable_text' },
        { name: 'license', logical_type: 'nullable_text' },
      ],
      excluded_detail_fields: [
        'edibility',
        'hardiness',
        'height',
        'stratum',
        'soil',
        'ecology',
        'propagation',
        'risk',
        'taxonomy',
      ],
    },
    duckdb: {
      reader: 'read_parquet',
      tables: {
        web_species: ['species/species-0000.parquet'],
        web_species_names: namePaths,
        web_species_images: ['images/images-0000.parquet'],
      },
    },
    assets: {
      species: [asset('species/species-0000.parquet', 'c')],
      names,
      images: [asset('images/images-0000.parquet', 'd')],
    },
  }
}

function asset(path: string, digestCharacter: string): Record<string, unknown> {
  return {
    path,
    bytes: 10,
    sha256: digestCharacter.repeat(64),
  }
}
