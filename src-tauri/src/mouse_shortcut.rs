// Global mouse side-button shortcut support for macOS.

#[cfg(target_os = "macos")]
mod platform {
    use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
    use core_graphics::event::{
        CGEvent, CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement,
        CGEventType, CallbackResult, EventField,
    };
    use once_cell::sync::OnceCell;
    use serde::Serialize;
    use std::{
        sync::{
            atomic::{AtomicBool, AtomicU32, Ordering},
            mpsc, Arc, Mutex,
        },
        thread,
        time::Duration,
    };
    use tauri::{AppHandle, Emitter};

    static CONTROLLER: OnceCell<Arc<MouseShortcutController>> = OnceCell::new();

    #[derive(Clone, Serialize)]
    struct MouseShortcutPayload {
        button: u32,
    }

    struct MouseShortcutController {
        app: AppHandle,
        active_button: AtomicU32,
        is_pressed: AtomicBool,
        started: AtomicBool,
        start_lock: Mutex<()>,
    }

    impl MouseShortcutController {
        fn new(app: AppHandle) -> Self {
            Self {
                app,
                active_button: AtomicU32::new(0),
                is_pressed: AtomicBool::new(false),
                started: AtomicBool::new(false),
                start_lock: Mutex::new(()),
            }
        }

        fn ensure_started(self: &Arc<Self>) -> Result<(), String> {
            if self.started.load(Ordering::SeqCst) {
                return Ok(());
            }

            let _guard = self
                .start_lock
                .lock()
                .map_err(|_| "鼠标快捷键监听状态异常".to_string())?;

            if self.started.load(Ordering::SeqCst) {
                return Ok(());
            }

            let controller = Arc::clone(self);
            let (tx, rx) = mpsc::channel();

            thread::Builder::new()
                .name("voicehub-mouse-shortcut".to_string())
                .spawn(move || {
                    let result = run_event_tap(controller);
                    let _ = tx.send(result);
                })
                .map_err(|error| format!("启动鼠标快捷键监听失败：{error}"))?;

            match rx.recv_timeout(Duration::from_secs(2)) {
                Ok(Ok(())) => {
                    self.started.store(true, Ordering::SeqCst);
                    Ok(())
                }
                Ok(Err(error)) => Err(error),
                Err(mpsc::RecvTimeoutError::Timeout) => {
                    self.started.store(true, Ordering::SeqCst);
                    Ok(())
                }
                Err(error) => Err(format!("启动鼠标快捷键监听失败：{error}")),
            }
        }
    }

    fn run_event_tap(controller: Arc<MouseShortcutController>) -> Result<(), String> {
        let event_tap = CGEventTap::new(
            CGEventTapLocation::HID,
            CGEventTapPlacement::HeadInsertEventTap,
            CGEventTapOptions::ListenOnly,
            vec![CGEventType::OtherMouseDown, CGEventType::OtherMouseUp],
            move |_proxy, event_type, event| {
                handle_mouse_event(&controller, event_type, event);
                CallbackResult::Keep
            },
        )
        .map_err(|_| {
            "鼠标快捷键监听启动失败，请在 macOS 系统设置的“隐私与安全性 -> 辅助功能”中允许 VoiceHub"
                .to_string()
        })?;

        let loop_source = event_tap
            .mach_port()
            .create_runloop_source(0)
            .map_err(|_| "鼠标快捷键监听 RunLoop 创建失败".to_string())?;
        CFRunLoop::get_current().add_source(&loop_source, unsafe { kCFRunLoopCommonModes });
        event_tap.enable();

        CFRunLoop::run_current();
        Ok(())
    }

    fn handle_mouse_event(
        controller: &MouseShortcutController,
        event_type: CGEventType,
        event: &CGEvent,
    ) {
        let button = event.get_integer_value_field(EventField::MOUSE_EVENT_BUTTON_NUMBER) as u32;
        let active_button = controller.active_button.load(Ordering::SeqCst);

        if active_button == 0 || active_button != button || !is_supported_mouse_button(button) {
            return;
        }

        match event_type {
            CGEventType::OtherMouseDown => {
                if controller.is_pressed.swap(true, Ordering::SeqCst) {
                    return;
                }
                let _ = controller
                    .app
                    .emit("mouse-shortcut-pressed", MouseShortcutPayload { button });
            }
            CGEventType::OtherMouseUp => {
                if !controller.is_pressed.swap(false, Ordering::SeqCst) {
                    return;
                }
                let _ = controller
                    .app
                    .emit("mouse-shortcut-released", MouseShortcutPayload { button });
            }
            _ => {}
        }
    }

    pub fn init(app: AppHandle) {
        let _ = CONTROLLER.set(Arc::new(MouseShortcutController::new(app)));
    }

    #[tauri::command]
    pub fn set_mouse_shortcut_button(button: Option<u32>) -> Result<(), String> {
        let controller = CONTROLLER
            .get()
            .ok_or_else(|| "鼠标快捷键监听尚未初始化".to_string())?;

        match button {
            Some(value) if !is_supported_mouse_button(value) => {
                Err("鼠标启动键只支持鼠标额外按键".to_string())
            }
            Some(value) => {
                controller.active_button.store(value, Ordering::SeqCst);
                controller.is_pressed.store(false, Ordering::SeqCst);
                controller.ensure_started()
            }
            None => {
                controller.active_button.store(0, Ordering::SeqCst);
                controller.is_pressed.store(false, Ordering::SeqCst);
                Ok(())
            }
        }
    }

    fn is_supported_mouse_button(button: u32) -> bool {
        button > 2
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use tauri::AppHandle;

    pub fn init(_app: AppHandle) {}

    #[tauri::command]
    pub fn set_mouse_shortcut_button(button: Option<u32>) -> Result<(), String> {
        if button.is_some() {
            return Err("鼠标侧键快捷键目前只支持 macOS".to_string());
        }

        Ok(())
    }
}

pub use platform::*;
