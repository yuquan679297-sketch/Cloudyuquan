// 语枢 (VoiceHub) — Tauri app builder
// Registers all Tauri commands and initialises sub-modules
mod asr;
mod audio;
mod dev_config;
mod mouse_shortcut;
mod persisted_config;
mod refine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            asr::register_listener(app.handle().clone());
            mouse_shortcut::init(app.handle().clone());
            refine::warm_up();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            audio::init,
            asr::init_asr,
            asr::set_asr_config,
            asr::set_asr_key,
            asr::set_hotwords,
            dev_config::get_dev_config,
            persisted_config::clear_persisted_asr_config,
            persisted_config::clear_persisted_llm_config,
            persisted_config::get_persisted_runtime_config,
            persisted_config::save_persisted_asr_config,
            persisted_config::save_persisted_llm_config,
            mouse_shortcut::set_mouse_shortcut_button,
            refine::refine_transcript,
            refine::get_codex_prompt,
            refine::init_refine,
            refine::set_llm_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
