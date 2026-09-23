//! Thread-local, one-shot fault boundaries for acceptance tests only.
use super::LidarLibrary;
use std::cell::RefCell;
use std::path::Path;

type SampleHook = Box<dyn FnOnce(&LidarLibrary)>;
type BlockHook = Box<dyn FnOnce(&Path, bool)>;
thread_local! {
    static TARGET: RefCell<Option<SampleHook>> = RefCell::new(None);
    static READ: RefCell<Option<SampleHook>> = RefCell::new(None);
    static BLOCK: RefCell<Option<BlockHook>> = RefCell::new(None);
}
pub(super) fn on_target(hook: SampleHook) -> Guard {
    TARGET.with(|slot| *slot.borrow_mut() = Some(hook));
    Guard
}
pub(super) fn on_read(hook: SampleHook) -> Guard {
    READ.with(|slot| *slot.borrow_mut() = Some(hook));
    Guard
}
pub(super) fn on_block(hook: BlockHook) -> Guard {
    BLOCK.with(|slot| *slot.borrow_mut() = Some(hook));
    Guard
}
pub(super) fn after_target(library: &LidarLibrary) {
    let hook = TARGET.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook(library);
    }
}
pub(super) fn after_read(library: &LidarLibrary) {
    let hook = READ.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook(library);
    }
}
pub(super) fn after_block(scratch: &Path, has_output: bool) {
    let hook = BLOCK.with(|slot| slot.borrow_mut().take());
    if let Some(hook) = hook {
        hook(scratch, has_output);
    }
}
pub(super) struct Guard;
impl Drop for Guard {
    fn drop(&mut self) {
        TARGET.with(|slot| slot.borrow_mut().take());
        READ.with(|slot| slot.borrow_mut().take());
        BLOCK.with(|slot| slot.borrow_mut().take());
        super::paths::capacity_probe::set(None);
    }
}
