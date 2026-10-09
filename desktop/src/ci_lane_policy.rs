//! Test-only policy for the CI `lidar-native` lane (P51, canopi-ne8c).
//!
//! The lane runs the crate's ignored LiDAR tests on a CI host that has no local fixtures (IGN
//! tiles, MNH batches). An ignored test that needs one says so with an ignore reason starting
//! `local fixture: `, and the lane skips it by name. The test reads the lane's `cargo test` line in
//! `.github/workflows/build.yml` as text and fails when a `local fixture:` test under the lane's
//! filter has no `--skip`, when a reason names a fixture (`CANOPI_LIDAR_*_DIR`, `*_FIXTURE`, IGN)
//! without the prefix, or when a `--skip` matches no ignored test under the filter.

use std::{fs, path::Path};

use syn::{
    Attribute, Expr, ExprLit, ItemFn, ItemMod, Lit, Meta,
    visit::{self, Visit},
};

use crate::module_layering::module_path_of;
use crate::native_command_policy::rust_sources_under;

const LANE_JOB: &str = "lidar-native";
const LOCAL_FIXTURE_PREFIX: &str = "local fixture: ";

/// The lane's `cargo test` filter and its `--skip` values.
#[derive(Debug, Eq, PartialEq)]
struct Lane {
    filter: String,
    skips: Vec<String>,
}

fn parse_lane(workflow: &str) -> Result<Lane, String> {
    let job_header = format!("  {LANE_JOB}:");
    let mut lines = workflow.lines().skip_while(|line| *line != job_header);
    if lines.next().is_none() {
        return Err(format!("build.yml has no {LANE_JOB} job"));
    }
    let command = lines
        .take_while(|line| {
            // The job ends at the next key indented like the job's own.
            line.is_empty() || line.starts_with("   ") || line.trim_start().starts_with('#')
        })
        .find(|line| line.contains("cargo test"))
        .ok_or_else(|| format!("the {LANE_JOB} job runs no cargo test"))?;

    let words = command
        .split_whitespace()
        .skip_while(|word| *word != "cargo")
        .collect::<Vec<_>>();
    let separator = words.iter().position(|word| *word == "--");
    let (cargo_words, test_words) = match separator {
        Some(index) => (&words[..index], &words[index + 1..]),
        None => (&words[..], &[][..]),
    };
    let mut filters = Vec::new();
    let mut cargo_words = cargo_words.iter().skip(2);
    while let Some(word) = cargo_words.next() {
        if matches!(*word, "-p" | "--package" | "--features" | "-F" | "--target") {
            cargo_words.next();
        } else if !word.starts_with('-') {
            filters.push((*word).to_owned());
        }
    }
    let [filter] = filters.as_slice() else {
        return Err(format!(
            "the {LANE_JOB} cargo test needs exactly one test filter, found {filters:?}"
        ));
    };
    let mut skips = Vec::new();
    let mut test_words = test_words.iter();
    while let Some(word) = test_words.next() {
        if *word == "--skip" {
            match test_words.next() {
                Some(value) => skips.push((*value).to_owned()),
                None => return Err(format!("the {LANE_JOB} cargo test ends with a bare --skip")),
            }
        }
    }
    Ok(Lane {
        filter: filter.clone(),
        skips,
    })
}

/// An `#[ignore]` test: its full name as the test harness prints it, and its reason.
#[derive(Debug)]
struct IgnoredTest {
    name: String,
    reason: Option<String>,
}

fn audit_ci_lane(workflow: &str, sources: &[(&str, &str)]) -> Vec<String> {
    let mut violations = Vec::new();
    let mut ignored = Vec::new();
    for (path, source) in sources {
        match syn::parse_file(source) {
            Ok(file) => {
                let mut visitor = IgnoredTestVisitor {
                    module: module_path_of(path),
                    tests: Vec::new(),
                };
                visitor.visit_file(&file);
                ignored.extend(visitor.tests);
            }
            Err(error) => {
                violations.push(format!("failed to parse {path} for the CI lane: {error}"))
            }
        }
    }

    for test in &ignored {
        if let Some(reason) = &test.reason
            && !reason.starts_with(LOCAL_FIXTURE_PREFIX)
            && names_a_local_fixture(reason)
        {
            violations.push(format!(
                "an ignore reason that names a local fixture starts with '{LOCAL_FIXTURE_PREFIX}': {}",
                test.name
            ));
        }
    }

    let lane = match parse_lane(workflow) {
        Ok(lane) => lane,
        Err(error) => {
            violations.push(error);
            return violations;
        }
    };
    let in_lane = ignored
        .iter()
        .filter(|test| test.name.contains(&lane.filter))
        .collect::<Vec<_>>();
    for test in &in_lane {
        let is_local_fixture = test
            .reason
            .as_deref()
            .is_some_and(|reason| reason.starts_with(LOCAL_FIXTURE_PREFIX));
        if is_local_fixture && !lane.skips.iter().any(|skip| test.name.contains(skip)) {
            violations.push(format!(
                "a local fixture test runs in the {LANE_JOB} lane; add a --skip for it: {}",
                test.name
            ));
        }
    }
    for skip in &lane.skips {
        if !in_lane.iter().any(|test| test.name.contains(skip)) {
            violations.push(format!(
                "the {LANE_JOB} lane's --skip {skip} matches no ignored test under {}",
                lane.filter
            ));
        }
    }
    violations.sort();
    violations
}

/// Whether a reason names a fixture: a `CANOPI_LIDAR_*_DIR` or `*_FIXTURE` variable, or IGN data.
fn names_a_local_fixture(reason: &str) -> bool {
    reason
        .split(|character: char| !(character.is_ascii_alphanumeric() || character == '_'))
        .any(|word| {
            word == "IGN"
                || (word.starts_with("CANOPI_LIDAR_") && word.ends_with("_DIR"))
                || (word.len() > "_FIXTURE".len() && word.ends_with("_FIXTURE"))
        })
}

struct IgnoredTestVisitor {
    module: Vec<String>,
    tests: Vec<IgnoredTest>,
}

impl<'ast> Visit<'ast> for IgnoredTestVisitor {
    fn visit_item_mod(&mut self, node: &'ast ItemMod) {
        self.module.push(node.ident.to_string());
        visit::visit_item_mod(self, node);
        self.module.pop();
    }

    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        if is_test(&node.attrs)
            && let Some(reason) = ignore_reason(&node.attrs)
        {
            let mut name = self.module.clone();
            name.push(node.sig.ident.to_string());
            self.tests.push(IgnoredTest {
                name: name.join("::"),
                reason,
            });
        }
        visit::visit_item_fn(self, node);
    }
}

fn is_test(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        attribute
            .path()
            .segments
            .last()
            .is_some_and(|segment| segment.ident == "test")
    })
}

/// `None` when the test is not ignored; `Some(None)` for a bare `#[ignore]`.
fn ignore_reason(attributes: &[Attribute]) -> Option<Option<String>> {
    let attribute = attributes
        .iter()
        .find(|attribute| attribute.path().is_ident("ignore"))?;
    Some(match &attribute.meta {
        Meta::NameValue(pair) => match &pair.value {
            Expr::Lit(ExprLit {
                lit: Lit::Str(reason),
                ..
            }) => Some(reason.value()),
            _ => None,
        },
        Meta::Path(_) | Meta::List(_) => None,
    })
}

fn audit_repository() -> Vec<String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let workflow = fs::read_to_string(manifest.join("../.github/workflows/build.yml")).unwrap();
    let mut paths = Vec::new();
    rust_sources_under(&manifest.join("src"), &mut paths);
    paths.sort();
    let owned = paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(manifest)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            let source = fs::read_to_string(&path).unwrap();
            (relative, source)
        })
        .collect::<Vec<_>>();
    let sources = owned
        .iter()
        .map(|(path, source)| (path.as_str(), source.as_str()))
        .collect::<Vec<_>>();
    audit_ci_lane(&workflow, &sources)
}

#[cfg(test)]
mod tests {
    use super::{Lane, audit_ci_lane, audit_repository, parse_lane};

    const WORKFLOW: &str = r#"
jobs:
  lidar-native:
    # Fixture lanes stay local.
    runs-on: ubuntu-24.04
    steps:
      - name: LiDAR native lanes
        run: |
          export CANOPI_GEOLIBRE_BIN
          cargo test -p canopi-desktop --lib --locked services::lidar -- --ignored --test-threads=1 --skip e2e_ --skip latency_probe

  platform-tests:
    steps:
      - run: cargo test -p canopi-desktop --lib -- --skip nothing_here
"#;

    const SKIPPED_FIXTURES: (&str, &str) = (
        "src/services/lidar/e2e.rs",
        r#"
            #[test]
            #[ignore = "local fixture: an IGN MNT tile; see CANOPI_LIDAR_E2E_FIXTURE"]
            fn e2e_import() {}
        "#,
    );

    const LATENCY_PROBE: (&str, &str) = (
        "src/services/lidar/inspection.rs",
        r#"
            #[cfg(test)]
            mod latency_probe {
                #[test]
                #[ignore = "local fixture: the IGN MNT tiles (CANOPI_LIDAR_SAMPLER_FIXTURE_DIR)"]
                fn sampler_latency() {}
            }
        "#,
    );

    #[test]
    fn repository_local_fixture_tests_are_skipped_in_the_lidar_lane() {
        let violations = audit_repository();
        assert!(
            violations.is_empty(),
            "CI lane policy violations:\n{}",
            violations.join("\n")
        );
    }

    #[test]
    fn the_lane_is_read_from_its_own_job() {
        assert_eq!(
            parse_lane(WORKFLOW),
            Ok(Lane {
                filter: "services::lidar".to_owned(),
                skips: vec!["e2e_".to_owned(), "latency_probe".to_owned()],
            })
        );
        assert_eq!(
            parse_lane("jobs:\n  test-rust:\n    steps: []\n"),
            Err("build.yml has no lidar-native job".to_owned())
        );
    }

    #[test]
    fn skipped_local_fixtures_and_other_ignored_tests_pass() {
        let violations = audit_ci_lane(
            WORKFLOW,
            &[
                SKIPPED_FIXTURES,
                LATENCY_PROBE,
                (
                    "src/services/lidar/analyses/tests.rs",
                    r#"
                        #[test]
                        #[ignore = "requires the pinned GeoLibre CLI (CANOPI_GEOLIBRE_BIN)"]
                        fn geolibre_slope() {}
                        #[tokio::test]
                        #[ignore]
                        async fn bare_ignore() {}
                    "#,
                ),
                (
                    "src/design/format.rs",
                    r#"
                        #[test]
                        #[ignore = "local fixture: the user's Designs in CANOPI_REAL_DESIGNS_DIR"]
                        fn real_designs_open() {}
                    "#,
                ),
            ],
        );

        assert_eq!(violations, Vec::<String>::new());
    }

    #[test]
    fn a_local_fixture_test_without_a_skip_fails() {
        let violations = audit_ci_lane(
            WORKFLOW,
            &[
                SKIPPED_FIXTURES,
                LATENCY_PROBE,
                (
                    "src/services/lidar/inspection.rs",
                    r#"
                        mod tests {
                            #[test]
                            #[ignore = "local fixture: the 12-tile MNH batch"]
                            fn mnh_batch() {}
                        }
                    "#,
                ),
            ],
        );

        assert_eq!(
            violations,
            [
                "a local fixture test runs in the lidar-native lane; add a --skip for it: services::lidar::inspection::tests::mnh_batch"
            ]
        );
    }

    #[test]
    fn a_fixture_reason_without_the_prefix_fails() {
        let violations = audit_ci_lane(
            WORKFLOW,
            &[
                SKIPPED_FIXTURES,
                LATENCY_PROBE,
                (
                    "src/services/lidar/fixtures.rs",
                    r#"
                        #[test]
                        #[ignore = "requires the 12-tile MNH batch; see CANOPI_LIDAR_MNH_DIR"]
                        fn mnh_dir() {}
                        #[test]
                        #[ignore = "needs CANOPI_LIDAR_E2E_FIXTURE"]
                        fn e2e_fixture() {}
                        #[test]
                        #[ignore = "requires IGN tiles"]
                        fn ign_tiles() {}
                        #[test]
                        #[ignore = "needs CANOPI_REAL_DESIGNS_DIR with the user's Designs"]
                        fn designs_dir() {}
                    "#,
                ),
            ],
        );

        assert_eq!(
            violations,
            [
                "an ignore reason that names a local fixture starts with 'local fixture: ': services::lidar::fixtures::e2e_fixture",
                "an ignore reason that names a local fixture starts with 'local fixture: ': services::lidar::fixtures::ign_tiles",
                "an ignore reason that names a local fixture starts with 'local fixture: ': services::lidar::fixtures::mnh_dir",
            ]
        );
    }

    #[test]
    fn a_skip_that_matches_no_test_fails() {
        let violations = audit_ci_lane(WORKFLOW, &[SKIPPED_FIXTURES]);

        assert_eq!(
            violations,
            [
                "the lidar-native lane's --skip latency_probe matches no ignored test under services::lidar"
            ]
        );
    }
}
