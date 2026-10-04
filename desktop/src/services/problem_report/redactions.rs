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
        let chars = redact_credential_query_values(text)
            .chars()
            .collect::<Vec<_>>();
        let known_paths = self
            .known_paths
            .iter()
            .map(|(path, replacement)| (path.chars().collect::<Vec<_>>(), *replacement))
            .collect::<Vec<_>>();
        let mut output = String::with_capacity(chars.len());
        let mut index = 0;

        while index < chars.len() {
            let known = known_paths
                .iter()
                .find(|(path, _)| chars[index..].starts_with(path));
            if let Some((_, replacement)) = known {
                // The rest of the path (a file name inside a known folder) is
                // as private as the folder itself.
                output.push_str(replacement);
                index = consume_path_token(&chars, index);
            } else if starts_unix_path(&chars, index) || starts_windows_path(&chars, index) {
                output.push_str("<path>");
                index = consume_path_token(&chars, index);
            } else {
                output.push(chars[index]);
                index += 1;
            }
        }

        output
    }
}

fn push_redaction(paths: &mut Vec<(String, &'static str)>, path: &Path, replacement: &'static str) {
    let value = path.to_string_lossy();
    if !value.is_empty() {
        paths.push((value.into_owned(), replacement));
    }
}

/// Query parameters that carry credentials (the Google Maps key and similar).
const CREDENTIAL_QUERY_NAMES: [&str; 4] = ["key", "api-key", "api_key", "apikey"];

fn redact_credential_query_values(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = String::with_capacity(text.len());
    let mut index = 0;

    while index < chars.len() {
        let at_parameter_start = index == 0
            || matches!(chars[index - 1], '?' | '&' | ';')
            || chars[index - 1].is_whitespace();
        let name_length = at_parameter_start
            .then(|| {
                CREDENTIAL_QUERY_NAMES.iter().find_map(|name| {
                    let length = name.chars().count();
                    let candidate = chars.get(index..index + length + 1)?;
                    (candidate[..length]
                        .iter()
                        .collect::<String>()
                        .eq_ignore_ascii_case(name)
                        && candidate[length] == '=')
                        .then_some(length)
                })
            })
            .flatten();
        let Some(name_length) = name_length else {
            output.push(chars[index]);
            index += 1;
            continue;
        };

        output.extend(&chars[index..=index + name_length]);
        index += name_length + 1;
        let value_start = index;
        while index < chars.len()
            && !chars[index].is_whitespace()
            && !matches!(
                chars[index],
                '&' | '#' | '"' | '\'' | ')' | ']' | '}' | ',' | ';' | '<' | '>'
            )
        {
            index += 1;
        }
        if index > value_start {
            output.push_str("<redacted>");
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

/// End of a path token. Paths may contain spaces, so a token runs to a
/// delimiter, the end of the line, or a `: ` separator, which keeps the error
/// reason that usually follows a path (`<path>: No such file or directory`).
fn consume_path_token(chars: &[char], start: usize) -> usize {
    let mut index = start;
    while index < chars.len() {
        let ch = chars[index];
        if matches!(ch, '\n' | '\r' | '"' | '\'' | ')' | ']' | '}' | ',' | ';') {
            break;
        }
        if ch == ':' && chars.get(index + 1).is_none_or(|next| next.is_whitespace()) {
            break;
        }
        index += 1;
    }
    index
}

#[cfg(test)]
mod tests {
    use super::Redactions;

    fn redactions(known: &[(&str, &'static str)]) -> Redactions {
        let mut known_paths = known
            .iter()
            .map(|(path, replacement)| ((*path).to_owned(), *replacement))
            .collect::<Vec<_>>();
        known_paths.sort_by_key(|path| std::cmp::Reverse(path.0.len()));
        Redactions { known_paths }
    }

    #[test]
    fn path_redaction_keeps_the_error_reason_after_the_path() {
        let sanitized = redactions(&[]).sanitize(
            "Failed to read /media/alice/USB Drive/Secret Orchard.canopi: No such file or directory (os error 2)",
        );

        assert_eq!(
            sanitized,
            "Failed to read <path>: No such file or directory (os error 2)"
        );
    }

    #[test]
    fn a_file_inside_a_known_folder_is_redacted_with_the_folder() {
        let sanitized = redactions(&[("/home/alice", "<home-dir>")])
            .sanitize("Loaded /home/alice/Secret Orchard.canopi: permission denied");

        assert_eq!(sanitized, "Loaded <home-dir>: permission denied");
    }

    #[test]
    fn windows_paths_keep_their_error_reason() {
        let sanitized = redactions(&[])
            .sanitize(r"Failed to save C:\Users\alice\Secret Orchard.canopi: Access is denied.");

        assert_eq!(sanitized, "Failed to save <path>: Access is denied.");
    }

    #[test]
    fn credential_query_values_are_redacted() {
        let sanitized = redactions(&[]).sanitize(
            "GET https://tile.googleapis.com/v1/createSession?key=AIzaSECRET&session=abc failed; retry with api-key=SECRET2 or API_KEY=SECRET3",
        );

        assert!(!sanitized.contains("SECRET"), "{sanitized}");
        assert!(
            sanitized.contains("?key=<redacted>&session=abc"),
            "{sanitized}"
        );
        assert!(sanitized.contains("api-key=<redacted>"), "{sanitized}");
        assert!(sanitized.contains("API_KEY=<redacted>"), "{sanitized}");
    }

    #[test]
    fn known_folders_are_redacted_inside_urls() {
        let sanitized = redactions(&[("/home/alice", "<home-dir>")])
            .sanitize("open file:///home/alice/Secret Orchard.canopi: failed");

        assert_eq!(sanitized, "open file://<home-dir>: failed");
    }

    #[test]
    fn words_ending_in_key_are_not_query_parameters() {
        let sanitized = redactions(&[]).sanitize("monkey=banana primary_key=id");

        assert_eq!(sanitized, "monkey=banana primary_key=id");
    }
}
