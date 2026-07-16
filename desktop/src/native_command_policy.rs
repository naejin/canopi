//! Test-only, AST-backed policy for native command registration and blocking execution.
//!
//! The Rust test suite parses command modules and the Tauri registry with `syn`, then checks the
//! complete command set against one small synchronous allowlist. It also scans production source
//! for blocking-pool and raw-thread escapes outside the managed executor owner.

use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};

use syn::{
    Attribute, Expr, ExprCall, ExprForLoop, ExprLoop, ExprMethodCall, ExprPath, ExprWhile, Item,
    ItemFn, ItemMod, Macro, Path as SynPath, TypePath,
    parse::Parser,
    punctuated::Punctuated,
    visit::{self, Visit},
};

#[derive(Clone, Copy)]
struct SyncCommandAllowance {
    path: &'static str,
    reason: &'static str,
}

const SYNC_COMMAND_ALLOWLIST: &[SyncCommandAllowance] = &[
    SyncCommandAllowance {
        path: "commands::community::get_template_catalog",
        reason: "constructs a fixed, bounded in-memory catalog",
    },
    SyncCommandAllowance {
        path: "commands::community::get_template_preview",
        reason: "selects one entry from the fixed, bounded in-memory catalog",
    },
    SyncCommandAllowance {
        path: "commands::design::new_design",
        reason: "constructs bounded generated defaults and a timestamp without external I/O",
    },
    SyncCommandAllowance {
        path: "commands::health::get_health",
        reason: "clones the immutable startup health snapshot",
    },
    SyncCommandAllowance {
        path: "commands::species::supersede_species_search",
        reason: "delivers a bounded in-memory cancellation signal that must bypass queued Catalog work",
    },
];

#[derive(Debug)]
struct CommandFact {
    path: String,
    is_async: bool,
    has_executor_state: bool,
    routes_through_executor: bool,
    awaits_managed_work: bool,
    direct_capabilities: BTreeSet<&'static str>,
}

fn audit_command_policy(
    registry_source: &str,
    command_sources: &[(&str, &str)],
    sync_allowlist: &[SyncCommandAllowance],
) -> Vec<String> {
    let mut violations = Vec::new();
    let registry = match parse_command_registry(registry_source) {
        Ok(registry) => registry,
        Err(error) => {
            violations.push(error);
            return violations;
        }
    };

    let mut commands = BTreeMap::new();
    for (module, source) in command_sources {
        match parse_command_facts(module, source) {
            Ok(facts) => {
                for fact in facts {
                    let path = fact.path.clone();
                    if commands.insert(path.clone(), fact).is_some() {
                        violations.push(format!("duplicate Tauri command: {path}"));
                    }
                }
            }
            Err(error) => violations.push(error),
        }
    }

    let registered = registry.iter().cloned().collect::<BTreeSet<_>>();
    let command_paths = commands.keys().cloned().collect::<BTreeSet<_>>();
    for duplicate in duplicates(&registry) {
        violations.push(format!(
            "duplicate native command registry entry: {duplicate}"
        ));
    }
    for path in registered.difference(&command_paths) {
        violations.push(format!(
            "registered native command has no #[tauri::command] function: {path}"
        ));
    }
    for path in command_paths.difference(&registered) {
        violations.push(format!(
            "#[tauri::command] function is missing from the native registry: {path}"
        ));
    }

    let mut allowances = BTreeMap::new();
    for allowance in sync_allowlist {
        if allowance.reason.trim().is_empty() {
            violations.push(format!(
                "synchronous command allowance has no reason: {}",
                allowance.path
            ));
        }
        if allowances
            .insert(allowance.path, allowance.reason)
            .is_some()
        {
            violations.push(format!(
                "duplicate synchronous command allowance: {}",
                allowance.path
            ));
        }
    }

    for command in commands.values() {
        if command.is_async {
            if !command.has_executor_state {
                violations.push(format!(
                    "async native command is missing NativeOperationExecutor state: {}",
                    command.path
                ));
            }
            if !command.routes_through_executor {
                violations.push(format!(
                    "async native command does not route work through its executor: {}",
                    command.path
                ));
            }
            if !command.awaits_managed_work {
                violations.push(format!(
                    "async native command does not await managed executor work: {}",
                    command.path
                ));
            }
            if command.direct_capabilities.contains("blocking pool") {
                violations.push(format!(
                    "async native command directly invokes a global blocking pool: {}",
                    command.path
                ));
            }
            continue;
        }

        if !allowances.contains_key(command.path.as_str()) {
            violations.push(format!(
                "unclassified synchronous command: {}",
                command.path
            ));
            continue;
        }

        for capability in &command.direct_capabilities {
            violations.push(format!(
                "allowlisted synchronous command uses forbidden direct {capability} capability: {}",
                command.path
            ));
        }
    }

    for path in allowances.keys() {
        match commands.get(*path) {
            None => violations.push(format!(
                "unused synchronous command allowance has no command: {path}"
            )),
            Some(command) if command.is_async => violations.push(format!(
                "unused synchronous command allowance names an async command: {path}"
            )),
            Some(_) => {}
        }
    }

    violations.sort();
    violations.dedup();
    violations
}

fn parse_command_facts(module: &str, source: &str) -> Result<Vec<CommandFact>, String> {
    let file = syn::parse_file(source)
        .map_err(|error| format!("failed to parse commands/{module}.rs: {error}"))?;
    let mut facts = Vec::new();

    for item in file.items {
        let Item::Fn(function) = item else {
            continue;
        };
        if !has_tauri_command_attribute(&function.attrs) {
            continue;
        }

        let mut executor_type = ExecutorTypeVisitor::default();
        for input in &function.sig.inputs {
            executor_type.visit_fn_arg(input);
        }
        let mut body = CommandBodyVisitor::default();
        body.visit_block(&function.block);
        facts.push(CommandFact {
            path: format!("commands::{module}::{}", function.sig.ident),
            is_async: function.sig.asyncness.is_some(),
            has_executor_state: executor_type.found,
            routes_through_executor: body.routes_through_executor,
            awaits_managed_work: body.awaits_managed_work,
            direct_capabilities: body.direct_capabilities,
        });
    }

    Ok(facts)
}

fn parse_command_registry(source: &str) -> Result<Vec<String>, String> {
    let file = syn::parse_file(source)
        .map_err(|error| format!("failed to parse native command registry source: {error}"))?;
    let mut visitor = CommandRegistryVisitor::default();
    visitor.visit_file(&file);
    if !visitor.errors.is_empty() {
        return Err(visitor.errors.join("; "));
    }
    if visitor.registries != 1 {
        return Err(format!(
            "expected one tauri::generate_handler! registry, found {}",
            visitor.registries
        ));
    }
    Ok(visitor.entries)
}

#[derive(Default)]
struct CommandRegistryVisitor {
    registries: usize,
    entries: Vec<String>,
    errors: Vec<String>,
}

impl<'ast> Visit<'ast> for CommandRegistryVisitor {
    fn visit_macro(&mut self, node: &'ast Macro) {
        if path_segments(&node.path) == ["tauri", "generate_handler"] {
            self.registries += 1;
            let parser = Punctuated::<SynPath, syn::Token![,]>::parse_terminated;
            match parser.parse2(node.tokens.clone()) {
                Ok(paths) => {
                    for path in paths {
                        let path = path_to_string(&path);
                        if !path.starts_with("commands::") {
                            self.errors.push(format!(
                                "native command registry contains a non-command path: {path}"
                            ));
                        }
                        self.entries.push(path);
                    }
                }
                Err(error) => self
                    .errors
                    .push(format!("failed to parse native command registry: {error}")),
            }
        }
        visit::visit_macro(self, node);
    }
}

#[derive(Default)]
struct ExecutorTypeVisitor {
    found: bool,
}

impl<'ast> Visit<'ast> for ExecutorTypeVisitor {
    fn visit_type_path(&mut self, node: &'ast TypePath) {
        if node
            .path
            .segments
            .iter()
            .any(|segment| segment.ident == "NativeOperationExecutor")
        {
            self.found = true;
        }
        visit::visit_type_path(self, node);
    }
}

#[derive(Default)]
struct CommandBodyVisitor {
    routes_through_executor: bool,
    awaits_managed_work: bool,
    direct_capabilities: BTreeSet<&'static str>,
}

impl CommandBodyVisitor {
    fn record_path(&mut self, path: &SynPath) {
        let segments = path_segments(path)
            .into_iter()
            .map(|segment| segment.to_ascii_lowercase())
            .collect::<Vec<_>>();
        let joined = segments.join("::");
        if joined.starts_with("std::fs::") || segments.first().is_some_and(|value| value == "fs") {
            self.direct_capabilities.insert("filesystem");
        }
        if joined.starts_with("std::net::")
            || segments
                .iter()
                .any(|value| matches!(value.as_str(), "tcpstream" | "udpsocket"))
        {
            self.direct_capabilities.insert("network");
        }
        if joined.starts_with("std::process::") {
            self.direct_capabilities.insert("process");
        }
        if joined.starts_with("std::thread::") || joined.starts_with("thread::") {
            self.direct_capabilities.insert("thread");
        }
        if segments.iter().any(|value| {
            matches!(
                value.as_str(),
                "rusqlite" | "connection" | "userdb" | "plantdb"
            )
        }) {
            self.direct_capabilities.insert("SQLite");
        }
        if segments.iter().any(|value| {
            matches!(
                value.as_str(),
                "reqwest" | "ureq" | "http" | "httpsconnector"
            )
        }) {
            self.direct_capabilities.insert("HTTP");
        }
        for segment in &segments {
            self.record_identifier(segment);
        }
    }

    fn record_identifier(&mut self, identifier: &str) {
        let identifier = identifier.to_ascii_lowercase();
        for (fragment, capability) in [
            ("render", "rendering"),
            ("image", "image processing"),
            ("png", "PNG processing"),
            ("pdf", "PDF processing"),
            ("encode", "encoding"),
            ("decode", "decoding"),
            ("compress", "compression"),
            ("archive", "compression"),
            ("zip", "compression"),
        ] {
            if identifier.contains(fragment) {
                self.direct_capabilities.insert(capability);
            }
        }
        if identifier == "sleep" {
            self.direct_capabilities.insert("blocking sleep");
        }
        if matches!(identifier.as_str(), "spawn_blocking" | "block_in_place") {
            self.direct_capabilities.insert("blocking pool");
        }
    }
}

impl<'ast> Visit<'ast> for CommandBodyVisitor {
    fn visit_expr_await(&mut self, node: &'ast syn::ExprAwait) {
        let mut route = ExecutorRouteVisitor::default();
        route.visit_expr(&node.base);
        self.awaits_managed_work |= route.found;
        visit::visit_expr_await(self, node);
    }

    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        if matches!(node.method.to_string().as_str(), "run" | "inner")
            && expression_is_identifier(&node.receiver, "executor")
        {
            self.routes_through_executor = true;
        }
        self.record_identifier(&node.method.to_string());
        visit::visit_expr_method_call(self, node);
    }

    fn visit_expr_path(&mut self, node: &'ast ExprPath) {
        self.record_path(&node.path);
        visit::visit_expr_path(self, node);
    }

    fn visit_type_path(&mut self, node: &'ast TypePath) {
        self.record_path(&node.path);
        visit::visit_type_path(self, node);
    }

    fn visit_expr_loop(&mut self, node: &'ast ExprLoop) {
        self.direct_capabilities.insert("unbounded loop");
        visit::visit_expr_loop(self, node);
    }

    fn visit_expr_while(&mut self, node: &'ast ExprWhile) {
        self.direct_capabilities.insert("unbounded loop");
        visit::visit_expr_while(self, node);
    }

    fn visit_expr_for_loop(&mut self, node: &'ast ExprForLoop) {
        self.direct_capabilities.insert("loop");
        visit::visit_expr_for_loop(self, node);
    }
}

#[derive(Default)]
struct ExecutorRouteVisitor {
    found: bool,
}

impl<'ast> Visit<'ast> for ExecutorRouteVisitor {
    fn visit_expr_method_call(&mut self, node: &'ast ExprMethodCall) {
        if matches!(node.method.to_string().as_str(), "run" | "inner")
            && expression_is_identifier(&node.receiver, "executor")
        {
            self.found = true;
        }
        visit::visit_expr_method_call(self, node);
    }
}

fn audit_blocking_pool_sources(sources: &[(&str, &str)], allowed_sources: &[&str]) -> Vec<String> {
    let allowed = allowed_sources.iter().copied().collect::<BTreeSet<_>>();
    let mut violations = Vec::new();
    for (path, source) in sources {
        if allowed.contains(path) {
            continue;
        }
        let file = match syn::parse_file(source) {
            Ok(file) => file,
            Err(error) => {
                violations.push(format!(
                    "failed to parse {path} for blocking escapes: {error}"
                ));
                continue;
            }
        };
        let mut visitor = BlockingEscapeVisitor::default();
        visitor.visit_file(&file);
        for escape in visitor.escapes {
            violations.push(format!(
                "direct native blocking execution outside NativeOperationExecutor: {path} ({escape})"
            ));
        }
    }
    violations.sort();
    violations.dedup();
    violations
}

#[derive(Default)]
struct BlockingEscapeVisitor {
    escapes: BTreeSet<String>,
}

impl BlockingEscapeVisitor {
    fn inspect_call(&mut self, call: &ExprCall) {
        let Expr::Path(function) = call.func.as_ref() else {
            return;
        };
        let segments = path_segments(&function.path);
        let joined = segments.join("::");
        if segments
            .last()
            .is_some_and(|name| matches!(name.as_str(), "spawn_blocking" | "block_in_place"))
            || matches!(
                joined.as_str(),
                "std::thread::spawn" | "thread::spawn" | "rayon::spawn"
            )
        {
            self.escapes.insert(joined);
        }
    }
}

impl<'ast> Visit<'ast> for BlockingEscapeVisitor {
    fn visit_item_mod(&mut self, node: &'ast ItemMod) {
        if has_cfg_test_attribute(&node.attrs) {
            return;
        }
        visit::visit_item_mod(self, node);
    }

    fn visit_item_fn(&mut self, node: &'ast ItemFn) {
        if has_cfg_test_attribute(&node.attrs) {
            return;
        }
        visit::visit_item_fn(self, node);
    }

    fn visit_expr_call(&mut self, node: &'ast ExprCall) {
        self.inspect_call(node);
        visit::visit_expr_call(self, node);
    }
}

fn audit_repository() -> Vec<String> {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let source_root = manifest.join("src");
    let commands_root = source_root.join("commands");
    let registry_source = fs::read_to_string(source_root.join("lib.rs")).unwrap();

    let mut owned_command_sources = fs::read_dir(&commands_root)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "rs"))
        .filter(|path| path.file_stem().is_some_and(|stem| stem != "mod"))
        .map(|path| {
            let module = path.file_stem().unwrap().to_string_lossy().into_owned();
            let source = fs::read_to_string(path).unwrap();
            (module, source)
        })
        .collect::<Vec<_>>();
    owned_command_sources.sort_by(|left, right| left.0.cmp(&right.0));
    let command_sources = owned_command_sources
        .iter()
        .map(|(module, source)| (module.as_str(), source.as_str()))
        .collect::<Vec<_>>();

    let mut violations =
        audit_command_policy(&registry_source, &command_sources, SYNC_COMMAND_ALLOWLIST);

    let mut rust_paths = Vec::new();
    rust_sources_under(&source_root, &mut rust_paths);
    rust_paths.sort();
    let owned_rust_sources = rust_paths
        .into_iter()
        .map(|path| {
            let relative = path
                .strip_prefix(manifest)
                .unwrap()
                .to_string_lossy()
                .into_owned();
            let source = fs::read_to_string(path).unwrap();
            (relative, source)
        })
        .collect::<Vec<_>>();
    let rust_sources = owned_rust_sources
        .iter()
        .map(|(path, source)| (path.as_str(), source.as_str()))
        .collect::<Vec<_>>();
    violations.extend(audit_blocking_pool_sources(
        &rust_sources,
        &["src/native_operation.rs"],
    ));
    if source_root.join("blocking.rs").exists() {
        violations.push("obsolete unbounded blocking helper still exists: src/blocking.rs".into());
    }
    violations.sort();
    violations.dedup();
    violations
}

fn has_tauri_command_attribute(attributes: &[Attribute]) -> bool {
    attributes
        .iter()
        .any(|attribute| path_segments(attribute.path()) == ["tauri", "command"])
}

fn has_cfg_test_attribute(attributes: &[Attribute]) -> bool {
    attributes.iter().any(|attribute| {
        attribute.path().is_ident("cfg")
            && attribute
                .parse_args::<syn::Ident>()
                .is_ok_and(|argument| argument == "test")
    })
}

fn expression_is_identifier(expression: &Expr, expected: &str) -> bool {
    matches!(
        expression,
        Expr::Path(path) if path.qself.is_none() && path.path.is_ident(expected)
    )
}

fn path_segments(path: &SynPath) -> Vec<String> {
    path.segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect()
}

fn path_to_string(path: &SynPath) -> String {
    path.segments
        .iter()
        .map(|segment| segment.ident.to_string())
        .collect::<Vec<_>>()
        .join("::")
}

fn rust_sources_under(path: &Path, sources: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(path).unwrap() {
        let path = entry.unwrap().path();
        if path.is_dir() {
            rust_sources_under(&path, sources);
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            sources.push(path);
        }
    }
}

fn duplicates(values: &[String]) -> BTreeSet<String> {
    let mut seen = BTreeSet::new();
    values
        .iter()
        .filter_map(|value| (!seen.insert(value.clone())).then_some(value.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{
        SyncCommandAllowance, audit_blocking_pool_sources, audit_command_policy, audit_repository,
    };

    #[test]
    fn unclassified_synchronous_command_fixture_is_rejected() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::read_file];",
            &[(
                "fixture",
                r#"
                    #[tauri::command]
                    pub fn read_file() -> Result<Vec<u8>, String> {
                        std::fs::read("fixture").map_err(|error| error.to_string())
                    }
                "#,
            )],
            &[],
        );

        assert_eq!(
            violations,
            ["unclassified synchronous command: commands::fixture::read_file"]
        );
    }

    #[test]
    fn allowlist_cannot_hide_direct_blocking_capabilities() {
        let allowance = [SyncCommandAllowance {
            path: "commands::fixture::read_file",
            reason: "deliberately invalid fixture",
        }];
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::read_file];",
            &[(
                "fixture",
                "#[tauri::command] pub fn read_file() { std::fs::read(\"fixture\"); }",
            )],
            &allowance,
        );

        assert_eq!(
            violations,
            [
                "allowlisted synchronous command uses forbidden direct filesystem capability: commands::fixture::read_file"
            ]
        );
    }

    #[test]
    fn allowlist_rejects_every_forbidden_effect_family() {
        let allowance = [SyncCommandAllowance {
            path: "commands::fixture::effect",
            reason: "deliberately invalid fixture",
        }];
        for (body, expected_capability) in [
            ("std::fs::read(\"fixture\");", "filesystem"),
            ("rusqlite::Connection::open_in_memory();", "SQLite"),
            ("std::net::TcpStream::connect(\"localhost:1\");", "network"),
            ("render_pdf();", "rendering"),
            ("compress_archive();", "compression"),
            ("while ready() { work(); }", "unbounded loop"),
        ] {
            let source = format!("#[tauri::command] pub fn effect() {{ {body} }}");
            let violations = audit_command_policy(
                "tauri::generate_handler![commands::fixture::effect];",
                &[("fixture", source.as_str())],
                &allowance,
            );

            assert!(
                violations
                    .iter()
                    .any(|violation| violation.contains(expected_capability)),
                "{body}: {violations:?}"
            );
        }
    }

    #[test]
    fn async_command_fixture_requires_and_uses_the_managed_executor() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::read_file];",
            &[(
                "fixture",
                "#[tauri::command] pub async fn read_file() { ready().await; }",
            )],
            &[],
        );

        assert_eq!(
            violations,
            [
                "async native command does not await managed executor work: commands::fixture::read_file",
                "async native command does not route work through its executor: commands::fixture::read_file",
                "async native command is missing NativeOperationExecutor state: commands::fixture::read_file",
            ]
        );
    }

    #[test]
    fn async_command_cannot_accept_an_executor_without_awaiting_managed_work() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::fake_async];",
            &[(
                "fixture",
                "#[tauri::command] pub async fn fake_async(executor: State<'_, NativeOperationExecutor>) { let _ = executor; }",
            )],
            &[],
        );

        assert_eq!(
            violations,
            [
                "async native command does not await managed executor work: commands::fixture::fake_async",
                "async native command does not route work through its executor: commands::fixture::fake_async",
            ]
        );
    }

    #[test]
    fn awaiting_unrelated_work_does_not_make_an_async_command_executor_backed() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::fake_async];",
            &[(
                "fixture",
                "#[tauri::command] pub async fn fake_async(executor: State<'_, NativeOperationExecutor>) { let _ = executor; ready().await; }",
            )],
            &[],
        );

        assert_eq!(
            violations,
            [
                "async native command does not await managed executor work: commands::fixture::fake_async",
                "async native command does not route work through its executor: commands::fixture::fake_async",
            ]
        );
    }

    #[test]
    fn executor_work_must_be_the_future_that_is_awaited() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::fake_async];",
            &[(
                "fixture",
                r#"
                    #[tauri::command]
                    pub async fn fake_async(
                        executor: State<'_, NativeOperationExecutor>,
                    ) {
                        let _ = executor.run(NativeOperationClass::Local, "fake", || Ok(()));
                        ready().await;
                    }
                "#,
            )],
            &[],
        );

        assert_eq!(
            violations,
            [
                "async native command does not await managed executor work: commands::fixture::fake_async"
            ]
        );
    }

    #[test]
    fn stale_allowlist_entries_are_rejected() {
        let allowance = [SyncCommandAllowance {
            path: "commands::fixture::removed",
            reason: "stale fixture",
        }];
        let violations = audit_command_policy("tauri::generate_handler![];", &[], &allowance);

        assert_eq!(
            violations,
            ["unused synchronous command allowance has no command: commands::fixture::removed"]
        );
    }

    #[test]
    fn command_annotations_and_registry_must_match_exactly() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::registered_only];",
            &[("fixture", "#[tauri::command] pub fn annotated_only() {}")],
            &[],
        );

        assert_eq!(
            violations,
            [
                "#[tauri::command] function is missing from the native registry: commands::fixture::annotated_only",
                "registered native command has no #[tauri::command] function: commands::fixture::registered_only",
                "unclassified synchronous command: commands::fixture::annotated_only",
            ]
        );
    }

    #[test]
    fn direct_global_blocking_pool_fixture_is_rejected() {
        let violations = audit_blocking_pool_sources(
            &[(
                "src/commands/fixture.rs",
                "fn fixture() { tauri::async_runtime::spawn_blocking(|| work()); }",
            )],
            &["src/native_operation.rs"],
        );

        assert_eq!(
            violations,
            [
                "direct native blocking execution outside NativeOperationExecutor: src/commands/fixture.rs (tauri::async_runtime::spawn_blocking)"
            ]
        );
    }

    #[test]
    fn raw_production_thread_fixture_is_rejected_but_test_module_is_ignored() {
        let violations = audit_blocking_pool_sources(
            &[(
                "src/commands/fixture.rs",
                r#"
                    fn production() { std::thread::spawn(work); }
                    #[cfg(test)]
                    mod tests {
                        fn helper() { std::thread::spawn(test_work); }
                    }
                "#,
            )],
            &["src/native_operation.rs"],
        );

        assert_eq!(
            violations,
            [
                "direct native blocking execution outside NativeOperationExecutor: src/commands/fixture.rs (std::thread::spawn)"
            ]
        );

        let test_only = audit_blocking_pool_sources(
            &[(
                "src/commands/fixture.rs",
                "#[cfg(test)] mod tests { fn helper() { std::thread::spawn(test_work); } }",
            )],
            &["src/native_operation.rs"],
        );
        assert!(test_only.is_empty(), "{test_only:?}");
    }

    #[test]
    fn comments_and_literals_cannot_manufacture_command_or_blocking_facts() {
        let violations = audit_command_policy(
            "tauri::generate_handler![commands::fixture::real];",
            &[(
                "fixture",
                r##"
                    // #[tauri::command] pub fn commented_out() {}
                    const TEXT: &str = r#"#[tauri::command] pub fn literal() { spawn_blocking(); }"#;
                    #[tauri::command]
                    pub async fn real(
                        executor: tauri::State<'_, NativeOperationExecutor>,
                    ) {
                        executor.run(NativeOperationClass::Local, "real", || Ok(())).await;
                    }
                "##,
            )],
            &[],
        );

        assert!(violations.is_empty(), "{violations:?}");
    }

    #[test]
    fn repository_native_commands_follow_the_execution_policy() {
        let violations = audit_repository();

        assert!(
            violations.is_empty(),
            "native command execution policy violations:\n{}",
            violations.join("\n")
        );
    }
}
