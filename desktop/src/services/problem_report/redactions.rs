use std::cmp::Reverse;
use std::path::{Path, PathBuf};

use super::ProblemReportContext;

pub(crate) struct Redactions {
    known_paths: Vec<(String, &'static str)>,
}

impl Redactions {
    pub(crate) fn from_context(context: &ProblemReportContext) -> Self {
        let mut known_paths = Vec::new();
        push_redaction(&mut known_paths, &context.output_root, "<report-root>");
        if let Some(path) = &context.log_dir {
            push_redaction(&mut known_paths, path, "<log-dir>");
        }
        if let Some(path) = &context.app_data_dir {
            push_redaction(&mut known_paths, path, "<app-data-dir>");
        }
        if let Some(settings) = &context.settings {
            let default_dir = settings.default_design_dir.trim();
            if !default_dir.is_empty() {
                known_paths.push((default_dir.to_owned(), "<default-design-dir>"));
            }
        }
        if let Some(home) = std::env::var_os("HOME") {
            let path = PathBuf::from(home);
            push_redaction(&mut known_paths, &path, "<home-dir>");
        }
        if let Some(profile) = std::env::var_os("USERPROFILE") {
            let path = PathBuf::from(profile);
            push_redaction(&mut known_paths, &path, "<home-dir>");
        }

        known_paths.sort_by_key(|path| Reverse(path.0.len()));
        Self { known_paths }
    }

    pub(crate) fn sanitize(&self, text: &str) -> String {
        let mut sanitized = text.to_owned();
        for (path, replacement) in &self.known_paths {
            sanitized = sanitized.replace(path, replacement);
        }
        redact_absolute_path_tokens(&sanitized)
    }
}

fn push_redaction(paths: &mut Vec<(String, &'static str)>, path: &Path, replacement: &'static str) {
    let value = path.to_string_lossy();
    if !value.is_empty() {
        paths.push((value.into_owned(), replacement));
    }
}

fn redact_absolute_path_tokens(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;

    while index < chars.len() {
        if starts_unix_path(&chars, index) || starts_windows_path(&chars, index) {
            output.push_str("<path>");
            index = consume_path_token(&chars, index);
        } else {
            output.push(chars[index]);
            index += 1;
        }
    }

    output
}

fn starts_unix_path(chars: &[char], index: usize) -> bool {
    chars[index] == '/' && (index == 0 || is_path_boundary(chars[index - 1]))
}

fn starts_windows_path(chars: &[char], index: usize) -> bool {
    index + 2 < chars.len()
        && chars[index].is_ascii_alphabetic()
        && chars[index + 1] == ':'
        && matches!(chars[index + 2], '\\' | '/')
        && (index == 0 || is_path_boundary(chars[index - 1]))
}

fn is_path_boundary(ch: char) -> bool {
    ch.is_whitespace() || matches!(ch, '"' | '\'' | '(' | '[' | '{' | '=')
}

fn consume_path_token(chars: &[char], start: usize) -> usize {
    let mut index = start;
    while index < chars.len() {
        let ch = chars[index];
        if matches!(ch, '\n' | '\r' | '"' | '\'' | ')' | ']' | '}' | ',' | ';') {
            break;
        }
        index += 1;
    }
    index
}
