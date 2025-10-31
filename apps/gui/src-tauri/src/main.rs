#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use glib::MainContext;

fn main() {
    // Ensure we eagerly initialize the GLib main context so that async helpers can
    // reuse the shared context across platform builds.
    let _default_context = MainContext::default();

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
