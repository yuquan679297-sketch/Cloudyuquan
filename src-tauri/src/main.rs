// 语枢 (VoiceHub) — binary entry point
// Calls lib.rs to build and run the Tauri app
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    voicehub_lib::run();
}
