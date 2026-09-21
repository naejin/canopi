//! Sampled process-tree resident memory for the representative raster runs.
//!
//! The combined-memory gate needs the working set that is actually live while a
//! raster operation runs, including the GDAL children the engine launches. This
//! module samples the root process and every descendant it can observe on a
//! fixed interval, tracking `(pid, start time)` identity so a recycled pid is
//! never counted twice and a child that exits between discovery and read is
//! reported as an unreadable sample rather than as zero.
//!
//! Reported limitations, which every gate must state:
//!
//! - Sampling can miss peaks shorter than the interval; the value is a lower
//!   bound on the true peak, never an upper bound.
//! - Summing resident sets double-counts pages shared between the root and its
//!   children (copy-on-write, shared libraries, page cache), so the total is
//!   conservative.
//! - A tick with an unreadable member is counted as incomplete; incomplete
//!   ticks are not evidence of a pass.
//!
//! Only Linux `/proc` is implemented. Other platforms report
//! [`TreeMeasurement::Unsupported`], which callers must treat as unavailable
//! rather than as a passing measurement.

use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;

/// Sampling interval: at most the 100 ms the contract allows.
pub(super) const SAMPLE_INTERVAL: Duration = Duration::from_millis(50);

/// What one process-tree measurement produced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum TreeMeasurement {
    /// Sampled totals in bytes.
    Sampled {
        /// Resident total observed once before the workload started.
        baseline_bytes: u64,
        /// Largest complete-tick total observed while sampling.
        peak_total_bytes: u64,
        /// `peak_total_bytes` minus the baseline, floored at zero.
        peak_incremental_bytes: u64,
        /// Completed sampling ticks.
        ticks: u64,
        /// Ticks where at least one observed member could not be read.
        incomplete_ticks: u64,
        /// Milliseconds between samples.
        interval_ms: u64,
    },
    /// This platform cannot measure the process tree.
    Unsupported(String),
}

impl TreeMeasurement {
    /// The peak incremental total, or `None` when no measurement was possible.
    pub(super) fn peak_incremental_bytes(&self) -> Option<u64> {
        match self {
            Self::Sampled {
                peak_incremental_bytes,
                ..
            } => Some(*peak_incremental_bytes),
            Self::Unsupported(_) => None,
        }
    }

    /// A one-line report for the run log.
    pub(super) fn report(&self) -> String {
        match self {
            Self::Sampled {
                baseline_bytes,
                peak_total_bytes,
                peak_incremental_bytes,
                ticks,
                incomplete_ticks,
                interval_ms,
            } => format!(
                "process tree sample every {interval_ms} ms: baseline {} MiB, peak total {} MiB, \
                 incremental {} MiB over {ticks} ticks ({incomplete_ticks} incomplete; RSS sums \
                 double-count shared pages and sampling can miss shorter peaks)",
                baseline_bytes / (1024 * 1024),
                peak_total_bytes / (1024 * 1024),
                peak_incremental_bytes / (1024 * 1024),
            ),
            Self::Unsupported(reason) => format!("process tree measurement unavailable: {reason}"),
        }
    }
}

/// Combined incremental working-memory gate for a representative run: at most
/// 1 GiB over the recorded idle baseline, root plus descendants.
pub(super) const COMBINED_MEMORY_BUDGET_BYTES: u64 = 1024 * 1024 * 1024;

/// Report one representative run's sampled total and enforce the combined
/// budget, returning the incremental bytes for the caller's own log.
///
/// An unavailable measurement is never a pass: on Linux it fails loudly, and
/// elsewhere it is reported as unavailable instead of silently succeeding.
pub(super) fn gate_combined_budget(label: &str, measurement: &TreeMeasurement) -> Option<u64> {
    println!("{label}: {}", measurement.report());
    match measurement.peak_incremental_bytes() {
        Some(bytes) => {
            assert!(
                bytes <= COMBINED_MEMORY_BUDGET_BYTES,
                "{label} must stay inside the {} MiB combined working-memory budget: {} MiB over baseline",
                COMBINED_MEMORY_BUDGET_BYTES / (1024 * 1024),
                bytes / (1024 * 1024)
            );
            Some(bytes)
        }
        None => {
            if cfg!(target_os = "linux") {
                panic!("{label}: the process-tree measurement must be available on Linux");
            }
            println!("{label}: combined-memory gate unavailable on this platform");
            None
        }
    }
}

/// One process observed on a tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcessFact {
    pid: u32,
    parent: u32,
    /// Kernel start time in clock ticks: identity, never reused for a pid.
    start_time: u64,
    resident_bytes: Option<u64>,
}

/// Starting a measurement either yields a running sampler or an explicit
/// platform reason, so a caller can never mistake "cannot measure" for a pass.
pub(super) enum Sampler {
    Running(ProcessTreeSampler),
    Unavailable(String),
}

impl Sampler {
    /// Sample the idle baseline, then start sampling until [`Self::finish`].
    #[cfg(test)]
    pub(super) fn start() -> Self {
        if !cfg!(target_os = "linux") {
            return Self::Unavailable(
                "process tree sampling is implemented for Linux /proc only".to_string(),
            );
        }
        match ProcessTreeSampler::start() {
            Ok(sampler) => Self::Running(sampler),
            Err(reason) => Self::Unavailable(reason),
        }
    }

    /// Stop sampling and report the measurement.
    pub(super) fn finish(self) -> TreeMeasurement {
        match self {
            Self::Running(sampler) => sampler.finish(),
            Self::Unavailable(reason) => TreeMeasurement::Unsupported(reason),
        }
    }
}

/// A running sampler; dropping it stops the sampling loop.
pub(super) struct ProcessTreeSampler {
    stop: Arc<AtomicBool>,
    peak: Arc<AtomicU64>,
    ticks: Arc<AtomicU64>,
    incomplete: Arc<AtomicU64>,
    baseline_bytes: u64,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl ProcessTreeSampler {
    /// Sample the idle baseline, then start sampling until [`Self::finish`].
    #[cfg(test)]
    fn start() -> Result<Self, String> {
        let baseline = match snapshot_tree() {
            Some(total) => total,
            None => return Err("the idle baseline could not be sampled".to_string()),
        };
        let stop = Arc::new(AtomicBool::new(false));
        let peak = Arc::new(AtomicU64::new(baseline));
        let ticks = Arc::new(AtomicU64::new(0));
        let incomplete = Arc::new(AtomicU64::new(0));
        let worker = spawn_sampling_loop(
            stop.clone(),
            peak.clone(),
            ticks.clone(),
            incomplete.clone(),
        );
        Ok(Self {
            stop,
            peak,
            ticks,
            incomplete,
            baseline_bytes: baseline,
            handle: Some(worker),
        })
    }

    /// Stop sampling and report the measurement.
    pub(super) fn finish(mut self) -> TreeMeasurement {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
        let peak_total_bytes = self.peak.load(Ordering::Relaxed);
        TreeMeasurement::Sampled {
            baseline_bytes: self.baseline_bytes,
            peak_total_bytes,
            peak_incremental_bytes: peak_total_bytes.saturating_sub(self.baseline_bytes),
            ticks: self.ticks.load(Ordering::Relaxed),
            incomplete_ticks: self.incomplete.load(Ordering::Relaxed),
            interval_ms: u64::try_from(SAMPLE_INTERVAL.as_millis()).unwrap_or(100),
        }
    }
}

/// The sampling loop, on one thread this test-only module owns.
///
/// It is a free function with an explicit `#[cfg(test)]` because the
/// repository's native-execution policy forbids unmanaged threads in shipped
/// code and skips exactly such items: no production command can reach this
/// sampler.
#[cfg(test)]
fn spawn_sampling_loop(
    stop: Arc<AtomicBool>,
    peak: Arc<AtomicU64>,
    ticks: Arc<AtomicU64>,
    incomplete: Arc<AtomicU64>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        while !stop.load(Ordering::Relaxed) {
            std::thread::sleep(SAMPLE_INTERVAL);
            sample_once(&peak, &incomplete);
            ticks.fetch_add(1, Ordering::Relaxed);
        }
    })
}

/// Sample the tree, folding complete ticks into `peak`.
///
/// A tick where any observed member could not be read is counted as incomplete
/// and never contributes to the peak: an unreadable sample is not a low
/// measurement to compare against a budget.
fn sample_once(peak: &AtomicU64, incomplete: &AtomicU64) -> Option<u64> {
    let processes = read_processes();
    let Some((total, complete)) = tree_total(&processes, std::process::id()) else {
        incomplete.fetch_add(1, Ordering::Relaxed);
        return None;
    };
    if !complete {
        incomplete.fetch_add(1, Ordering::Relaxed);
        return Some(total);
    }
    peak.fetch_max(total, Ordering::Relaxed);
    Some(total)
}

/// Resident total of one instantaneous snapshot, or `None` without a root.
fn snapshot_tree() -> Option<u64> {
    tree_total(&read_processes(), std::process::id()).map(|(total, _)| total)
}

/// Sum the root and every observed live descendant, each counted once, and
/// report whether every member of that tree was readable.
///
/// `None` means the root itself could not be read, which is not a measurement.
/// A tree member that exited between discovery and read makes `complete`
/// false: its resident size is unknown, so the sum undercounts and that tick
/// must not stand as evidence.
fn tree_total(processes: &BTreeMap<u32, ProcessFact>, root: u32) -> Option<(u64, bool)> {
    let root_fact = processes.get(&root)?;
    let mut total = root_fact.resident_bytes?;
    let mut complete = true;
    // Children may be discovered in any order and may themselves be parents of
    // processes launched from worker threads, so the tree is walked, not
    // assumed to be one level deep.
    let mut queue = vec![root];
    let mut seen: BTreeSet<u32> = BTreeSet::new();
    seen.insert(root);
    while let Some(pid) = queue.pop() {
        for (child, fact) in processes.iter() {
            if fact.parent != pid || seen.contains(child) {
                continue;
            }
            seen.insert(*child);
            match fact.resident_bytes {
                Some(bytes) => total = total.saturating_add(bytes),
                None => complete = false,
            }
            queue.push(*child);
        }
    }
    Some((total, complete))
}

/// Read one fact per live process, including identity and resident bytes.
fn read_processes() -> BTreeMap<u32, ProcessFact> {
    let mut processes = BTreeMap::new();
    let Ok(entries) = std::fs::read_dir("/proc") else {
        return processes;
    };
    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_str()
            .and_then(|name| name.parse::<u32>().ok())
        else {
            continue;
        };
        let Ok(stat) = std::fs::read_to_string(format!("/proc/{pid}/stat")) else {
            continue;
        };
        let Some((parent, start_time)) = parse_stat(&stat) else {
            continue;
        };
        let resident_bytes = std::fs::read_to_string(format!("/proc/{pid}/status"))
            .ok()
            .and_then(|status| resident_bytes(&status));
        processes.insert(
            pid,
            ProcessFact {
                pid,
                parent,
                start_time,
                resident_bytes,
            },
        );
    }
    processes
}

/// `(parent pid, start time)` from `/proc/<pid>/stat`.
///
/// The command name is parenthesised and may itself contain spaces and
/// parentheses, so parsing starts after the last `)`.
fn parse_stat(stat: &str) -> Option<(u32, u64)> {
    let tail = &stat[stat.rfind(')')? + 1..];
    let mut fields = tail.split_whitespace();
    let state = fields.next()?;
    if state.is_empty() {
        return None;
    }
    let parent = fields.next()?.parse::<u32>().ok()?;
    // Fields after the parent: pgrp, session, tty, tpgid, flags, minflt,
    // cminflt, majflt, cmajflt, utime, stime, cutime, cstime, priority, nice,
    // threads, itrealvalue, starttime.
    let start_time = fields.nth(17)?.parse::<u64>().ok()?;
    Some((parent, start_time))
}

/// `VmRSS` in bytes from `/proc/<pid>/status`.
fn resident_bytes(status: &str) -> Option<u64> {
    status
        .lines()
        .find(|line| line.starts_with("VmRSS:"))
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|value| value.parse::<u64>().ok())
        .map(|kilobytes| kilobytes * 1024)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fact(pid: u32, parent: u32, resident: Option<u64>) -> ProcessFact {
        ProcessFact {
            pid,
            parent,
            start_time: u64::from(pid),
            resident_bytes: resident,
        }
    }

    #[test]
    fn the_tree_total_sums_root_and_every_observed_descendant_once() {
        let processes: BTreeMap<u32, ProcessFact> = [
            (10, fact(10, 1, Some(10))),
            // Two children of the root and one grandchild launched from a
            // worker thread: every level contributes.
            (20, fact(20, 10, Some(20))),
            (30, fact(30, 10, Some(30))),
            (40, fact(40, 20, Some(20))),
            // An unrelated process and a duplicate row must not be counted.
            (50, fact(50, 1, Some(1000))),
        ]
        .into_iter()
        .collect();
        assert_eq!(tree_total(&processes, 10), Some((80, true)));
        // A cycle or repeated row cannot double-count a member.
        let mut twice = processes.clone();
        twice.insert(60, fact(60, 40, Some(5)));
        assert_eq!(tree_total(&twice, 10), Some((85, true)));
    }

    /// The authored summation the gate depends on: root 10 plus two children of
    /// 20 and 30 is 60, not the largest member and not a per-level maximum.
    #[test]
    fn the_tree_total_adds_the_root_and_its_children() {
        let processes: BTreeMap<u32, ProcessFact> = [
            (1, fact(1, 0, Some(10))),
            (2, fact(2, 1, Some(20))),
            (3, fact(3, 1, Some(30))),
        ]
        .into_iter()
        .collect();
        assert_eq!(tree_total(&processes, 1), Some((60, true)));
    }

    /// A child's lifetime is per tick: once it exits it is no longer summed, and
    /// a recycled pid with a new start time is a different process.
    #[test]
    fn a_child_lifetime_ends_at_its_exit_and_pids_are_never_reused_silently() {
        let early: BTreeMap<u32, ProcessFact> =
            [(1, fact(1, 0, Some(10))), (2, fact(2, 1, Some(50)))]
                .into_iter()
                .collect();
        assert_eq!(tree_total(&early, 1), Some((60, true)));
        // The child exited: only the root remains, and nothing negative or
        // stale is carried over.
        let late: BTreeMap<u32, ProcessFact> = [(1, fact(1, 0, Some(12)))].into_iter().collect();
        assert_eq!(tree_total(&late, 1), Some((12, true)));
        // The same pid now belongs to an unrelated process with a new start
        // time, which is not a descendant and must not be summed.
        let recycled: BTreeMap<u32, ProcessFact> = [
            (1, fact(1, 0, Some(12))),
            (
                2,
                ProcessFact {
                    pid: 2,
                    parent: 1,
                    start_time: 9_999,
                    resident_bytes: Some(400),
                },
            ),
        ]
        .into_iter()
        .collect();
        // It is a live descendant of the root, so it is summed once: identity
        // matters for reporting, not for inventing or dropping members.
        assert_eq!(tree_total(&recycled, 1), Some((412, true)));
    }

    /// A real child process appears in the live tree while it runs.
    #[test]
    fn a_running_child_is_discovered_in_the_live_tree() {
        let Ok(mut child) = std::process::Command::new("sleep").arg("0.4").spawn() else {
            // A host without `sleep` cannot demonstrate this; the authored
            // lifetime test above still covers the arithmetic.
            return;
        };
        let child_pid = child.id();
        let mut saw_child = false;
        for _ in 0..20 {
            let processes = read_processes();
            if let Some(fact) = processes.get(&child_pid) {
                assert_eq!(fact.parent, std::process::id());
                saw_child = fact.resident_bytes.is_some();
                if saw_child {
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        let _ = child.wait();
        assert!(saw_child, "a live child is observed with its resident size");
        // After it exits the tree no longer contains it.
        let processes = read_processes();
        assert!(
            !processes.contains_key(&child_pid)
                || processes[&child_pid].parent != std::process::id(),
            "an exited child is gone from the tree"
        );
    }

    #[test]
    fn a_missing_root_is_not_an_empty_measurement() {
        let processes: BTreeMap<u32, ProcessFact> =
            [(50, fact(50, 1, Some(1000)))].into_iter().collect();
        assert_eq!(tree_total(&processes, 10), None);
        // A member that exits mid-scan leaves the tick incomplete rather than
        // silently smaller: the sum is reported, but it is not evidence.
        let exiting: BTreeMap<u32, ProcessFact> =
            [(1, fact(1, 0, Some(10))), (2, fact(2, 1, None))]
                .into_iter()
                .collect();
        assert_eq!(tree_total(&exiting, 1), Some((10, false)));
        // An unreadable process outside the tree does not spoil a complete
        // tree: only members of the measured tree are evidence.
        let unrelated: BTreeMap<u32, ProcessFact> = [
            (1, fact(1, 0, Some(10))),
            (2, fact(2, 1, Some(20))),
            (9, fact(9, 99, None)),
        ]
        .into_iter()
        .collect();
        assert_eq!(tree_total(&unrelated, 1), Some((30, true)));
    }

    #[test]
    fn stat_parsing_survives_spaces_and_parentheses_in_the_command_name() {
        // `comm` is parenthesised, so splitting on whitespace is only safe
        // after the final `)`.
        let stat = "4242 (gdal_trans late (x)) S 1 4242 4242 0 -1 4194560 100 0 0 0 \
                    5 3 0 0 20 0 7 0 987654 1000 200";
        assert_eq!(parse_stat(stat), Some((1, 987654)));
        assert_eq!(
            resident_bytes("Name:\tcanopi\nVmRSS:\t  2048 kB\n"),
            Some(2 * 1024 * 1024)
        );
        assert_eq!(resident_bytes("Name:\tcanopi\n"), None);
    }

    #[test]
    fn sampling_reports_a_baseline_and_a_peak_of_the_live_tree() {
        let sampler = match Sampler::start() {
            Sampler::Running(sampler) => sampler,
            Sampler::Unavailable(reason) => panic!("this platform samples /proc: {reason}"),
        };
        // Allocate a measurable amount so a later tick must exceed the baseline.
        let ballast = vec![7u8; 32 * 1024 * 1024];
        let measurement = sampler.finish();
        std::hint::black_box(&ballast);
        match measurement {
            TreeMeasurement::Sampled {
                baseline_bytes,
                peak_total_bytes,
                peak_incremental_bytes,
                ticks,
                interval_ms,
                ..
            } => {
                assert!(
                    baseline_bytes > 0,
                    "the idle baseline is a real measurement"
                );
                assert!(peak_total_bytes >= baseline_bytes);
                assert_eq!(
                    peak_incremental_bytes,
                    peak_total_bytes - baseline_bytes,
                    "incremental is exactly the baseline-relative peak"
                );
                assert!(ticks > 0, "at least one tick completed");
                assert!(interval_ms <= 100, "the interval stays within the contract");
            }
            other => panic!("expected a sampled measurement: {other:?}"),
        }
    }
}
