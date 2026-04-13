fn main() {
    println!(
        "cargo:rustc-env=BUILD_DATE={}",
        chrono::Utc::now().to_rfc3339()
    );

    let attributes = tauri_build::Attributes::new().windows_attributes(
        tauri_build::WindowsAttributes::new()
            .app_manifest(include_str!("windows-app.manifest")),
    );

    tauri_build::try_build(attributes).expect("failed to run tauri-build");
}
